# MongoDB Migrations Design

## Summary

Add MongoDB migrations to the `server` workspace using `migrate-mongo` with native ESM JavaScript migration files. The initial scope covers local developer workflows and the first migration that creates a unique index on `users.telegramId`.

## Goals

- Add a standard migration tool to the `server` workspace.
- Provide local commands to create, apply, revert, and inspect migrations.
- Keep migration files close to the backend code in `apps/server`.
- Create an initial migration that enforces unique `telegramId` values in the `users` collection.
- Rely on MongoDB's native unique-index failure when existing data violates the constraint.

## Non-Goals

- Kubernetes job wiring.
- Docker image changes.
- Automatic duplicate cleanup or deduplication.
- A custom migration framework or wrapper layer.

## Chosen Approach

Use `migrate-mongo` directly inside the `apps/server` workspace.

This keeps the workflow aligned with the existing `npm run ... -w server` convention and avoids introducing a custom runner before there is a real need for one. Migration files will use native ESM JavaScript so they match the repository's module system and stay close to the standard `migrate-mongo` flow.

## File Layout

- `apps/server/migrate-mongo-config.js`
  - `migrate-mongo` configuration in native ESM format.
- `apps/server/migrations/`
  - Timestamp-prefixed migration files created by `migrate-mongo create`.
- `apps/server/package.json`
  - Local npm scripts for migration workflows.

## Local Developer Workflow

The `server` workspace will expose these scripts:

- `migrate:create`
- `migrate:up`
- `migrate:down`
- `migrate:status`

Expected usage:

```bash
npm run migrate:create -w server -- add-users-telegram-id-unique-index
npm run migrate:up -w server
npm run migrate:down -w server
npm run migrate:status -w server
```

`migrate-mongo` will generate timestamp-prefixed filenames, and that timestamp prefix determines execution order.

## Configuration

`apps/server/migrate-mongo-config.js` will:

- read `DATABASE_URL` from `process.env`
- use `apps/server/migrations` as the migrations directory
- store migration history in a dedicated MongoDB collection
- keep a dedicated lock collection for migration locking
- use native ESM exports

No deployment-specific configuration will be added in this phase.

## Migration Conventions

- Migrations are append-only history files.
- Filenames are created through `migrate-mongo create` and remain immutable after creation.
- `up` applies the change.
- `down` reverts the most recent applied migration for local development convenience.
- Indexes should use explicit names when the code later needs to drop them reliably.

## First Migration

Description passed to `migrate:create`:

```text
add-users-telegram-id-unique-index
```

Generated file shape:

```text
apps/server/migrations/<timestamp>-add-users-telegram-id-unique-index.js
```

Migration behavior:

### Up

1. Call `createIndex()` on the `users` collection with key `{ telegramId: 1 }`.
2. Set `unique: true` and `name: "telegramId_unique"`.
3. Rely on MongoDB to create the `users` collection implicitly if it does not already exist.
4. Rely on MongoDB's native duplicate key failure if existing data violates the unique constraint.

### Down

1. Drop the `telegramId_unique` index from the `users` collection.

## Duplicate Handling Policy

The migration will not run a manual duplicate precheck.

Instead, it will rely on MongoDB's native unique-index build behavior. If duplicate `telegramId` values exist, or if multiple documents have missing or `null` `telegramId` values, the index build will fail with MongoDB's duplicate key error.

Automatic deduplication is intentionally excluded because it can silently corrupt user data by deleting or merging the wrong records. Cleanup remains a manual operational decision outside this migration.

## Testing Strategy

Add focused tests for the migration module rather than spawning the `migrate-mongo` CLI.

Required coverage:

- `up` surfaces MongoDB's native duplicate key failure when existing data violates uniqueness
- `up` creates the unique `telegramId_unique` index when data is valid
- `up` succeeds when the `users` collection does not exist yet and leaves the index in place
- `down` drops the `telegramId_unique` index

This keeps tests fast and focused on the migration logic that matters most.

## Verification

Before considering the implementation complete, run:

```bash
npm run test -w server
npm run lint -w server
npm run format -w server
```

Manual smoke checks during development:

```bash
npm run migrate:status -w server
npm run migrate:up -w server
npm run migrate:down -w server
```

## Rationale

This approach balances standard tooling with low complexity:

- `migrate-mongo` already solves migration ordering, changelog tracking, and locking.
- Workspace-local setup matches the current monorepo structure.
- Native ESM JavaScript avoids adding a compile step just for migration files.
- Deferring Kubernetes and Docker wiring keeps the first implementation small and reversible.
