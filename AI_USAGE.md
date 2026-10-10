# AI Usage Disclosure (`AI_USAGE.md`)

This document discloses how AI tools were utilized during the development and iterative refinement of SurplusLink for the Discover Dollar Software Development Intern Hackathon, documenting what was originally built and what was updated in the latest sprint.

---

## 1. AI Assistant & Workflow Overview

- **Tools Used**: Antigravity IDE (AI Coding Agent).
- **Pair Programming Approach**: The project was developed across structured iterations:
  - **Iteration 1 (Core Engine & Backend)**: SQLite schemas, pure rules engine, transactional API, concurrency testing.
  - **Iteration 2 (Baseline Single-Page UI)**: TextContent-safe vanilla frontend with persona switching.
  - **Iteration 3 (Privacy & Kombai-Inspired Split Auth)**: Split-screen onboarding, removal of public entity dropdowns, private Unique ID authentication.
  - **Iteration 4 (Modular Restaurant Owner Architecture)**: Tabbed header navigation, pure SVG 3D isometric pie charts, 3D simulation clock, and strict accept window lifecycle.
- **Core Philosophy**: Prioritize mathematical correctness, strict privacy, zero external frontend dependencies, and modern visual aesthetics.

---

## 2. Record of What Was Originally Built (Iteration 1 & 2)

1. **Database & Schema Design (`src/db.js`)**:
   - `better-sqlite3` in WAL mode with idempotent seeding.
   - Strict `CHECK` constraints on all tables (`donors`, `volunteers`, `volunteer_zones`, `donations`, `claims`, `clock`).
   - Relational normalization: volunteer zones separated into `volunteer_zones` with composite primary key `(volunteer_id, zone)`.

2. **Pure Business Rules Engine (`src/rules.js`)**:
   - Dynamic status derivation (`OPEN`, `FULLY_CLAIMED`, `EXPIRED`, `CANCELLED`) without state drift.
   - Boundary-safe time arithmetic using strict UTC parsing (`YYYY-MM-DDTHH:MM:00Z`).
   - Independent validation of all 7 claim rules (capacity, remaining kg, zones, pickup window, timing, 60-minute vehicle spacing).
   - Exact mathematical conservation identity:
     $$\text{Listed} = \text{Collected} + \text{In Progress} + \text{Still Open} + \text{Wasted} + \text{Missed}$$

3. **Concurrency & API Layer (`src/app.js`)**:
   - SQLite transactions using `db.transaction(...).immediate()` to lock at the boundary, ensuring simultaneous competing claims cannot over-allocate food.
   - Comprehensive test suite with 44 unit and concurrency tests passing.

4. **Baseline Single-Page Interface (`public/index.html`)**:
   - Vanilla JS + Tailwind CSS via CDN with CSS variable theme fallbacks.
   - TextContent-only DOM rendering ensuring 100% protection against XSS vulnerabilities.

---

## 3. Record of What Was Updated & Enhanced (Latest Sprint)

1. **Kombai iOS-Style Split-Screen Auth & Onboarding**:
   - **What changed**: Replaced the initial basic modal with a high-fidelity split-screen layout.
   - **Visual Design**: Left side displays a mobile presentation frame with value-proposition highlight cards, trust metrics, and feature badges; right side houses clean, role-segmented auth cards.

2. **Privacy Enforcement: Private Unique ID Authentication**:
   - **What changed**: Eliminated public dropdown menus that exposed registered restaurants and volunteers to any visitor.
   - **Implementation**: Upon registration, restaurants receive a unique ID (e.g., `D1`, `D2`), and volunteers receive a driver ID (e.g., `V1`, `V2`). Login now strictly requires entering this private unique ID.
   - **Backend Support**: Added secure lookup endpoints `GET /api/donors/:id` and `GET /api/volunteers/:id`.

3. **Modular Tabbed Architecture for Restaurant Owners**:
   - **What changed**: Replaced the cluttered all-in-one view with clean, independent header tabs:
     - **Tab 1: 📦 Post Surplus Food**: Form to allot food weight (kg), description, and pickup window (`pickup_from` to `pickup_until`) with accept window countdown guarantee.
     - **Tab 2: 📋 My Posted Donations**: Capacity tracking (visual remaining kg progress bar), safe cancellation (enabled only when `OPEN` with no active claims), and volunteer claims queue.
     - **Tab 3: 📊 Food Balance (3D Pie Chart)**: 3D visual breakdown across the 5 recovery statuses, accompanied by the Conservation Identity verification badge.
     - **Tab 4: 🚗 Volunteer Rescue History (3D Pie Chart)**: 3D distribution of volunteer rescue capacity shares and driver reliability/fulfillment ratings.

4. **Pure SVG 3D Isometric Pie Charts (Zero Dependencies)**:
   - **What changed**: Avoided heavy charting libraries (no Chart.js, D3, or bundlers).
   - **Implementation**: Custom pure SVG generator (`render3DPieChartSVG`) with tilted elliptical geometry (`rx`, `ry`), front-facing cylinder depth extrusion with darkened side-wall shading, drop shadows, and hover tooltips.

6. **Volunteer Modular Architecture & Smart Claim Validation**:
   - **What changed**: Segregated the volunteer dashboard into 3 dedicated header tabs: `Available Surplus`, `My Claimed Pickups`, and `Failed Pickups & Improvement`.
   - **Fixing Available Surplus Behavior**:
     - Resolved Rule 6 invalid past-time errors by setting `timeInput.min` and `timeInput.value` dynamically to `Math.max(pickup_from, clockNow)`.
     - Provided quick preset chips (`Max`, `10kg`, `5kg`) that automatically respect vehicle capacity limits (`Math.min(capacity_kg, remaining_kg)`).
     - Added zone filtering pills (`My Zones` vs `All City Zones`) so drivers can explore city-wide opportunities with clear visual in-zone indicators.
   - **New Tab: Failed Pickups & Improvement Hub**:
     - Built a dedicated improvement hub tracking missed pickup deadlines (`MISSED` status).
     - Provides a driver scorecard (Successfully Rescued kg, Failed Pickups count, Timely Cancellations, Reliability Rating %).
     - Features actionable self-improvement guidance explaining how to maintain a 100% reliability rating and audit table for missed collections.

7. **Digital Simulation Clock Upgrade**:
   - **What changed**: Upgraded the simulated clock widget to an authentic, high-contrast **Digital LED / LCD Simulation Clock** featuring:
     - Obsidian glass recessed bezel with ambient cyan glow and scanline sheen.
     - Authentic 7-segment / LED digital typography with ghost background segments (`88:88`).
     - Animated blinking digital colon separator (`:`) pulsing at 1Hz.
     - Live Day of the Week indicator pills (`SU MO TU WE TH FR SA`) illuminating the active day.
     - Integrated simulated dispatch seconds (`:00`) and `AM`/`PM` sub-readout alongside full ISO date (`YYYY-MM-DD`).
     - Maintained 1-tap quick advance controls (`+30m`, `+1h`, `+2h`, `+1d`) and custom simulation timestamp drawer.

8. **Task Dashboard UI: Colorful Gradients & Subtle Glassmorphism**:
   - **What changed**: Transformed the plain top header and flat browser-like tab bar into a modern, lightweight task dashboard:
     - **Top Multi-Stop Ambient Gradient Accent Strip**: Vibrant emerald-to-fuchsia border accent giving immediate depth.
     - **Frosted Glass Header Bar (`glass-header`)**: Semi-transparent background with `backdrop-blur-xl`, subtle borders, and soft elevation shadow.
     - **Gradient Brand Emblem**: Glowing multi-stop cyan/teal/indigo emblem with dynamic lightning dispatch icon.
     - **Frosted Glass Identity Capsule**: Pill-shaped persona badge with live pulsating green online indicator, active user info, and smooth interactive switch/log-out action.
     - **Glassmorphic Icon Action Buttons**: Frosted glass theme toggle and data refresh buttons with smooth micro-hover transitions.
     - **Segmented Glass Pill Tab Bar (`glass-nav-bar`)**: Replaced flat underline text tabs with an inner frosted glass capsule housing gradient-filled active pill buttons (`tab-glass-pill`) with subtle hover elevation and glowing shadow.

---

## 4. What Was Accepted, Customized, or Rejected

| Area | Initial AI Proposal | Final Decision & Customization | Rationale |
| :--- | :--- | :--- | :--- |
| **Dependencies** | Using `multer`, `cors`, and `csv-parse` from prior template | **Rejected.** Kept only `express` and `better-sqlite3`. | Zero bloat, zero unused code, clean `package.json`. |
| **Chart Libraries** | Installing `chart.js` or `recharts` | **Rejected.** Built a pure inline SVG 3D isometric pie chart generator. | Zero build step, instant rendering, 100% lightweight. |
| **User Discovery** | Public select dropdown of all restaurants and drivers | **Rejected.** Switched to private Unique ID login (`D1`, `V1`). | Protects user privacy and simulates real-world identity management. |
| **UI Organization** | Stacking all donor/volunteer controls on a single continuous page | **Rejected.** Segregated into clean header tabs for both roles (`Post`, `Manage`, `Balance`, `Volunteers` for Donors; `Available`, `My Pickups`, `Failed & Improvement` for Volunteers). | Eliminates visual clutter and keeps each workflow focused and intuitive. |
| **Volunteer Time Defaults** | Defaulting pickup time input to `pickup_from` | **Rejected.** Dynamically clamped to `Math.max(pickup_from, clockNow)`. | Completely prevents unintentional Rule 6 past-time validation rejections. |
| **Sidebar Identity** | Redundant switch buttons on every card | **Customized.** Removed button from identity card; kept switch/logout in top header. | Clear information hierarchy without UI redundancy. |
| **Simulation Clock** | Analog dial face or generic text box | **Customized.** Engineered an authentic high-contrast Digital LED / LCD hardware-style display with ghost segments, blinking colon, and day-of-week indicators. | Provides high-clarity digital precision for time-critical food rescue dispatch testing. |
| **Dashboard Navigation** | Flat monochromatic top header and plain underline tabs | **Customized.** Engineered a lightweight glassmorphic task dashboard with multi-stop colorful gradients, frosted glass pill capsules, and smooth micro-interactions. | Modern, aesthetic, lightweight, and keeps the food recovery dispatch workflow organized and visually engaging. |
| **DOM Safety** | Using `innerHTML` with template literals | **Rejected.** Strictly enforced `document.createElement` and `textContent`. | 100% immune to XSS and injection attacks from user-submitted text. |

---

## 5. Technical Interview Defense Guide

### Q1: How do you guarantee that two volunteers cannot claim the last kilograms at the same time?
> *"In `src/app.js`, claim reservations run inside `db.transaction(...).immediate()`. `better-sqlite3` runs synchronously in Node's main thread and `IMMEDIATE` acquires a write lock before any read. Because Node is single-threaded, concurrent incoming requests queue up at the database transaction boundary. The first transaction checks the remaining kg, reserves it, and commits. The second transaction runs immediately after, sees remaining is 0, and returns a 422 with Rule 3."*

### Q2: Why are donation status and remaining kg not stored in the database?
> *"To eliminate state drift. If we stored 'OPEN' or 'EXPIRED' in the database, a background job would have to continuously poll and update rows. Instead, we store only immutable facts (donation quantity and claim events). Every time a donation is read, its status is derived deterministically from the current simulated clock and claim states."*

### Q3: Why does `toMinutes()` append `:00Z`?
> *"Local time arithmetic is subject to timezone offsets and daylight-saving time shifts. By appending `:00Z` and parsing as UTC, minute differences between any two timestamps are purely mathematical: `(t2 - t1) / 60000`."*

### Q4: How is the conservation identity maintained?
> *"Listed quantity is an invariant. Claims hold kilograms from the moment they are made. If a claim expires, its kilograms become `MISSED`, and any unreserved kilograms on an expired donation become `Wasted`. Because `MISSED` claims are not cancelled, `Listed` always equals `Collected + Missed + Wasted + In progress + Still open`."*

