# AI Usage Disclosure (`AI_USAGE.md`)

This document discloses how AI tools were utilized during the development of SurplusLink for the Discover Dollar Software Development Intern Hackathon, including what was accepted, customized, or rejected.

---

## 1. AI Assistant & Workflow Overview

- **Tools Used**: Antigravity IDE (AI Coding Agent).
- **Pair Programming Approach**: The hackathon was executed in four structured phases (Phase 0: Design & Specifications, Phase 1: Schema & Pure Rules, Phase 2: Transactional API & Concurrency Tests, Phase 3: Frontend & Accessible UI, Phase 4: Edge-Case Verification & Documentation).
- **Core Philosophy**: Prioritize correctness, readability, and explainability over feature bloat or external dependencies.

---

## 2. Where AI Was Used

1. **Phase 0 (System Design & Boundary Analysis)**:
   - Formulated SQLite table schemas with strict `CHECK` constraints.
   - Identified all 7 claim rules and edge cases (inclusive boundaries, UTC minute calculations, dashboard conservation identity).
2. **Phase 1 (Database & Pure Business Logic)**:
   - Generated `src/db.js` with WAL mode and idempotent seeding.
   - Drafted pure calculation functions in `src/rules.js` (`deriveStatus`, `remainingKg`, `validateClaim`, `dashboard`).
   - Scaffolded 31 boundary unit tests targeting all timing and rule edge cases.
3. **Phase 2 (Transactional API Routes & Concurrency)**:
   - Implemented Express routes in `src/app.js` with role-based checks (`X-Actor-Id`).
   - Constructed the concurrency test demonstrating that simultaneous `Promise.all` claims for remaining food result in exactly one 201 and one 422 Rule 3.
4. **Phase 3 (Accessible Frontend)**:
   - Generated the single-file UI (`public/index.html`) using Vanilla JavaScript and Tailwind CSS via CDN.
   - Built the field notebook aesthetic with CSS variables and an inline fallback stylesheet.
5. **Phase 4 (Documentation & Hardening)**:
   - Drafted `README.md` and `AI_USAGE.md`.

---

## 3. What Was Accepted, Customized, or Rejected

| Area | Initial AI Proposal | Final Decision & Customization | Rationale |
| :--- | :--- | :--- | :--- |
| **Dependencies** | Using `multer`, `cors`, and `csv-parse` from prior template | **Rejected.** Uninstalled all unneeded libraries; kept only `express` and `better-sqlite3`. | Zero bloat, zero unused code, clean `package.json`. |
| **Zone Storage** | Storing volunteer zones as a JSON string array inside the `volunteers` table | **Rejected.** Normalized into a dedicated `volunteer_zones` table with composite primary key `(volunteer_id, zone)`. | Guarantees relational integrity, clean indexing, and explicit foreign key checks. |
| **State Derivation** | Storing `status` and `remaining_kg` columns on the `donations` table | **Rejected.** Raw facts only. Status and remaining kg are derived dynamically on read. | Prevents state drift; only claim status is stored because collection and expiration are historical events. |
| **Time Arithmetic** | Using native `Date.now()` or local string offsets | **Rejected.** Strict UTC parsing (`YYYY-MM-DDTHH:MM:00Z`) and calendar round-tripping. | Prevents daylight saving time glitches and rejects invalid dates (e.g. Feb 30). Zero dependence on system time. |
| **Client Authentication** | Complex session cookies or mock JWT tokens | **Changed.** Used simple, transparent `X-Actor-Id` headers. | Clean, stateless, easily verifiable via `curl` and native `fetch` tests. |
| **Frontend DOM Safety** | Using `innerHTML` with template literals | **Rejected.** Strictly enforced `document.createElement` and `textContent`. | 100% immune to XSS and injection attacks from user-submitted text. |
| **UI Routing** | Multi-page HTML or client-side hash routing | **Changed.** Single responsive dashboard that dynamically swaps work views based on selected persona. | Seamless user experience without page reloads. |

---

## 4. Technical Interview Defense Guide

Below is how to explain key architectural decisions to the interviewer:

### Q1: How do you guarantee that two volunteers cannot claim the last kilograms at the same time?
> *"In `src/app.js`, claim reservations run inside `db.transaction(...).immediate()`. `better-sqlite3` runs synchronously in Node's main thread and `IMMEDIATE` acquires a write lock before any read. Because Node is single-threaded, concurrent incoming requests queue up at the database transaction boundary. The first transaction checks the remaining kg, reserves it, and commits. The second transaction runs immediately after, sees remaining is 0, and returns a 422 with Rule 3."*

### Q2: Why are donation status and remaining kg not stored in the database?
> *"To eliminate state drift. If we stored 'OPEN' or 'EXPIRED' in the database, a background job would have to continuously poll and update rows. Instead, we store only immutable facts (donation quantity and claim events). Every time a donation is read, its status is derived deterministically from the current simulated clock and claim states."*

### Q3: Why does `toMinutes()` append `:00Z`?
> *"Local time arithmetic is subject to timezone offsets and daylight-saving time shifts. By appending `:00Z` and parsing as UTC, minute differences between any two timestamps are purely mathematical: `(t2 - t1) / 60000`."*

### Q4: How is the conservation identity maintained?
> *"Listed quantity is an invariant. Claims hold kilograms from the moment they are made. If a claim expires, its kilograms become `MISSED`, and any unreserved kilograms on an expired donation become `Wasted`. Because `MISSED` claims are not cancelled, `Listed` always equals `Collected + Missed + Wasted + In progress + Still open`."*
