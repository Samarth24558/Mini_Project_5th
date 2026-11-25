# ColdChain Ops — Cold-Chain Logistics Alert System

MERN application for refrigerated fleet operations. It builds on the supplied project models and shipment-management work; it does not replace the existing Shipment, Truck, Incident, Team, Assignment, AlertEvent or AuditLog data model.

## Included modules

1. **Fleet & shipment management** — truck registration, shipment creation, truck assignment, shipment status and delivery milestones.
2. **Temperature / telemetry monitoring** — temperature, humidity, door, fuel, brake and GPS fields; per-shipment history, latest readings and authenticated server-sent live telemetry events.
3. **Sensor and truck-travel simulation** — fleet managers can prepare 20 marked demo truck/shipment pairs from the Fleet directory before running a simulation. Demo shipments use five distinct routes; each run selects one truck from each route. It displays all five trucks and their separate routes on an OpenStreetMap map with a vertical lead-truck progress graph and posts GPS/sensor telemetry every two seconds. Each truck generates exactly four alerts: temperature breach, low fuel, brake problem, and simulated accident, routed to their respective response teams (20 alerts per run). Simulated records are marked `isSimulated: true`.
4. **Automatic incident detection** — configurable temperature range, sustained open-door, low-fuel and brake warning/failure detection. Every qualifying telemetry reading creates one incident per event type, including repeated alerts across readings for the same shipment.
5. **Alerts** — dashboard alert records and optional Gmail notifications to the assigned team's contact email.
6. **GPS visibility** — latitude/longitude saved with telemetry and links to open coordinates in Google Maps.
7. **Incident response** — create, acknowledge, progress, resolve, close and assign incidents to response teams.
8. **Response teams** — create specialist teams and maintain assignment history.
9. **Dashboard & reporting** — fleet/shipment/incident counts, recent telemetry, CSV exports and incident audit log.
10. **Authentication** — Clerk-protected API routes and persisted application profile/role.
11. **Record deletion** — managers/admins can permanently delete fleet, shipment, incident, team, telemetry, upload and history records; destructive actions confirm first and remove dependent records consistently.

## Stack

- React 18 + Vite
- Node.js + Express (ES modules)
- MongoDB Atlas + Mongoose
- Clerk authentication
- Gmail account with 2-Step Verification and an App Password (optional email notifications)

## Source organization by subject

The source is grouped into subject folders so the core concepts are easy to locate:

```text
backend/src/subjects/
  os/              bounded worker-pool scheduling
  dsa/             telemetry rules, ordered replay, CSV algorithms
  dbms/            MongoDB connection, schemas, indexes, transactions
  webTechnology/   Express server, routes, controllers, middleware

frontend/src/subjects/
  dsa/             route geometry and CSV/XLSX parsing
  webTechnology/   React entry point, dashboard, and styles
```

The backend's `src/server.js` remains as the stable startup entry point and forwards to the Web Technology server module. The subject folders express the primary responsibility; some Web Technology controllers call DBMS and DSA modules as part of normal application integration.

## Prerequisites

- Node.js LTS and npm
- MongoDB Atlas database
- Clerk application
- Optional: Gmail account with 2-Step Verification and an App Password for email notifications

## Setup

1. Copy `backend/.env.example` to `backend/.env` and fill in real backend credentials.
2. Copy `frontend/.env.example` to `frontend/.env` and set the Clerk publishable key and API URL.
3. In `backend/.env`, configure `MONGODB_URI`, `CLERK_PUBLISHABLE_KEY`, and `CLERK_SECRET_KEY`. Never put backend credentials in the frontend env file.
4. Set `CLIENT_URL` to your frontend origin. For multiple origins, use comma-separated exact origins.
5. Set `TEMP_MIN_C` and `TEMP_MAX_C` to the product-specific validated storage limits. The defaults (2–8°C) are demo defaults, not a substitute for cargo/manufacturer requirements.
6. Set `ADMIN_CLERK_USER_IDS` to your own Clerk user ID (and any other administrator IDs) before signing in. New profiles default to `pending_assignment` and cannot access operational routes until a fleet manager or administrator assigns a working role (for example `fleet_manager`, `driver`, `compliance_officer`, or `action_team_member`). Only explicitly configured Clerk IDs receive the `admin` role. Use **User access** to assign roles to pending users, then **Simulation access** to grant or revoke simulator permission for assigned users. Fleet managers and administrators have simulator access automatically. You can find the Clerk user ID in the Clerk Dashboard user record.
7. For email notifications, enable 2-Step Verification on the Gmail account, then create an App Password at `https://myaccount.google.com/apppasswords`. Set `GMAIL_USER` to that Gmail address and `GMAIL_APP_PASSWORD` to the generated password (not your regular Gmail password). Set `ALERT_FROM_EMAIL` to the same Gmail address (optionally with a display name), and `ADMIN_ALERT_EMAILS` to the addresses that should receive new-user role-assignment reminders.
8. On Windows, run `start.bat` from the project root to start the backend and frontend in separate terminal windows. It installs dependencies if needed; configure both `.env` files first.
8. To start the services manually, install and run the backend:

   ```bash
   cd backend
   npm install
   npm run seed:teams
   npm run dev
   ```

9. In another terminal install and run the frontend:

   ```bash
   cd frontend
   npm install
   npm run dev
   ```

9. Open `http://localhost:5173`, sign in with Clerk, create trucks and shipments, then use **Temperature & GPS** to submit a test reading or start the demo sensor.

### Upload and replay a telemetry dataset

In **Temperature & GPS**, select **Upload dataset (CSV / XLSX)**. CSV and `.xlsx` workbooks are supported; workbook uploads use the first worksheet. Each row must include the MongoDB ID of an existing shipment unless a shipment is selected in the sensor console. Upload rows are validated and saved by a bounded worker pool while preserving source-row numbers. Replay is claimed by one worker at a time, processes rows in timestamp order (source row as the tie-breaker), and evaluates every row through the same incident/alert workflow. A telemetry reading can create at most one incident for each event type, so a retried replay does not duplicate its incident. Original columns are retained with each telemetry reading.

Supported columns include `shipmentId`, `timestamp`, `temperature` or `Temperature_C`, `humidity` or `Humidity_Percent`, `doorStatus`, `fuelLevel` or `Fuel_Level_Percent`, `brakeStatus`, `latitude`, `longitude`, and `location`. For example:

```csv
shipmentId,timestamp,temperature,humidity,doorStatus,fuelLevel,brakeStatus,latitude,longitude,location
<existing-shipment-id>,2026-11-07T10:00:00Z,4.5,65,closed,82,normal,12.9716,77.5946,Bengaluru
```

Uploads are limited to 5 MB and 10,000 rows. The upload control is available to fleet managers, administrators, and compliance officers.

To seed the supplied `Cold_Chain_Logistics_Dataset (1).csv`, run `npm run seed:dataset` from `backend`; by default the script looks for the CSV one directory above the repository root. Pass a CSV path as an argument if it is stored elsewhere. The seed creates a clearly labeled demo truck and shipment, stores all original columns in Atlas, and leaves the dataset ready to replay from **Uploaded datasets & simulation**. The sole active app profile is assigned the fleet-manager role so it can operate the simulator.

## API overview

All `/api` business routes require a valid Clerk session.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | API / database health |
| POST / GET | `/api/users/sync`, `/api/users/me` | Sync/read Clerk profile |
| GET | `/api/users/pending` | List pending users for fleet managers/admins |
| GET | `/api/users` | List assigned users for simulator access management |
| PATCH | `/api/users/:id/role` | Assign a role to a pending user |
| PATCH | `/api/users/:id/simulation-access` | Grant or revoke simulation access |
| GET | `/api/dashboard` | Dashboard KPIs and recent activity |
| GET / POST | `/api/trucks` | Fleet list / register truck |
| PATCH / DELETE | `/api/trucks/:id` | Update a truck / permanently delete it with linked shipment and telemetry history |
| GET / POST | `/api/shipments` | Shipment list / create |
| GET / PUT / DELETE | `/api/shipments/:id` | Shipment details / update / permanently delete with linked operational history |
| GET / POST | `/api/telemetry` | Read telemetry / submit a sensor packet |
| DELETE | `/api/telemetry/:id` | Delete a reading and its generated incidents; deleting a reading from an upload deletes that dataset |
| DELETE | `/api/telemetry/uploads/:uploadId` | Delete an uploaded dataset and its telemetry and generated incidents |
| POST | `/api/telemetry/simulation/fleet` | Create or reuse 20 demo pairs; assign a route only to the selected demo truck |
| POST | `/api/telemetry/simulation/batch` | Save a simulated telemetry reading for one truck |
| GET | `/api/telemetry/latest` | Latest reading per shipment |
| GET | `/api/stream/telemetry` | Authenticated server-sent telemetry event stream |
| POST | `/api/telemetry/import` | Store up to 10,000 parsed CSV/XLSX telemetry rows |
| GET | `/api/telemetry/uploads` | List the signed-in user's uploaded datasets |
| POST | `/api/telemetry/uploads/:uploadId/simulate` | Replay the next batch of uploaded rows and run incident detection |
| GET / POST | `/api/incidents` | List / manually report incidents |
| PATCH / DELETE | `/api/incidents/:id` | Update an incident / delete it with linked alerts, assignments, and audit history |
| POST | `/api/incidents/:id/assign` | Assign a response team |
| GET | `/api/incidents/meta/alerts` | Alert delivery log |
| GET | `/api/incidents/meta/audit` | Incident audit trail |
| GET | `/api/incidents/meta/assignments` | Team assignment history |
| DELETE | `/api/incidents/meta/alerts/:id`, `/api/incidents/meta/audit/:id`, `/api/incidents/meta/assignments/:id` | Delete a selected alert, audit entry, or assignment record |
| GET / POST | `/api/teams` | List / create teams |
| PATCH / DELETE | `/api/teams/:id` | Update / delete a team and its assignments |
| DELETE | `/api/users/:id` | Admin-only deletion of an application profile and its owned uploads; does not delete the Clerk login |
| GET | `/api/reports/export?type=telemetry\|incidents\|shipments` | CSV export |

### Telemetry request example

```json
{
  "shipmentId": "EXISTING_MONGOOSE_SHIPMENT_OBJECT_ID",
  "temperature": 4.5,
  "humidity": 65,
  "doorStatus": "closed",
  "fuelLevel": 82,
  "brakeStatus": "normal",
  "location": { "latitude": 12.9, "longitude": 77.5, "label": "Optional location" },
  "isSimulated": true
}
```

## Incident rules

- Temperature below `TEMP_MIN_C` or above `TEMP_MAX_C` creates a temperature-breach incident.
- A live door-open reading creates an incident after the door has remained open for `DOOR_OPEN_THRESHOLD_SECONDS` (300 seconds by default). Simulated dataset replay uses `SIMULATED_DOOR_OPEN_THRESHOLD_SECONDS` (8 seconds by default) so the accelerated demo can exercise the same duration rule.
- Fuel below `LOW_FUEL_THRESHOLD` creates a low-fuel incident.
- Brake warning/failure creates a brake incident.
- Repeated qualifying readings are not deduplicated; each reading creates a separate incident and dashboard alert. A full demo fleet run creates 60 alerts (three alert types for each of 20 trucks). Configure notification email accordingly.
- An active team matching the alert type is assigned automatically. Alerts are emailed only to that team's configured email; if no matching active team or email exists, the alert remains in the dashboard without being emailed.
- Email is attempted when Gmail credentials and recipients are configured. Dashboard alerts remain stored when email is not configured.
- Response status follows `new → active/acknowledged → in progress → resolved → closed`; each state change, assignment, alert, and incident record is persisted together in a MongoDB transaction.

## Sprint 2 implementation and verification

The project keeps the approved MERN/MongoDB data model. MongoDB references are checked by application workflows, Mongoose schema constraints validate record shapes, and multi-record incident/workflow writes use MongoDB transactions. This is an intentional architecture choice instead of the relational/SQL wording in the generic E3 handbook section; run the app against a MongoDB replica set (such as Atlas) to exercise transaction behavior.

Run the focused automated tests and production build:

```powershell
cd backend
npm test
cd ..\frontend
npm test
npm run build
```

The tests cover bounded ingestion workers, CSV/XLSX parsing, timestamp-ordered replay evaluation, threshold and door-duration boundaries, specialist routing, Mongo transaction lifecycle handling, schema validation, incident transitions, role-based simulation access, and report CSV escaping. Live Atlas transaction behavior, Clerk role configuration, Gmail delivery, and deployment evidence still require environment-specific verification.

The automatic detection rules are a starting configuration. Validate threshold values and response policies for the cargo, sensor calibration, operating region, and applicable regulations before production use.

### Permanent deletion behavior

Delete actions require confirmation in the dashboard and are restricted by role. Deleting a truck or shipment cascades through related telemetry, incidents, alerts, assignments, audit entries, and any uploaded dataset containing those readings (including the other rows in that dataset). Deleting a team removes its assignment records and unassigns its incidents. Deleting a user removes the ColdChain application profile and owned uploads; shared audit/assignment history is retained with the user reference cleared. The external Clerk login is not deleted. The last active administrator and the signed-in user's own profile cannot be deleted. Deletions use MongoDB transactions, so the configured database must support transactions (MongoDB Atlas replica set).

## Production readiness checklist

This repository is a production-oriented implementation, **not a claim of production certification or a deployed service**. Before live operations:

- Rotate any credentials that may have been included in earlier local `.env` or example files. Keep real secrets only in secret management / deployment environment variables.
- Configure Clerk production keys, allowed origins, role assignments, and account lifecycle controls.
- Restrict CORS to actual production frontend origins; deploy behind HTTPS/TLS.
- Replace the in-memory per-process rate limiter and process-local telemetry event bus with shared infrastructure (such as Redis-backed rate limiting and pub/sub) if using multiple backend instances.
- Add monitoring, centralized structured logs, backups, restore drills, database access restrictions, and alert delivery monitoring.
- Configure a durable background queue for high-volume telemetry/email delivery; current alert email sending is synchronous and best suited to modest demo/initial workloads.
- Validate cold-chain thresholds, sensor calibration, alert escalation, deduplication windows, and GPS consent/privacy requirements with domain owners.
- Add automated integration/load/security tests, verify MongoDB indexes, and test failover/deployment in staging.
- Configure a real hardware gateway if using physical sensors. The included simulator is test data, not a live IoT integration.

## Data safety

The generated distribution excludes local `.env` files, `node_modules`, and build output. Use the provided `.env.example` templates. Never commit credentials.

## Container deployment (staging / single-host baseline)

1. Create `backend/.env` from `backend/.env.example` and fill every required secret.
2. Set `VITE_CLERK_PUBLISHABLE_KEY` and `VITE_API_BASE_URL` in the shell or root deployment environment. For a public deployment, the API URL must be the browser-reachable HTTPS API origin, not an internal Docker hostname.
3. Set `CLIENT_URL` to the browser-visible frontend origin.
4. Run `docker compose up --build -d` from the repository root.
5. Put a TLS-terminating reverse proxy / managed HTTPS ingress in front of the services before exposing them publicly.

The included Compose file is a single-host deployment baseline. It is not a substitute for a managed secret store, shared rate-limit store, queue, observability, database backups, or a multi-instance production architecture.
