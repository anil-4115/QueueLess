# QueueLess — Smart Queue Management System

A beginner-friendly, full-stack queue and digital token management system built with **Node.js**, **Express**, **Mongoose**, **MongoDB Atlas** and vanilla **HTML/CSS/JavaScript**.

## Features implemented

### Dashboard
- Live totals for queues, waiting tokens, serving tokens, completed tokens and completed-today count
- "Recent tokens" with status, queue, position/wait context and timestamps
- Queue snapshot with "Call next" shortcut
- Auto-refresh on actions and a manual Refresh button

### Queue management
- Create a queue with name, service description and average service time (minutes)
- List, view details, edit, activate/deactivate, and delete queues
- Safe deletion: if a queue still has tokens, deletion is blocked unless you explicitly confirm cascade deletion
- Input validation and clear error messages

### Digital token management
- Issue a token to an active queue with customer name and optional contact details
- **Atomic/concurrency-safe sequential numbering** per queue using `Queue.lastTokenNumber` with `$inc` (see concurrency notes)
- Token statuses: `Waiting`, `Serving`, `Completed`, `Cancelled`
- **Controlled status transitions** (e.g. `Waiting -> Serving -> Completed`, or `-> Cancelled` at allowed stages)
- Per-token **queue position** and **estimated waiting time** (simple single-server estimate)
- Filter tokens by queue and status, search by customer/token number

### Backend
- REST API with consistent JSON (`{ success: true/false, message, data }`)
- Mongoose models with validation, timestamps, indexes and `Queue`<->`Token` references
- Centralized error handling for validation, invalid IDs, duplicates, bad JSON and unknown API routes
- Dashboard aggregation endpoint

### Frontend
- Clean, responsive dashboard with QueueLess branding and navigation
- Forms with client-side validation, loading/empty states and toast notifications
- All data loaded from the database (no hardcoded fake data)

## Tech stack
- **Backend:** Node.js, Express 5, Mongoose 8
- **Database:** MongoDB Atlas (or local MongoDB for testing)
- **Frontend:** HTML5, CSS3, Vanilla JavaScript (CommonJS on the server)

## Prerequisites
- [Node.js](https://nodejs.org/) 18 or newer
- [npm](https://www.npmjs.com/) (comes with Node)
- A [MongoDB Atlas](https://www.mongodb.com/atlas) account, or a local MongoDB instance

## Setup instructions

### 1) Install dependencies
Open the project folder in VS Code and run:
```bash
npm install
```

### 2) Configure environment variables
```bash
# Windows PowerShell
Copy-Item .env.example .env

# macOS/Linux
cp .env.example .env
```

Edit `.env` and set `MONGO_URI` to your MongoDB Atlas connection string:
```env
MONGO_URI=mongodb+srv://YOUR_USERNAME:YOUR_PASSWORD@YOUR_CLUSTER.mongodb.net/QueueLess?retryWrites=true&w=majority&appName=QueueLess
PORT=5000
```

> **Important:** Never commit `.env`. If your database password contains special characters (`@`, `#`, `/`, etc.), URL-encode them. The app also accepts `MONGO_DB_URL` as a fallback (useful if your environment already uses that key).

Optional: `DNS_SERVERS` overrides the default public DNS servers (`8.8.8.8,8.8.4.4`) used for Atlas SRV lookups. Set it only if Node prints `querySrv ECONNREFUSED` even though `nslookup` works:
```env
DNS_SERVERS=8.8.8.8,1.1.1.1
```

### 3) Allow network access in MongoDB Atlas
1. Log into [MongoDB Atlas](https://www.mongodb.com/atlas).
2. Go to **Security → Network Access**.
3. Click **Add IP Address → Add Current IP Address** (or add `0.0.0.0/0` only for short-term demos).
4. Create a database user under **Security → Database Access** with read/write permissions.

### 4) Run the application
```bash
# Development (auto-restart)
npm run dev

# Production
npm start
```
Open [http://localhost:5000](http://localhost:5000) in your browser.

## API documentation

All endpoints return JSON. Base URL: `http://localhost:5000`

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Health check (includes DB connection status) |
| `GET` | `/api/queues` | List all queues with live token counts |
| `POST` | `/api/queues` | Create a queue |
| `GET` | `/api/queues/:id` | Get queue details with counts |
| `PUT` | `/api/queues/:id` | Update queue (name, serviceDescription, averageServiceMinutes, isActive) |
| `DELETE` | `/api/queues/:id` | Delete a queue (blocked if tokens exist unless `?cascade=true`) |
| `GET` | `/api/tokens` | List tokens. Filters: `?queueId=<id>&status=Waiting&limit=200` |
| `GET` | `/api/tokens/:id` | Get a single token with queue position and estimated wait |
| `POST` | `/api/tokens` | Issue a token (`customerName`, `queueId`, optional `customerContact`) |
| `PATCH` | `/api/tokens/:id/status` | Update token status (enforces allowed transitions) |
| `DELETE` | `/api/tokens/:id` | Delete a token |
| `GET` | `/api/dashboard/stats` | Dashboard totals and recent tokens (`?recentLimit=8`) |

### Example requests (Postman/curl)

**Create a queue**
```http
POST http://localhost:5000/api/queues
Content-Type: application/json

{
  "name": "General Consultation",
  "serviceDescription": "Doctor appointment",
  "averageServiceMinutes": 5
}
```

**Issue a token**
```http
POST http://localhost:5000/api/tokens
Content-Type: application/json

{
  "customerName": "Riya Sharma",
  "customerContact": "9876543210",
  "queueId": "PASTE_REAL_QUEUE_OBJECT_ID"
}
```

**Update token status**
```http
PATCH http://localhost:5000/api/tokens/PASTE_TOKEN_OBJECT_ID/status
Content-Type: application/json

{
  "status": "Serving"
}
```
Allowed statuses: `Waiting`, `Serving`, `Completed`, `Cancelled`. Not every transition is allowed (the API returns `409` with `code: "INVALID_STATUS_TRANSITION"` if invalid).

**Delete a queue with tokens (safe policy)**
```http
DELETE http://localhost:5000/api/queues/PASTE_QUEUE_OBJECT_ID?cascade=true
```

### Expected response examples

Create queue (`201`):
```json
{
  "success": true,
  "message": "Queue created successfully.",
  "data": {
    "_id": "66f1c2a9e4b0a123456789ab",
    "name": "General Consultation",
    "serviceDescription": "Doctor appointment",
    "averageServiceMinutes": 5,
    "isActive": true,
    "lastTokenNumber": 0,
    "createdAt": "2026-11-02T10:00:00.000Z",
    "updatedAt": "2026-11-02T10:00:00.000Z"
  }
}
```

Issue token (`201`):
```json
{
  "success": true,
  "message": "Token #1 issued to Riya Sharma.",
  "data": {
    "_id": "66f1c2a9e4b0a123456789ac",
    "tokenNumber": 1,
    "customerName": "Riya Sharma",
    "customerContact": "9876543210",
    "status": "Waiting",
    "queue": {
      "_id": "66f1c2a9e4b0a123456789ab",
      "name": "General Consultation",
      "serviceDescription": "Doctor appointment",
      "averageServiceMinutes": 5,
      "isActive": true
    },
    "queuePosition": 1,
    "peopleAhead": 0,
    "estimatedWaitMinutes": 0,
    "issuedAt": "2026-11-02T10:01:00.000Z"
  }
}
```

Invalid transition (`409`):
```json
{
  "success": false,
  "code": "INVALID_STATUS_TRANSITION",
  "message": "Cannot change status from Completed to Serving.",
  "currentStatus": "Completed",
  "allowedNextStatuses": []
}
```

Protected queue delete (`409`):
```json
{
  "success": false,
  "code": "QUEUE_HAS_TOKENS",
  "message": "This queue has 2 token(s). Retry with ?cascade=true to delete the queue and all of its tokens.",
  "tokenCount": 2
}
```

Dashboard (`200`):
```json
{
  "success": true,
  "data": {
    "totals": {
      "queues": 1,
      "activeQueues": 1,
      "waiting": 2,
      "serving": 1,
      "completed": 4,
      "cancelled": 0,
      "totalTokens": 7,
      "completedToday": 1
    },
    "recentTokens": ["...populated token objects..."]
  }
}
```

## Database design

- **Queue** (`models/Queue.js`): `name`, `serviceDescription`, `averageServiceMinutes`, `isActive`, `lastTokenNumber`, `timestamps`. Indexed by `isActive` + `createdAt`.
- **Token** (`models/Token.js`): `tokenNumber`, `customerName`, `customerContact`, `queue` (ref `Queue`), `status`, `issuedAt`, `servedAt`, `completedAt`, `cancelledAt`, `timestamps`. Unique index `{ queue: 1, tokenNumber: 1 }`, compound index `{ queue: 1, status: 1, tokenNumber: 1 }`.

## Concurrency & limitations (be honest for viva)
- **Sequential token numbers:** Implemented using `findOneAndUpdate` with `$inc` on `Queue.lastTokenNumber` (atomic at the MongoDB document level). This is safe against races in normal conditions and prevents duplicate token numbers within a queue (enforced by a unique index).
- **Scaling limitation:** A highly sharded cluster or extreme cross-shard contention needs stronger strategies (e.g. a dedicated counter collection, transactions). For a classroom assignment this approach is correct and demonstrable.
- **Wait-time estimate:** Assumes a single service point: `(people ahead + tokens currently Serving) * averageServiceMinutes`. If multiple staff members serve a queue, actual wait times will differ.
- **Auth/roles:** Not implemented (no login). This matches the assignment scope.

## Response formats

Success:
```json
{
  "success": true,
  "message": "Queue created successfully.",
  "data": { "...": "..." }
}
```

Error:
```json
{
  "success": false,
  "message": "Queue name is required."
}
```
Common status codes: `200` OK, `201` Created, `400` validation/invalid ID/bad JSON, `404` missing record/route, `409` conflict (inactive queue, invalid transition, protected delete, duplicate), `500` unexpected server/database error.

## Testing with a browser and Postman

### Browser walkthrough (demonstrate in viva)
1. Open `http://localhost:5000`.
2. Go to **Queues** and create `General Consultation`.
3. Go to **Tokens** and issue a token for `Riya Sharma`.
4. Open **Queues → Details** to show counters and token list.
5. Go to **Tokens**, change status `Waiting → Serving`, then `Serving → Completed`.
6. Show the dashboard totals and recent tokens.
7. Try deleting the queue without cascade: it is blocked because tokens exist.
8. Confirm cascade deletion and verify the dashboard updates.

### Postman walkthrough
1. Open Postman → **Import** → choose `QueueLess.postman_collection.json`.
2. The collection variable `baseUrl` is pre-set to `http://localhost:5000`.
3. Start the server with `npm run dev`.
4. Run the **Queues → Create queue** request; it automatically saves `queueId`.
5. Run **Tokens → Create token**; it automatically saves `tokenId`.
6. Run the status requests in order. The invalid-transition request intentionally expects `409`.
7. Run the **Cleanup** folder last (it expects the protected `409`, then the cascade delete `200`).

If you prefer manual requests, use the example bodies above and paste the returned `_id` values into the URL.

## Verification status

- Verified locally against a real local MongoDB instance: 79 API/database checks, 6 process-restart persistence checks, and 20 headless Microsoft Edge browser checks passed.
- Verified MongoDB Atlas connectivity/startup without CRUD writes: `/api/health` returned 200 and the configured database connected successfully.
- Verified Postman collection via Newman: 21 requests and 39 assertions passed with 0 failures.
- Verified startup/failure handling: Atlas startup, local startup, graceful SIGINT shutdown, and unreachable-database failure passed. The Windows port-conflict case is marked blocked because overlapping IPv4/IPv6 binds prevented a reproducible `EADDRINUSE`.
- **Not verified:** production deployment; no public deployment was performed.

## Deployment (Render example)

1. Push the project to GitHub. Do **not** commit `.env`.
2. Create a new **Web Service** in Render and connect the repository.
3. Build command: `npm install`
4. Start command: `npm start`
5. Add environment variable `MONGO_URI` with your Atlas connection string and `NODE_ENV=production`.
6. In MongoDB Atlas, add the Render outbound IPs (or temporarily `0.0.0.0/0` for a demo).
7. Deploy, then open `https://YOUR-APP.onrender.com/api/health` to confirm the database is connected.
8. Open the root URL to use the frontend.

Railway/Heroku follow the same pattern: `npm install`, `npm start`, configure `MONGO_URI`, allow the host IP in Atlas.

## Assignment checklist

| Requirement | Implemented in | How to demonstrate |
| --- | --- | --- |
| 1. MongoDB database and collections | `models/Queue.js`, `models/Token.js` | Show `queueless` database and `queues`/`tokens` collections in Atlas or Compass |
| 2. Node.js + Express app | `server.js`, `routes/` | Run `npm start`; show server startup log |
| 3. Mongoose connection | `config/db.js` | Show `MongoDB connected: ...`; call `/api/health` |
| 4. CRUD operations | Queue routes, token routes | Create/read/update/delete a queue and token in Postman/browser |
| 5. Validation and errors | Models + route checks + error middleware | Send missing fields, invalid ID, invalid status, duplicate/invalid transition |
| 6. Browser and Postman testing | Frontend + Postman collection | Run the walkthroughs above |
| 7. Deployment readiness | `.env.example`, `README.md`, `.gitignore` | Show env secrets are not committed; deploy to a host |
| A. Dashboard | `routes/dashboardRoutes.js`, dashboard UI | Show totals, recent tokens, refresh |
| B. Queue management | `routes/queueRoutes.js`, Queues view | Create, list, details, edit, delete policy |
| C. Digital tokens | `routes/tokenRoutes.js`, Tokens view | Create token, sequential number, status flow, position/wait |
| D. MongoDB design | Models, indexes, atomic `$inc` counter | Explain references, unique compound index, concurrency |
| E. REST API | All routes | Show endpoint table and JSON status codes |
| F. Frontend | `public/` | Responsive UI, loading/empty/error states, API-connected forms |
| G. Docs/tests | `README.md`, `PROJECT_LOG.md`, Postman collection | Open and explain during viva |

## Quick command reference
```bash
npm install          # install dependencies
npm run dev          # start with nodemon
npm start            # start normally
```


## Troubleshooting
| Issue | Fix |
| --- | --- |
| `MONGO_URI is missing` | Copy `.env.example` to `.env` and add your connection string. |
| `querySrv ECONNREFUSED` / SRV DNS errors | Add `DNS_SERVERS=8.8.8.8,1.1.1.1` to `.env`, restart, or switch to the standard `mongodb://` Atlas connection string. |
| `IP not whitelisted` | Add your current IP to MongoDB Atlas Network Access. |
| `EADDRINUSE` | Another process is using the port. Change `PORT` in `.env`. |
| `Token number conflict` | Rare race condition. Retry issuing the token (the API returns a clear message). |
| Queue delete blocked | This is the safe policy. Use `DELETE /api/queues/:id?cascade=true` to remove the queue and all its tokens. |
