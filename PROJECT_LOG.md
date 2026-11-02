# QueueLess — Project Log and Viva Notes

## 1. Project purpose

QueueLess is a MongoDB practical project that manages service queues and digital tokens. The main goal is to demonstrate a complete CRUD application with relationships, validation, indexes, error handling, and a connected frontend.

## 2. Final architecture

```text
Browser (HTML/CSS/vanilla JS)
        |
        | fetch() JSON requests
        v
Express application (server.js)
        |
        +-- /api/health          -> connection status
        +-- /api/queues          -> queue CRUD
        +-- /api/tokens          -> token creation, listing, status, deletion
        +-- /api/dashboard/stats -> aggregated dashboard data
        |
        v
Mongoose models (Queue, Token)
        |
        v
MongoDB database (queueless)
        +-- queues collection
        +-- tokens collection
```

The Express server also serves the `public/` folder, so the frontend and API run on the same origin. There is no separate frontend build step.

## 3. Important files

| File | Responsibility |
| --- | --- |
| `server.js` | Creates Express app, registers middleware/routes, starts server after DB connection, handles unknown routes and errors |
| `config/db.js` | Reads `MONGO_URI` (or `MONGO_DB_URL`), connects Mongoose, reports connection state |
| `models/Queue.js` | Queue schema, validation, timestamps, `lastTokenNumber` counter |
| `models/Token.js` | Token schema, validation, status enum, Queue reference, unique compound index |
| `utils/tokenHelpers.js` | Allowed status transitions, queue position and wait-time calculation |
| `routes/queueRoutes.js` | Queue list/create/get/update/delete; token counts; safe delete policy |
| `routes/tokenRoutes.js` | Token list/create/get/status/delete; atomic numbering; transition enforcement |
| `routes/dashboardRoutes.js` | Dashboard totals and recent tokens |
| `public/index.html` | Dashboard, Queues view, Tokens view, queue details modal |
| `public/style.css` | Responsive QueueLess styling |
| `public/script.js` | All frontend state, API calls, rendering, forms and toasts |
| `QueueLess.postman_collection.json` | Runnable Postman requests with variable chaining and tests |

## 4. Request lifecycle

1. The browser sends `fetch()` to an `/api/...` endpoint.
2. `express.json()` parses the JSON body.
3. The matching router validates IDs and fields.
4. Mongoose validates and queries MongoDB.
5. The route returns `{ success, message, data }`.
6. The central error handler converts known errors into clear `400/404/409/500` JSON responses.
7. The frontend updates state and re-renders the affected lists and dashboard.

## 5. Main data flows

### Create a queue
`POST /api/queues` -> validate name/description/minutes -> `Queue.create()` -> return queue with zero counts.

### Issue a token
1. Validate customer name/contact and queue ID.
2. Confirm the queue exists and is active.
3. Align the queue counter with any existing token numbers (supports old data).
4. Atomically reserve the next number with `$inc`.
5. Create the token with `Waiting` status.
6. Populate the queue details.
7. Calculate queue position and estimated wait.
8. Return `201` with the token.

### Update token status
`PATCH /api/tokens/:id/status` -> validate status -> load token -> check allowed transition -> set relevant timestamp -> save -> recalculate position -> return updated token.

### Delete a queue
1. Find queue and count its tokens.
2. If tokens exist and `?cascade=true` is missing, return `409` with `QUEUE_HAS_TOKENS`.
3. If cascade is explicitly confirmed, delete tokens first, then delete the queue.
4. Return how many tokens were deleted.

## 6. CRUD summary

| Entity | Create | Read | Update | Delete |
| --- | --- | --- | --- | --- |
| Queue | `POST /api/queues` | `GET /api/queues`, `GET /api/queues/:id` | `PUT /api/queues/:id` | `DELETE /api/queues/:id` (+ optional cascade) |
| Token | `POST /api/tokens` | `GET /api/tokens`, `GET /api/tokens/:id` | `PATCH /api/tokens/:id/status` | `DELETE /api/tokens/:id` |

## 7. Database design

### Queue document
```json
{
  "_id": "ObjectId",
  "name": "General Consultation",
  "serviceDescription": "Doctor appointment",
  "averageServiceMinutes": 5,
  "isActive": true,
  "lastTokenNumber": 12,
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

### Token document
```json
{
  "_id": "ObjectId",
  "tokenNumber": 13,
  "customerName": "Riya Sharma",
  "customerContact": "9876543210",
  "queue": "ObjectId of Queue",
  "status": "Waiting",
  "issuedAt": "Date",
  "servedAt": null,
  "completedAt": null,
  "cancelledAt": null,
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

### Relationship
One queue has many tokens. `Token.queue` is an ObjectId reference to `Queue`. `populate("queue", ...)` embeds selected queue fields in API responses without storing duplicate data.

### Indexes
- `{ queue: 1, tokenNumber: 1 }` **unique** - prevents the same token number twice in one queue.
- `{ queue: 1, status: 1, tokenNumber: 1 }` - supports queue position and dashboard counting.
- Queue `{ isActive: 1, createdAt: -1 }` - supports listing active queues by recency.

### Why timestamps
`createdAt` and `updatedAt` are added by Mongoose. Token lifecycle timestamps (`issuedAt`, `servedAt`, `completedAt`, `cancelledAt`) record when each transition happened.

## 8. Sequential token generation and concurrency

### Chosen approach
Each queue stores `lastTokenNumber`. When a token is requested:

```js
Queue.findOneAndUpdate(
  { _id: queueId, isActive: true },
  { $inc: { lastTokenNumber: 1 } },
  { new: true }
);
```

MongoDB applies `$inc` atomically to one document, so two simultaneous requests receive two different numbers. The unique compound index is a second safety net.

### Why this is better than read-then-add
A naïve implementation:
```js
const last = await Token.findOne(...).sort({ tokenNumber: -1 });
const next = last.tokenNumber + 1; // two requests can read the same "last"
```
Two requests can read the same value and race. The counter approach avoids that race.

### Honest limitations
- The counter is per queue document. This is safe under normal load, but a very large distributed system might use a dedicated counter collection or transactions for stricter guarantees.
- If token creation fails after reserving a number, that number is skipped (a gap). Gaps are acceptable because token numbers must be unique, not perfectly consecutive after failures.
- Deleting a token does not reuse its number. This is intentional.

## 9. Status state machine

```text
Waiting  -> Serving -> Completed
   |          |
   +----------+------> Cancelled
```

| Current | Allowed next |
| --- | --- |
| Waiting | Serving, Cancelled |
| Serving | Completed, Cancelled |
| Completed | none (terminal) |
| Cancelled | none (terminal) |

The API rejects invalid transitions with `409 Conflict` and returns `code: "INVALID_STATUS_TRANSITION"`, the current status, and the allowed next statuses. The frontend only shows valid options.

## 10. Validation and error handling

Validation exists at three levels:
1. **HTML** - required, minlength, number range.
2. **Route/manual** - JSON body shape, name lengths, valid ObjectIds, valid status values, numeric minutes.
3. **Mongoose** - required fields, trims, min/max, enums, integer checks, unique index.

Central error handling covers:
- Malformed JSON -> `400`
- Mongoose `ValidationError` -> `400` with individual messages
- Invalid ObjectId / `CastError` -> `400`
- Missing record -> `404`
- Duplicate unique value (`E11000`) -> `409`
- Inactive queue / invalid transition / protected queue delete -> `409`
- Unknown `/api/...` route -> `404` JSON
- Unexpected database/server failure -> `500` without exposing stack traces

## 11. Frontend design notes

- Single-page app with three views: Dashboard, Queues, Tokens.
- Central `state` object stores queues, tokens and dashboard stats.
- `loadData()` calls the API and re-renders; this is how the dashboard refreshes after operations.
- All dynamic text is escaped with `escapeHtml()` before insertion to reduce XSS risk.
- Token position/wait comes from the server, not from guessed frontend data.
- Loading, empty, filtered-empty, error, and retry states are included.
- Queue deletion performs a second explicit confirmation only when the server reports tokens.

## 12. Testing performed (honest status)

### Locally verified
The final audit ran **79 API/database checks**, **6 persistence checks**, and **20 browser checks** against isolated local MongoDB test databases; all passed. The API checks include:
- Health check and connected DB status
- Queue validation (missing fields, invalid minutes)
- Queue create/list/get/update/delete
- Token creation, numbering, queue positions and wait estimates
- Token list filters, get by ID
- Invalid token ID and invalid status value
- Allowed status transitions and timestamps
- Rejected invalid transition (`409`)
- Dashboard totals and recent tokens
- Protected queue delete (`409`) and cascade delete
- Individual token deletion
- Inactive queue token rejection
- Malformed JSON (`400`), unknown API route (`404`)

Additional checks:
- `node --check` passed for all backend JavaScript files.
- Frontend ID consistency check passed (all JS-referenced IDs exist in the HTML).
- CSS braces balanced and asset links present.
- JSON syntax of the Postman collection validated (21 requests, 6 folders).
- Headless Microsoft Edge executed 20 browser checks against an isolated local test database; all passed, including CRUD workflows, status transitions, filters, protected/cascade deletion, error/retry states, clean console, and mobile overflow.

### Verification status
- **MongoDB Atlas connection:** `/api/health` returned 200 with the configured `QueueLess` database connected; Atlas was used for connectivity/startup checks only, with no CRUD records written. This machine's local resolver still needs public DNS for Atlas SRV lookups, so `DNS_SERVERS` is supported and defaults to `8.8.8.8,8.8.4.4`.
- **Postman collection:** executed with Newman during the audit; 21 requests and 39 assertions passed with 0 failures.
- **Dependencies:** `npm audit --omit=dev` reports 0 vulnerabilities; full `npm audit` reports 2 moderate findings in the development-only nodemon/minimatch chain.
- **Security:** stored-XSS probe passed and sensitive paths returned 404, but authentication/authorization, rate limiting, CORS policy, and standard security headers are not implemented.
- **Production deployment:** not performed.
- **Windows port-conflict test:** BLOCKED because Windows allowed overlapping binds; this is not recorded as a pass.

Production deployment and production hardening remain unverified. The Windows port-conflict test remains blocked rather than passed.

## 13. Problems found and fixed

| Original issue | Fix |
| --- | --- |
| `.env` used `MONGO_DB_URL` but code required only `MONGO_URI` | `config/db.js` accepts either key |
| Token numbering used read-then-increment (race condition) | Atomic `$inc` counter on the queue + unique index |
| No dashboard API | Added `GET /api/dashboard/stats` with aggregation |
| No token retrieval endpoint | Added `GET /api/tokens/:id` |
| Any status could change to any status | Added explicit allowed transition map |
| Queue delete silently removed all tokens | Added explicit `?cascade=true` confirmation policy |
| No queue position or wait estimate | Added server-side calculation |
| Frontend lacked queue details/edit/status controls | Rebuilt views, modal, filters and forms |
| Service field naming did not match the assignment wording | Canonical `serviceDescription`, with `serviceName` accepted on input for compatibility |

## 14. Limitations

- No authentication or roles; anyone who can reach the API can modify data.
- No real-time push (Socket.IO); refresh is manual/action-based.
- Wait estimate assumes one service point and a fixed average service time.
- Token list is capped at 500 records by the API's `limit` guard; no pagination UI yet.
- Cascade delete is not wrapped in a transaction. Tokens are deleted first, then the queue, so a failure leaves the queue without tokens rather than orphan tokens. Atlas transactions could improve this.
- No automated frontend browser tests.

## 15. Likely viva questions and answers

**Q1. Why did you choose MongoDB for this project?**
Queues and tokens are document-like records, the schema can evolve, and MongoDB's atomic document updates work well for a per-queue token counter. Mongoose adds validation and references.

**Q2. What is the relationship between Queue and Token?**
One-to-many. A queue has many tokens. Each token stores `queue: ObjectId` referencing the Queue. `populate()` fetches queue details when listing tokens.

**Q3. How do you prevent duplicate token numbers?**
Two layers: an atomic `$inc` on `Queue.lastTokenNumber`, and a unique compound index on `{ queue, tokenNumber }`.

**Q4. What happens if two users request a token at the same moment?**
MongoDB applies both `$inc` operations atomically, producing two different numbers (for example 7 and 8). No read-then-write race exists.

**Q5. Why are token number gaps possible?**
If the counter is incremented but the token insert fails, the number is skipped. Uniqueness matters more than perfect contiguity.

**Q6. How do you prevent invalid status changes?**
`utils/tokenHelpers.js` defines allowed transitions. The PATCH route checks the current status and returns `409` with the allowed next statuses if the request is invalid.

**Q7. What is the queue position calculation?**
For a `Waiting` token, count waiting tokens in the same queue with a lower token number. `queuePosition = peopleAhead + 1`.

**Q8. How is estimated wait calculated?**
`(peopleAhead + number of tokens currently Serving) * averageServiceMinutes`. It is a single-server estimate, not a guarantee.

**Q9. How is queue deletion handled safely?**
If the queue has tokens, the API refuses deletion with `409 QUEUE_HAS_TOKENS`. The client must explicitly retry with `?cascade=true`, which deletes the tokens first and then the queue.

**Q10. What validation did you add?**
Required queue name/service, name length 2-80, description length 3-200, average minutes integer 1-240, customer name 2-80, optional contact max 120, valid ObjectIds, status enum and transition checks.

**Q11. How are errors handled centrally?**
`server.js` has one error middleware for JSON parse errors, Mongoose validation/cast errors, duplicate key errors, 404s, and 500s. Routes call `next(error)`.

**Q12. Why use timestamps?**
`timestamps: true` gives audit fields. Separate `servedAt`, `completedAt`, `cancelledAt` record when lifecycle events occurred.

**Q13. What indexes did you create and why?**
Unique queue+tokenNumber index for duplicate prevention; queue+status+tokenNumber for position/count queries; queue isActive+createdAt for listing. Indexes speed up reads and enforce constraints.

**Q14. How does the frontend refresh after an operation?**
After a successful create/update/delete/status change, `loadData()` fetches dashboard stats, queues and tokens again and re-renders the views.

**Q15. What would you improve for production?**
Authentication/roles, transactions for cascade operations, pagination, WebSocket updates, rate limiting, request logging, automated integration tests, and a more accurate wait model based on actual service history.

**Q16. Why is the API and frontend served from the same server?**
Express serves `public/` as static files, so the browser and API share an origin. This avoids CORS configuration and simplifies deployment for a mini project.

## 16. Final demonstration checklist

- [ ] `npm install` succeeds
- [ ] `.env` has a valid `MONGO_URI` or `MONGO_DB_URL`
- [ ] Atlas IP access allows the current network
- [ ] `npm run dev` prints `MongoDB connected` and the URL
- [ ] `/api/health` returns `database: "connected"`
- [ ] Create queue, issue two tokens, show numbers 1 and 2
- [ ] Show position and estimated wait
- [ ] Change status Waiting -> Serving -> Completed
- [ ] Show invalid transition returns 409
- [ ] Show dashboard totals and recent tokens
- [ ] Show queue delete is blocked, then cascade works
- [ ] Show Postman collection import and requests
- [ ] Show `.env` is ignored by Git
