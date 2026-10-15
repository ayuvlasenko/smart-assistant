---
worth: yes
where: apps/server/migrate-mongo-config.js:3
added: 2026-10-15
---

# migrations use the `test` database when DATABASE_URL has no database name

`migrate-mongo-config.js` takes the database name from the path of `DATABASE_URL`. When the path is empty, `getDatabaseName` returns `""`, and the MongoDB driver falls back to the database `test`. The migration Job then reports success and changes `test`, while the server with the same URL fails: `@fastify/mongodb` leaves `mongo.db` undefined, so the health check and every repository fail.

The two sides disagree only on a wrong configuration, but the migration side hides it. A fix is small: reject an empty name in `migrate-mongo-config.js`, or require a database path in the `DATABASE_URL` schema in `src/env.ts` so both sides fail on start. Found while testing the `write-docs` skill on a migrations README.
