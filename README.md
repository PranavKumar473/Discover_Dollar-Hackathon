# SurplusLink — Food Recovery & Volunteer Dispatch

A zero-build, full-stack web application connecting food donors (restaurants/cafes) with volunteer drivers to collect surplus food before it goes to waste. Built with Node.js, Express, better-sqlite3, and a single-file Vanilla JS frontend styled with Tailwind CSS via CDN.

---

## 1. What Was Built

SurplusLink enables:
- **Donors** to post cooked surplus food with specified quantities (whole kg) and strict pickup windows, and track volunteer claims on their donations.
- **Volunteers** to inspect available surplus donations in their permitted geographic zones, reserve portions within vehicle capacity and pickup windows, and mark items as collected or cancelled.
- **Independent Simulation Clock**: All timing logic relies strictly on an in-app simulated clock (`meta.clock`) that can be advanced forward by users, ensuring reproducible testing and zero reliance on real system time.
- **Strict Conservation & Food Balance Audit**: Tracks food across six categories (`Listed`, `Collected`, `Missed`, `Wasted`, `In progress`, `Still open`). The identity equation `Listed = Collected + Missed + Wasted + In progress + Still open` holds true across every operation.
- **Atomic Concurrency Guarantee**: State modifications run inside synchronous SQLite transactions (`db.transaction(...).immediate()`), ensuring that if multiple volunteers race for the last remaining kilograms, at most one can succeed.

---

## 2. Tech Stack & Directory Layout

- **Runtime & Backend**: Node.js (CommonJS), Express 4.22
- **Database**: SQLite 3 via `better-sqlite3` (WAL mode enabled, foreign keys ON, stored in `./data.db` or `:memory:`)
- **Frontend**: Single file `public/index.html` with Vanilla JS, custom CSS variables, and Tailwind CSS via CDN. Includes an inline fallback stylesheet for 100% offline usability.
- **Test Runner**: Node's built-in test runner (`node:test`) and native `fetch`. Zero external testing dependencies.

```text
.
├── public/
│   └── index.html        # Single-file UI (Vanilla JS + Tailwind CDN + fallback CSS)
├── src/
│   ├── app.js            # Express app with routes, role auth, transactions, error handling
│   ├── db.js             # SQLite schema, foreign keys, CHECK constraints, seed loader
│   ├── rules.js          # Pure business logic, claim validation (Rules 1-7), dashboard identity
│   └── server.js         # Entrypoint (listens on process.env.PORT || 3000, binds 127.0.0.1)
├── test/
│   ├── api.test.js       # Integration & concurrency tests with native fetch
│   ├── db.test.js        # Schema, constraints, seeding, and nextId tests
│   └── rules.test.js     # Unit tests for all rule boundaries, timing, and dashboard identity
├── seed.json             # Initial seed dataset (clock, donors, volunteers, donations)
├── AI_USAGE.md           # Mandatory AI disclosure and architectural decision log
└── README.md             # Project documentation, setup, API specs, and curl examples
```

---

## 3. Quick Start & Setup

### Prerequisites
- Node.js (v18+, v20+, or v26+)
- npm

### Installation
```bash
npm install
```
*(Note: If npm warns about `better-sqlite3` install scripts, run `npm install-scripts approve better-sqlite3`)*

### Running the Test Suite
Executes all 40 automated tests across business rules, database constraints, API lifecycles, and concurrency races:
```bash
npm test
```

### Starting the Server
**Production Mode:**
```bash
npm start
```

**Development Mode (Auto-reload on file edits):**
```bash
npm run dev
```

Open your browser to:
👉 **http://127.0.0.1:3000** (or **http://localhost:3000**)

---

## 4. API Specification & Status Codes

All requests and responses use JSON. Client identity is provided via the `X-Actor-Id` header.

### Error Status Codes:
- `400 Bad Request`: Missing `X-Actor-Id` header, malformed body (non-integer kg, invalid datetime format, empty strings).
- `403 Forbidden`: Actor not found, wrong role (volunteer accessing donor routes), or actor modifying another user's resource.
- `404 Not Found`: Target donation or claim ID does not exist.
- `409 Conflict`: State transitions invalid (claiming non-active, collecting outside pickup window, cancelling too late).
- `422 Unprocessable Entity`: Rule violations on claim (`{ errors: [{ rule: 1..7, message }] }`) or posting, moving clock backwards.

### Endpoints Overview:

| Method | Endpoint | Caller | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/people` | Public | List all donors and volunteers with their permitted zones |
| `GET` | `/api/clock` | Public | Get current simulated clock time |
| `POST` | `/api/clock` | Public | Advance the simulated clock forward (`{ now: "YYYY-MM-DDTHH:MM" }`) |
| `GET` | `/api/dashboard` | Public | Get aggregated metrics, balance identity, and per-person stats |
| `GET` | `/api/donations` | Donor | List donor's own donations with remaining kg and nested claims |
| `POST` | `/api/donations` | Donor | Post new surplus food (`{ description, quantity_kg, pickup_from, pickup_until }`) |
| `POST` | `/api/donations/:id/cancel` | Donor | Cancel an open donation that has no active/collected claims |
| `GET` | `/api/donations/open` | Volunteer | List all OPEN donations in volunteer's authorized zones |
| `POST` | `/api/donations/:id/claims` | Volunteer | Reserve kg with planned pickup time (`{ kg, planned_at }`) |
| `GET` | `/api/claims` | Volunteer | List volunteer's own claims with `can_collect` and `can_cancel` flags |
| `POST` | `/api/claims/:id/collect` | Volunteer | Mark an active claim as COLLECTED (must be inside pickup window) |
| `POST` | `/api/claims/:id/cancel` | Volunteer | Cancel an active claim (must be strictly before planned pickup time) |

---

## 5. Ready-to-Run `curl` Examples

### 1. Inspect Simulation Clock
```bash
curl -s http://127.0.0.1:3000/api/clock
```

### 2. Advance Simulation Clock
```bash
curl -s -X POST http://127.0.0.1:3000/api/clock \
  -H "Content-Type: application/json" \
  -d '{"now":"2026-03-10T15:30"}'
```

### 3. Check Food Balance & Dashboard
```bash
curl -s http://127.0.0.1:3000/api/dashboard
```

### 4. Donor Posts a New Surplus Donation (Actor: D1 - Spice Garden)
```bash
curl -s -X POST http://127.0.0.1:3000/api/donations \
  -H "Content-Type: application/json" \
  -H "X-Actor-Id: D1" \
  -d '{
    "description": "Leftover rice and dal containers",
    "quantity_kg": 18,
    "pickup_from": "2026-03-10T18:00",
    "pickup_until": "2026-03-10T21:00"
  }'
```

### 5. Volunteer Claims Food (Actor: V1 - Rhea, Zone NORTH & EAST)
```bash
curl -s -X POST http://127.0.0.1:3000/api/donations/DN1/claims \
  -H "Content-Type: application/json" \
  -H "X-Actor-Id: V1" \
  -d '{
    "kg": 15,
    "planned_at": "2026-03-10T18:30"
  }'
```

### 6. Volunteer Cancels Claim (Actor: V1)
```bash
curl -s -X POST http://127.0.0.1:3000/api/claims/C1/cancel \
  -H "Content-Type: application/json" \
  -H "X-Actor-Id: V1"
```

### 7. Volunteer Marks Claim as Collected (Actor: V1)
*(Only valid if simulation clock is between `pickup_from` and `pickup_until`)*
```bash
curl -s -X POST http://127.0.0.1:3000/api/claims/C1/collect \
  -H "Content-Type: application/json" \
  -H "X-Actor-Id: V1"
```

---

## 6. Key Assumptions & Design Decisions

1. **Rule 2 Capacity**: Capacity is enforced per individual claim trip, not as a lifetime aggregate, matching the physical reality of vehicle trip capacity.
2. **Rule 7 Clashes**: Compares planned times only against the same volunteer's `ACTIVE` or `COLLECTED` claims. `CANCELLED` and `MISSED` claims do not block new claims. Exactly 60 minutes apart is allowed; less than 60 minutes is rejected.
3. **Derived State Principle**: Store raw facts only. Donation status (`OPEN`, `FULLY_CLAIMED`, `EXPIRED`, `CANCELLED`) and `remaining_kg` are calculated dynamically on read from raw donation records and active claims. Only claim status is persisted (`ACTIVE`, `COLLECTED`, `CANCELLED`, `MISSED`) because collection and expiration are historical events.
4. **Time & Calendar Arithmetic**: All times are formatted strictly as `YYYY-MM-DDTHH:MM` with round-trip verification via `Date.UTC` to catch impossible calendar days (e.g. Feb 30). Interval calculations append `:00Z` to guarantee daylight saving time shifts never introduce drift.
5. **No System Time Dependency**: Real `new Date()` or `Date.now()` without arguments is never called anywhere in the business logic or database layers.
6. **Seed Id Generation**: Initial seed IDs use string prefixes (`D1`, `V1`, `DN1`). Newly created entities generate monotonically increasing numeric suffixes (`DN6`, `DN7`... and `C1`, `C2`...) inside the write transaction, guaranteeing collision-free IDs without gaps.

---

## 7. Limitations & Future Extensions

- **Distance & Routing**: Zones are treated as discrete categorical labels. Real-world dispatch could incorporate GPS coordinates or road routing times.
- **Authentication**: Relies on `X-Actor-Id` headers for persona simulation during evaluation. In production, this would be backed by JWTs or session cookies.
- **Push Updates**: The UI polls via a Refresh button and on user actions. Production systems could stream updates via Server-Sent Events (SSE) or WebSockets.
