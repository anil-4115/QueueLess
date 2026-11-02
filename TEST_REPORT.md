# QueueLess Audit and Test Report

**Project:** QueueLess - Smart Queue Management System  
**Project path:** `C:\Users\reyan\Downloads\QueueLess-project\QueueLess`  
**Audit date:** 2 November 2026  
**Latest verification run:** 2 November 2026, 19:26 local  
**Audit type:** Local functional, database, browser, persistence, Postman, startup, and basic security verification

## Final Verdict

**PASS for local/demo/course-project use.** The application starts, connects to MongoDB, serves the frontend, performs queue and token operations, preserves data across restarts, passes the Postman collection, and passes the browser workflow tests.

**Not production-ready as-is.** There is no authentication/authorization, CORS policy, rate limiting, or standard security-header middleware. Production deployment was not performed. The Windows-only port-conflict test is recorded as **BLOCKED**, not passed.

## Results Summary

| Area | Checks | Passed | Failed | Blocked | Result |
|---|---:|---:|---:|---:|---|
| API and database | 79 | 79 | 0 | 0 | PASS |
| Process-restart persistence | 6 | 6 | 0 | 0 | PASS |
| Headless Edge browser | 20 | 20 | 0 | 0 | PASS |
| Startup and failure handling | 4 | 3 | 0 | 1 | PASS with one blocked case |
| Postman collection via Newman | 21 requests / 39 assertions | 39 assertions | 0 | 0 | PASS |
| Stored-XSS probe | 1 scenario / 2 signals | 2 signals | 0 | 0 | PASS |
| Production dependency audit | 0 vulnerabilities | 0 | 0 | 0 | PASS |
| Full dependency audit | 2 moderate dev-only findings | 0 production | 2 dev | 0 | WARNING |
| Production deployment | 1 | 0 | 0 | 1 | NOT PERFORMED |

## Test Environment

- OS: Windows (`win32`)
- Node.js: `v24.16.0`
- npm: `11.13.0`
- Express: `5.3.0`
- Mongoose: `8.24.7`
- dotenv: `16.6.1`
- nodemon: `3.1.14` (development only)
- Local MongoDB: `127.0.0.1:27017`
- Atlas: configured `QueueLess` database, verified for connectivity/startup with no CRUD records written
- Browser: headless Microsoft Edge `156.0.4314.58` via Playwright Core
- Postman runner: Newman
- Main application port used manually: `5000`
- Isolated audit ports: `5610`, `5611`, `5615`-`5618`, `5620`-`5622`, `5625`

The project is not a Git repository, so Git tracking/ignore status could not be verified with Git commands.

## What Was Verified

### Startup and shutdown

- Atlas configuration starts the server on the configured port.
- `/api/health` returns HTTP 200 with `database=connected`.
- Local MongoDB configuration starts the server successfully.
- Graceful shutdown runs `server.close()` and `mongoose.disconnect()`.
- SIGINT handling was verified by emitting SIGINT inside the running child process after health was confirmed. A real Windows Ctrl+C keystroke was not automated.
- Unreachable MongoDB exits with code 1, prints a clear startup error, and does not begin listening.
- Port-conflict behavior is **BLOCKED**: a blocker held `0.0.0.0:5618`, but Windows allowed QueueLess to bind another address and log `QueueLess running at http://localhost:5618`. A reproducible `EADDRINUSE` was therefore not obtained.

### API and database

The API/database suite passed 79/79 checks, including:

- Health, root page, CSS, JavaScript, JSON 404, malformed JSON, oversized body, and unsupported method handling.
- Queue create, list, get, update, validation, alias field, invalid-id handling, and deletion rules.
- Token create, list, filter, limit, get, validation, active/inactive queue checks, and deletion.
- Token status transitions:
  - `Waiting -> Serving`
  - `Waiting -> Cancelled`
  - `Serving -> Completed`
  - Rejection of invalid transitions
  - Idempotent same-status updates
- Position and wait calculations, including one serving token affecting waiting customers.
- Token numbering per queue, unique `{queue, tokenNumber}` index, duplicate rejection at the database layer, and no reuse after deletion.
- 25 concurrent token creations produced 25 unique sequential token numbers.
- Protected queue deletion with `409 QUEUE_HAS_TOKENS`, then explicit `cascade=true` deletion with no orphaned tokens.
- Dashboard totals, status counts, recent-token limit, invalid-limit fallback, and direct database-count comparison.
- Central error handling and no observed unhandled rejections or uncaught exceptions.

### Persistence

The persistence suite passed 6/6 checks across an actual process restart:

- The same isolated database was reused after restart.
- Queue records survived.
- Token records, statuses, and numbering survived.
- Deleted records stayed deleted.
- Dashboard values after restart matched direct database counts.
- All audit-created records were removed.

### Browser/frontend

The headless Edge suite passed 20/20 checks:

- F01-F03: page load, empty states, API-connected status, and all navigation views.
- F04-F05: create and edit a queue through the form.
- F06-F08: issue tokens, calculated wait, dashboard refresh, and persisted API data.
- F09-F11: status dropdown transitions, position/wait changes, and dashboard updates.
- F12-F13: search, status filter, clear filters, and queue-details modal.
- F14-F16: deactivate/reactivate, token deletion, protected queue delete prompt, and cascade delete.
- F17: aborted API requests show useful error states and retry recovers.
- F18: no unexpected page errors, unexpected console errors, or API 5xx responses.
- F19-F20: 390x844 mobile layout has no horizontal overflow and no page errors.

Screenshots were captured at:

- `C:\Users\reyan\AppData\Local\Temp\opencode\queueless-audit\desktop.png`
- `C:\Users\reyan\AppData\Local\Temp\opencode\queueless-audit\mobile.png`

The automated browser checks passed. The model used for this audit cannot visually inspect image files, so the screenshots are available for human review but were not visually reviewed by the model.

### Postman

The collection passed when run with Newman:

- JSON parsed successfully: 21 requests and 6 folders.
- 21 requests executed.
- 39 assertions executed.
- 0 assertion failures.
- 0 requests failed.
- Average response time: 12 ms.
- The collection's expected `409`, `400`, and `404` error examples were handled correctly.
- The cleanup folder verified protected deletion, cascade deletion, and zero remaining test records.

### Security and exposure checks

- No real credentials were found in project source files. One credential-like MongoDB URI was found in `README.md`, and it is a placeholder example.
- `.env` exists and `.gitignore` contains `.env`. The project is not a Git repository, so actual tracked-file status could not be checked with Git.
- `/.env`, `/config/db.js`, `/package.json`, and `/../.env` all returned HTTP 404 through the running server.
- Stored-XSS probe: a queue and token were created with `<img onerror=...>` and `<script>` payloads. The browser did not execute the payload, and the text rendered literally.
- `X-Powered-By` is disabled.
- No CORS header is returned. `OPTIONS` returns 200 but without `Access-Control-Allow-Origin`.
- No `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, or `Referrer-Policy` headers are present.
- `npm audit --omit=dev`: `found 0 vulnerabilities`.
- `npm audit`: 2 moderate findings, both in the development-only nodemon/minimatch chain. No production dependency vulnerability was reported. The suggested forced fix would downgrade nodemon to `1.0.2`, a breaking change, so it was not applied.

## Defects and Fixes

| Finding | Type | Action | Verification |
|---|---|---|---|
| `/api/health` returned HTTP 500 because `server.js` called `getDbStatus` while `config/db.js` exported only `getDBStatus` | Real application defect | Added a `getDbStatus()` string wrapper while retaining `getDBStatus()` | Health now returns 200 with `database=connected` |
| Browser requested `/favicon.ico` and logged a 404 | Real minor frontend defect | Added `<link rel="icon" href="data:,">` to `public/index.html` | F18 console-clean check passed |
| Documentation claimed configurable `DNS_SERVERS`, but `server.js` hardcoded `8.8.8.8,8.8.4.4` before loading dotenv | Real code/documentation inconsistency | Added `DNS_SERVERS` parsing with the previous public-DNS default, and updated README/.env.example/PROJECT_LOG | Atlas health remained 200 after restart |
| First API audit run reported 77/79 due to a harness mapping bug | Test-harness defect, not an application defect | Corrected the harness, cleaned the first audit database, reran | 79/79 passed |
| Browser F14/F16 selectors matched both the queue card and hidden modal buttons | Test-harness defect | Scoped selectors to the visible queue card | F14/F16 passed |
| Browser F06 occasionally checked the row before the list refresh completed | Test-harness race | Wait for the token row to become visible | 20/20 passed |
| Windows allowed the port-conflict test to bind successfully | Environment blocker | Marked S14 as BLOCKED with the observed evidence | Recorded as blocked, not passed |

## Changes Made

- `config/db.js`: added `getDbStatus()` string wrapper for the health route.
- `server.js`: loads dotenv before DNS configuration and supports `DNS_SERVERS`; preserves `8.8.8.8,8.8.4.4` as the default.
- `public/index.html`: added an inline empty favicon to prevent the 404 console error.
- `README.md`: corrected verification counts and DNS documentation.
- `PROJECT_LOG.md`: replaced outdated Atlas/Postman "not verified" claims with the actual audit results.
- `.env.example`: clarified the DNS override behavior.
- `TEST_REPORT.md`: this report.

Backups of edited source files are stored outside the project:

- `C:\Users\reyan\AppData\Local\Temp\opencode\queueless-audit\backups\config-db.js.bak`
- `C:\Users\reyan\AppData\Local\Temp\opencode\queueless-audit\backups\server.js.bak`
- `C:\Users\reyan\AppData\Local\Temp\opencode\queueless-audit\backups\server.js.pre-dns.bak`
- `C:\Users\reyan\AppData\Local\Temp\opencode\queueless-audit\backups\index.html.bak`

## Test Data Cleanup

- All audit databases were isolated from the application database.
- No application CRUD records were written to Atlas; Atlas was used for connectivity/startup checks only.
- API audit database: `QueueLessAudit_20261102135515_c3fcfd`; records removed by persistence P07.
- Persistence database: same isolated audit database; P07 confirmed 0 remaining audit records.
- Browser database: `QueueLessE2E_20261102135526_6c3b56`; cleanup confirmed 0 remaining E2E queues/tokens.
- Postman database: `QueueLessPostman_20261102135537`; collection cleanup removed its queue/tokens.
- The XSS probe used its own isolated local database and removed its test records.
- A read-only check of all 15 isolated audit databases found 0 queues and 0 tokens in every database.
- Test databases were left empty rather than dropped.

## Evidence Files

All evidence is outside the project in `C:\Users\reyan\AppData\Local\Temp\opencode\queueless-audit\`:

- `api-audit-state.json`
- `persistence-results.json`
- `browser-results.json`
- `startup-results.json`
- `postman-summary.json`
- `security-summary.json`
- `desktop.png`
- `mobile.png`

## Reproduction Commands

Install and run the application:

```powershell
npm install
npm start
```

Development mode:

```powershell
npm run dev
```

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:5000/api/health
```

Audit harnesses:

```powershell
node "$env:TEMP\opencode\queueless-audit\api-audit.js"
node "$env:TEMP\opencode\queueless-audit\persistence-audit.js"
node "$env:TEMP\opencode\queueless-audit\browser-audit.js"
node "$env:TEMP\opencode\queueless-audit\startup-audit.js"
node "$env:TEMP\opencode\queueless-audit\postman-audit.js"
node "$env:TEMP\opencode\queueless-audit\xss-audit.js"
node "$env:TEMP\opencode\queueless-audit\validate-postman.js"
node "$env:TEMP\opencode\queueless-audit\atlas-check.js"
npm audit --omit=dev
npm audit
```

The CRUD, persistence, browser, Postman, and XSS harnesses set isolated local `MONGO_DB_URL` values and do not point at Atlas. The startup harness uses the configured Atlas database only for S11 startup/health; it performs no CRUD.

## Limitations and Remaining Work

1. **Production deployment:** not performed. Render/Vercel/other deployment and live URL testing remain manual.
2. **Security hardening:** add authentication/roles if required, CORS policy if cross-origin clients are needed, rate limiting, security headers, and request logging before production.
3. **Windows port-conflict behavior:** S14 is blocked, not failed. Retest on Linux/containers or with an IPv4/IPv6-specific bind if this behavior must be demonstrated.
4. **Real Ctrl+C:** graceful shutdown was tested by emitting SIGINT in-process, not by sending a real keyboard interrupt.
5. **Visual review:** screenshots were generated, but the audit model cannot inspect image files. A human should review them for final cosmetic acceptance.
6. **Accessibility and cross-browser coverage:** not tested with a screen reader or Firefox/Safari.
7. **Load testing:** concurrency was verified at 25 simultaneous token creations; broader load/performance testing was not performed.
8. **Atlas CRUD writes:** intentionally not tested to avoid altering the configured cloud database.
9. **Postman GUI:** the collection was executed with Newman, not the Postman desktop GUI.

## Final Answers

1. **Does the project start?** Yes. Local and Atlas configurations start successfully, and health returns HTTP 200.
2. **Does the frontend load?** Yes. The page is not blank, all navigation views work, and the 20-check browser suite passed.
3. **Does MongoDB work?** Yes. Local MongoDB was fully exercised; Atlas connectivity/startup was verified without writing CRUD records.
4. **Do queue operations work?** Yes. Create, list, get, update, validation, inactive state, protected delete, and cascade delete passed.
5. **Do token operations and rules work?** Yes. Issuing, numbering, filtering, status transitions, positions, waits, concurrency, and deletion passed.
6. **Is the dashboard accurate?** Yes. Dashboard totals and status counts matched direct database counts, including after restart.
7. **Does data persist?** Yes. Persistence passed 6/6 across an actual process restart.
8. **Does the Postman collection work?** Yes. 21 requests and 39 assertions passed with 0 failures.
9. **Are errors handled correctly?** Yes for the tested API cases. Invalid input, malformed JSON, oversized bodies, invalid IDs, bad transitions, duplicate keys, missing records, and unreachable database startup were handled without observed unhandled exceptions.
10. **Is it secure and production-ready?** No secrets were exposed, sensitive files were not served, and stored-XSS payloads did not execute. However, production hardening is incomplete, and production deployment was not performed.
11. **Final verdict:** **PASS for local/demo/course-project use, with documented limitations and one environment-blocked test.** Do not claim production readiness without deployment, authentication/authorization decisions, CORS/security-header hardening, rate limiting, and the remaining manual checks.
