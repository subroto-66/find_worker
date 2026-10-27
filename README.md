# Find Worker

Find Worker uses MySQL 8.0.16 or newer for its application database.

## Local setup

1. Install Node.js 22.22.2+ (22 LTS) or 24.15.0+, and MySQL 8.0.16 or newer.
2. Install packages: `npm ci`.
3. Copy `.env.example` to `.env.local`; set your MySQL credentials and a unique `JWT_SECRET` of at least 32 characters. `.env.local` is git-ignored and must never be committed.
4. Create the database named in `DB_NAME` if it does not exist. The configured MySQL user needs permission to create tables in that database.
5. Initialize the schema with `npm run db:init`. This creates missing tables and indexes; it does not migrate PostgreSQL data or alter existing tables.
6. Start the application with `npm run dev`.

The MySQL schema is in [`db/schema.sql`](./db/schema.sql). It creates the relational tables, foreign keys, checks, uniqueness constraints, indexes, and JSON profile/analytics fields. API responses continue to expose IDs as strings in `_id` fields.

Switching the application to MySQL does not transfer existing PostgreSQL records. Back up the PostgreSQL database and migrate/export its data separately before directing production traffic to the MySQL database.

To create the first administrator, set `ADMIN_EMAIL` and a strong `ADMIN_PASSWORD` (at least 12 characters) in the environment and run `npm run admin:create`. The script does not use a default password and will not create a second admin if one already exists.

## Deployment

Build and run on a Node.js host with a reachable MySQL database:

```sh
npm ci
npm run db:init
npm run build
npm start
```

Configure `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, a unique `JWT_SECRET` of at least 32 characters, and `NODE_ENV=production` in the deployment platform's secret/environment settings. For providers that require MySQL TLS, set `DB_SSL=true`; provide a trusted certificate in `DB_SSL_CA` if needed. Certificate verification stays enabled by default. Do not commit credentials. Run `npm run db:init` as a release step before starting app instances. Use a managed MySQL service with automated backups and TLS/network restrictions for production.

The app uses local disk for uploaded images and videos under `public/uploads`. Production deployments must mount persistent shared storage there or replace the upload backend with object storage; ephemeral serverless filesystems will lose uploads and do not support reliable multi-instance uploads.

## Validation

Run `npm run lint` and `npm run build` before deploying. `/api/test-db` checks MySQL connectivity.
