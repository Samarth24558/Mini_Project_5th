# Sprint 2 implementation status

## Engine coverage

| Engine | Implementation | Automated verification |
|---|---|---|
| E1 — ingestion and scheduling | CSV/XLSX parsing, bounded row ingestion, row-level validation, chronological batched replay, single-worker replay lease, progress tracking, and per-reading idempotency. | Frontend parser tests and backend worker/replay tests. Live API/database replay still needs an Atlas run. |
| E2 — breach detection | Configurable inclusive temperature limits, severity classification, sustained door-open duration, fuel/brake rules, specialist response routing, and alert delivery records. | Temperature boundary/severity, door duration, simulated duration, and routing tests. |
| E3 — database and incident records | MongoDB/Mongoose remains the approved MERN storage architecture. References are verified by application workflows, schema constraints are validated, incident/alert/assignment/audit writes are transactional, and telemetry-linked incidents have a unique idempotency index. | Schema and transaction-wrapper tests. Confirm transactions and index creation against the target Atlas replica set before the demo. |
| E4 — dashboard and workflow | Dashboard incident management, restricted forward status transitions, team assignment history, transactional audit events, CSV reports with formula-injection protection, and role-based API access. | Status-transition, CSV report, and simulation-access tests; frontend production build. |

## Architecture note

The handbook’s generic E3 section describes relational tables and SQL. This implementation deliberately retains MongoDB/Mongoose to match the approved MERN project design. It does not claim SQL foreign keys: relationship existence is checked in application workflows, Mongoose validates document constraints, and multi-document changes use MongoDB transactions. The target database must support transactions (MongoDB Atlas replica set or equivalent).

## Local verification

Run from the project root:

```powershell
cd backend
npm test
cd ..\frontend
npm test
npm run build
```

The local automated suite does not require live email credentials or a database connection. Before presenting Gate 3 evidence, run the app with the approved Atlas, Clerk, and (if required) Gmail configuration; capture the test output and demonstrate a valid import/replay, a breach and team assignment, status/audit changes, and report export. No physical IoT sensor or GPS hardware has been tested.

At the last local run, all 23 backend tests and 3 frontend tests passed, the Vite production build completed, and `npm audit` reported zero vulnerabilities. The build emits a separate ExcelJS chunk for on-demand XLSX imports.

## Production limitations

- The telemetry event bus and rate limiter are process-local; use shared infrastructure for multiple backend instances.
- Email delivery is synchronous and is not a durable high-volume notification queue.
- Configure and validate temperature, low-fuel, and door-duration limits against the actual cargo and sensor policy.
- Configure HTTPS, least-privilege database access, backups, restore drills, monitoring, and staging validation before live operation.
