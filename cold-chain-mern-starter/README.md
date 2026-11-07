# ColdChain Ops — Cold-Chain Logistics Alert System

MERN application for refrigerated fleet operations. It builds on the supplied project models and shipment-management work; it does not replace the existing Shipment, Truck, Incident, Team, Assignment, AlertEvent or AuditLog data model.

## Included modules

1. **Fleet & shipment management** — truck registration, shipment creation, truck assignment, shipment status and delivery milestones.
2. **Temperature / telemetry monitoring** — temperature, humidity, door, fuel, brake and GPS fields; per-shipment history, latest readings and authenticated server-sent live telemetry events.
3. **Sensor simulation** — dashboard simulator posts sample telemetry every five seconds; uploaded CSV datasets can also be replayed row-by-row through the same incident-detection pipeline. Simulated records are explicitly marked `isSimulated: true`.
4. **Automatic incident detection** — configurable temperature range, open-door, low-fuel and brake warning/failure detection. Active incidents are deduplicated per shipment and incident type.
5. **Alerts** — dashboard alert records and optional Resend email notifications to the assigned team's contact email.
6. **GPS visibility** — latitude/longitude saved with telemetry and links to open coordinates in Google Maps.
7. **Incident response** — create, acknowledge, progress, resolve, close and assign incidents to response teams.
8. **Response teams** — create specialist teams and maintain assignment history.
9. **Dashboard & reporting** — fleet/shipment/incident counts, recent telemetry, CSV exports and incident audit log.
10. **Authentication** — Clerk-protected API routes and persisted application profile/role.

## Stack

- React 18 + Vite
- Node.js + Express (ES modules)
- MongoDB Atlas + Mongoose
- Clerk authentication
- Resend (optional incident email)

## Prerequisites

- Node.js LTS and npm
- MongoDB Atlas database
- Clerk application
- Optional: Resend account and verified sender identity

## Setup

1. Copy `backend/.env.example` to `backend/.env` and fill in real backend credentials.
2. Copy `frontend/.env.example` to `frontend/.env` and set the Clerk publishable key and API URL.
3. In `backend/.env`, configure `MONGODB_URI`, `CLERK_PUBLISHABLE_KEY`, and `CLERK_SECRET_KEY`. Never put a Clerk secret, MongoDB URI, or Resend key in the frontend env file.
4. Set `CLIENT_URL` to your frontend origin. For multiple origins, use comma-separated exact origins.
5. Set `TEMP_MIN_C` and `TEMP_MAX_C` to the product-specific validated storage limits. The defaults (2–8°C) are demo defaults, not a substitute for cargo/manufacturer requirements.
6. Set `ADMIN_CLERK_USER_IDS` to your own Clerk user ID (and any other administrator IDs) before signing in. New profiles default to `driver`; only explicitly configured IDs receive the `admin` role. This avoids granting manager privileges to the first arbitrary public signup. You can find the Clerk user ID in the Clerk Dashboard user record.
7. Install and run the backend:

   ```bash
   cd backend
   npm install
   npm run seed:teams
   npm run dev
   ```

8. In another terminal install and run the frontend:

   ```bash
   cd frontend
   npm install
   npm run dev
   ```

9. Open `http://localhost:5173`, sign in with Clerk, create trucks and shipments, then use **Temperature & GPS** to submit a test reading or start the demo sensor.

### Upload and replay a telemetry CSV

In **Temperature & GPS**, select **Upload CSV dataset**. The CSV must include the MongoDB ID of an existing shipment in each row, unless a shipment is selected in the sensor console. Uploads are stored in MongoDB Atlas, then replayed in batches through the normal incident detection and alert workflow. Original CSV columns are retained with each telemetry reading.

Supported columns include `shipmentId`, `timestamp`, `temperature` or `Temperature_C`, `humidity` or `Humidity_Percent`, `doorStatus`, `fuelLevel` or `Fuel_Level_Percent`, `brakeStatus`, `latitude`, `longitude`, and `location`. For example:

```csv
shipmentId,timestamp,temperature,humidity,doorStatus,fuelLevel,brakeStatus,latitude,longitude,location
<existing-shipment-id>,2026-11-07T10:00:00Z,4.5,65,closed,82,normal,12.9716,77.5946,Bengaluru
```

CSV uploads are limited to 5 MB and 10,000 rows. The upload control is available to fleet managers, administrators, and compliance officers.

To seed the supplied `Cold_Chain_Logistics_Dataset (1).csv`, run `npm run seed:dataset` from `backend`; by default the script looks for the CSV one directory above the repository root. Pass a CSV path as an argument if it is stored elsewhere. The seed creates a clearly labeled demo truck and shipment, stores all original columns in Atlas, and leaves the dataset ready to replay from **Uploaded datasets & simulation**. The sole active app profile is assigned the fleet-manager role so it can operate the simulator.

## API overview

All `/api` business routes require a valid Clerk session.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | API / database health |
| POST / GET | `/api/users/sync`, `/api/users/me` | Sync/read Clerk profile |
| GET | `/api/dashboard` | Dashboard KPIs and recent activity |
| GET / POST | `/api/trucks` | Fleet list / register truck |
| PATCH / DELETE | `/api/trucks/:id` | Update / remove an unused truck |
| GET / POST | `/api/shipments` | Shipment list / create |
| GET / PUT / DELETE | `/api/shipments/:id` | Shipment details / update / delete |
| GET / POST | `/api/telemetry` | Read telemetry / submit a sensor packet |
| GET | `/api/telemetry/latest` | Latest reading per shipment |
| GET | `/api/stream/telemetry` | Authenticated server-sent telemetry event stream |
| POST | `/api/telemetry/import` | Store up to 10,000 parsed CSV telemetry rows |
| GET | `/api/telemetry/uploads` | List the signed-in user's uploaded datasets |
| POST | `/api/telemetry/uploads/:uploadId/simulate` | Replay the next batch of uploaded rows and run incident detection |
| GET / POST | `/api/incidents` | List / manually report incidents |
| PATCH | `/api/incidents/:id` | Update incident state/details |
| POST | `/api/incidents/:id/assign` | Assign a response team |
| GET | `/api/incidents/meta/alerts` | Alert delivery log |
| GET | `/api/incidents/meta/audit` | Incident audit trail |
| GET | `/api/incidents/meta/assignments` | Team assignment history |
| GET / POST | `/api/teams` | List / create teams |
| PATCH | `/api/teams/:id` | Update team |
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
- Door open creates a door incident.
- Fuel below `LOW_FUEL_THRESHOLD` creates a low-fuel incident.
- Brake warning/failure creates a brake incident.
- Existing unresolved incidents of the same type for the same shipment prevent duplicate incident creation.
- A matching active response team is assigned automatically where available.
- Email is attempted only when both Resend settings and a team contact email exist. Dashboard alerts remain stored when email is not configured.

The automatic detection rules are a starting configuration. Validate threshold values and response policies for the cargo, sensor calibration, operating region, and applicable regulations before production use.

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
