# EcoCampus

EcoCampus is a campus energy-management prototype for viewing room readings, reviewing explainable energy-waste alerts, exploring campus layouts, and generating reports. All readings, analytics, device statuses, and controls are simulated; no physical sensors or equipment are connected.

## Features

- Shared, versioned campus state stored in MySQL
- Room monitoring, rule-based alerts, and campus layout tools
- Simulated device controls and rule-based schedules
- Illustrative analytics, reports, and CSV/Excel-compatible exports
- Responsive pages for desktop and mobile

## Requirements

- Node.js 22 or later
- pnpm 11.25.0
- A MySQL database

Install dependencies:

```sh
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm install --frozen-lockfile
```

Set `DATABASE_URL` to a MySQL connection URL in the server environment, then start the development server:

```sh
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The server applies database migrations and seeds the sample state when the database is empty. Do not commit database credentials or `.env` files.

## Docker

Build and run the production image, supplying `DATABASE_URL` through the runtime environment:

```sh
docker build -t ecocampus .
docker run --rm -p 3000:3000 -e DATABASE_URL="mysql://user:password@host:3306/database" ecocampus
```

The app exposes `/api/health` for database readiness and serves the production UI on port 3000 by default.
