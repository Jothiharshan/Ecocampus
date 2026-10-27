# EcoCampus full-stack implementation plan

## Scope and product behavior

Extend the existing responsive EcoCampus prototype into a full-stack campus energy-management demo while preserving its seven sections: Home, Dashboard, Campus Layout, Analytics, Smart Control, Reports, and Business Model. Keep the original room monitoring and rule-based wastage alerts reachable from the Dashboard. Preserve the green reference-inspired design and test the layout across phone, tablet, and desktop widths.

Keep readings, occupancy probabilities, savings, emissions, graphs, devices, forecasts, insights, and all control actions clearly identified as simulated. No physical sensor or equipment will be connected, and no detection or analysis will be represented as AI or validated prediction. The room flag remains rule-based: reading exceeds the configured kWh threshold while the room is unoccupied and unscheduled.

## Server, data, and API

Enable the Manus-managed server and MySQL database for this project. Add a Node.js HTTP server that serves the compiled `dist/` frontend, JSON state API, and an unauthenticated readiness endpoint at `/api/health`. Read `DATABASE_URL` at runtime; never embed it in frontend assets. Run an idempotent additive schema setup at server startup. Store a single project-scoped EcoCampus demo state row with a JSON document, monotonically increasing version, and timestamps. On the first installation only, seed that row from the existing sample rooms, pathways, devices, schedules, alert-review IDs, rule parameters, and control flags. Never replace user-modified data during an ordinary restart.

`GET /api/state` returns the current shared state and version. `PUT /api/state` validates the full JSON document, enforces request-size and collection/value limits, and uses an expected-version conditional update; conflicts return `409` with the current state rather than silently overwriting another session. `POST /api/state/reset` resets the shared demo dataset only after the UI's explicit, accurately worded confirmation, and uses the same version check. Use parameterized SQL, same-origin browser requests, structured API errors, and no secret in browser code. Do not add authentication in this prototype; make the shared, writable, no-login demo boundary explicit in the interface and handoff.

## Browser state and working actions

Replace localStorage as the source of truth with a database bootstrap flow. On load, retrieve the database state and version before enabling the app; expose clear loading, connection failure, save pending, save failure/retry, and stale-version feedback. Send state mutations to the backend, serialize/coalesce saves, update the current revision after success, and recover from conflicts by refreshing the shared state and notifying the user. Avoid silently displaying unsaved browser-only edits as persisted data.

Persist room addition/update/removal; campus pathway addition; alert review status; device On/Off state; emergency and safe-mode flags; schedule create/edit/activate/deactivate/delete; automation settings; adjustable detection/analysis parameters; and chosen app/report settings that are part of the existing mutable state. Keep search/filter/navigation selections as ephemeral UI state when appropriate. Keep existing report CSV/Excel-compatible download, print, certificate preview, and date controls functional; the certificate's own print action must print the certificate, not hide it with the standard report print rules. Give analysis, forecast, and insight buttons a visible state/output refresh so they do more than show a toast. Report reset as a shared destructive action to all Preview users; leave its database endpoint uninvoked in automated validation.

## Responsive interface

Preserve the existing Tailwind 4.3.3 and pinned pnpm 11.25.0 toolchain. Add an accessible collapsible mobile navigation for narrow screens while retaining the seven destinations and their active state. Ensure form/dialog actions fit and wrap on mobile; make dashboard cards, graph controls, reports, data tables, schedules, analytics, and device filters readable with deliberate stacking/overflow rules from 320 px through desktop. Keep visible status text as well as color, maintain keyboard focus styles, and respect reduced-motion preferences.

## Project structure

- `public/index.html`: application shell, responsive/header navigation, database status, and loading/error state mount points.
- `public/app.js`: views, UI events, client API requests, save queue/conflict handling, navigation, forms, and exports.
- `public/data.js`: reusable sample state, defaults, transparent detection, deterministic illustrative calculations, and graph algorithms; no storage secret or DB access.
- `public/styles.css` / generated `public/tailwind.css`: Tailwind theme and responsive source/output; only source remains tracked.
- `server.js`: Node entry point, API routing, bounded JSON parsing, compiled frontend serving, health response, and graceful shutdown.
- `server/database.js`: MySQL connection pool, additive idempotent schema setup, one-time seed, reads, versioned writes, and reset operation.
- `server/state-validation.js`: server-side shape/range/string/collection validation for API payloads.
- `Dockerfile`: pinned Node/pnpm install, Tailwind production build, production server image, `PORT` listener, and a Docker `HEALTHCHECK` that calls the database-aware `/api/health` endpoint.
- `public/manus-routes.json`: one root SPA route (API paths are excluded).
- `package.json`, lockfile, and pnpm policy: pinned application dependencies and reproducible build.

## Runtime and delivery boundary

Use a static Preview-compatible CSS watcher and `node server.js` in development. In production, Docker builds the Tailwind output and runs the Node server on `PORT` (3000 default). Configure the container health check to `/api/health`; the managed static-output declaration is no longer the production serving mode. Keep automatic publication disabled and do not publish in this task. The managed MySQL database is project-scoped and shared by development and future production; all test writes also touch that same dataset. Use simulated sample values only, no real campus readings. Existing browser-local edits are not automatically imported into the shared database.

## Design direction

- **Design movement:** Contemporary sustainability-oriented campus operations dashboard, preserving the supplied screen recording as the visual reference.
- **Core principles:** High information density with clear whitespace; show relationships between energy, room use, and alerts; green-led hierarchy; immediate feedback makes database state and demo-only actions understandable.
- **Color philosophy:** Green communicates campus sustainability and action; amber marks possible waste; indigo accents analytical panels. White surfaces and muted green-gray backgrounds keep content legible.
- **Layout paradigm:** Persistent green horizontal navigation on wide screens; compact collapsible navigation on phones; asymmetric dashboard panels and a three-column room/graph/tools layout that stacks on narrow screens.
- **Signature elements:** Leaf-and-campus mark; green gradient header; mint-highlighted cards and status markers.
- **Interaction philosophy:** Actions provide visible feedback and are persisted to the shared database where applicable. Loading, offline/failure, saving, conflict, and shared-demo states are disclosed. No control affects physical hardware.
- **Animation:** Restrained status/view transitions; respect reduced-motion; no continuous animation in data visualizations.
- **Typography system:** Manrope for headings and metrics; DM Sans for labels, forms, controls, and tables.
- **Brand essence:** A transparent, practical, ecological campus energy prototype for college teams.
- **Brand voice:** Specific and operational; e.g. “See the rooms worth checking.” “Demo state saved to the shared database—not connected to equipment.”
- **Wordmark & logo:** Preserve the existing EcoCampus leaf sprout and horizontal groundline mark.
- **Signature brand color:** EcoCampus forest green `#146c4b`, paired with bright leaf green in the navigation.
