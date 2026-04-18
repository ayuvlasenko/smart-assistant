# MongoDB Migrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `migrate-mongo` to the `server` workspace with local create/up/down/status scripts and ship the first migration that creates a unique `users.telegramId` index.

**Architecture:** Keep all migration tooling inside `apps/server` so it follows the existing workspace conventions. Use a native ESM `migrate-mongo` config file plus a plain ESM migration script, and cover the first migration with focused JavaScript tests that assert the exact MongoDB calls and error propagation behavior.

**Tech Stack:** npm workspaces, Fastify server workspace, `migrate-mongo`, MongoDB Node driver, Node test runner, `tsx`

---

## File Structure

- Create: `apps/server/migrate-mongo-config.js`
- Create: `apps/server/migrations/20260418193000-add-users-telegram-id-unique-index.js`
- Create: `apps/server/src/test/migrations/add-users-telegram-id-unique-index.test.js`
- Modify: `apps/server/package.json`
- Modify: `package-lock.json`

### Task 1: Add Workspace Migration Tooling

**Files:**
- Modify: `apps/server/package.json`
- Create: `apps/server/migrate-mongo-config.js`
- Modify: `package-lock.json`

- [ ] **Step 1: Prove the migration scripts do not exist yet**

Run:

```bash
npm run migrate:status -w server
```

Expected: npm exits non-zero and reports `Missing script: "migrate:status"`.

- [ ] **Step 2: Install `migrate-mongo` in the `server` workspace**

Run:

```bash
npm install -w server migrate-mongo
```

Expected: `apps/server/package.json` gains a `migrate-mongo` dependency and `package-lock.json` updates for the new package graph.

- [ ] **Step 3: Add local migration scripts to the server workspace**

Update [apps/server/package.json](/Users/aleksandr/github/projects/smart-assistant/apps/server/package.json) so the `scripts` section includes:

```json
{
  "migrate:create": "migrate-mongo create -f ./migrate-mongo-config.js",
  "migrate:up": "migrate-mongo up -f ./migrate-mongo-config.js",
  "migrate:down": "migrate-mongo down -f ./migrate-mongo-config.js",
  "migrate:status": "migrate-mongo status -f ./migrate-mongo-config.js",
  "test": "node --env-file=.env.test --import tsx --test \"src/**/*.test.ts\" \"src/**/*.test.js\""
}
```

Keep the existing `start`, `build`, `watch`, `dev`, `dev:start`, `lint`, and `format` scripts unchanged.

- [ ] **Step 4: Create the workspace-local `migrate-mongo` config**

Create [apps/server/migrate-mongo-config.js](/Users/aleksandr/github/projects/smart-assistant/apps/server/migrate-mongo-config.js):

```js
const databaseUrl = process.env.DATABASE_URL ?? "";

function getDatabaseName(url) {
    if (!url) {
        return "";
    }

    const pathname = new URL(url).pathname.replace(/^\/+/, "");

    return decodeURIComponent(pathname);
}

export default {
    mongodb: {
        url: databaseUrl,
        databaseName: getDatabaseName(databaseUrl),
        options: {},
    },
    migrationsDir: "migrations",
    changelogCollectionName: "migrations",
    migrationFileExtension: ".js",
    useFileHash: false,
    lockCollectionName: "migrations_lock",
    lockTtl: 0,
};
```

Why this exact shape:
- `create` can run even when `DATABASE_URL` is unset
- `up`, `down`, and `status` still rely on the real environment variable at runtime
- the config stays native ESM and local to `apps/server`

- [ ] **Step 5: Verify the new scripts resolve through npm**

Run:

```bash
npm run migrate:create -w server -- --help
```

Expected: the command exits successfully and shows `migrate-mongo create` help instead of an npm missing-script error.

- [ ] **Step 6: Commit the tooling setup**

Run:

```bash
git add apps/server/package.json apps/server/migrate-mongo-config.js package-lock.json
git commit -m "chore: add MongoDB migration tooling"
```

### Task 2: Add the First Migration With Tests

**Files:**
- Create: `apps/server/migrations/20260418193000-add-users-telegram-id-unique-index.js`
- Create: `apps/server/src/test/migrations/add-users-telegram-id-unique-index.test.js`

- [ ] **Step 1: Write the failing migration test file first**

Create [apps/server/src/test/migrations/add-users-telegram-id-unique-index.test.js](/Users/aleksandr/github/projects/smart-assistant/apps/server/src/test/migrations/add-users-telegram-id-unique-index.test.js):

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    down,
    up,
} from "../../../migrations/20260418193000-add-users-telegram-id-unique-index.js";

function buildDb({
    createIndex = async () => "telegramId_unique",
    dropIndex = async () => undefined,
} = {}) {
    const calls = [];
    const collection = {
        createIndex: async (...args) => {
            calls.push(["createIndex", args]);

            return createIndex(...args);
        },
        dropIndex: async (...args) => {
            calls.push(["dropIndex", args]);

            return dropIndex(...args);
        },
    };

    return {
        calls,
        db: {
            collection(name) {
                calls.push(["collection", [name]]);

                return collection;
            },
        },
    };
}

void describe("add users telegramId unique index migration", () => {
    void it("creates the telegramId_unique index on users", async () => {
        const { calls, db } = buildDb();

        await up(db);

        assert.deepEqual(calls, [
            ["collection", ["users"]],
            [
                "createIndex",
                [{ telegramId: 1 }, { unique: true, name: "telegramId_unique" }],
            ],
        ]);
    });

    void it("lets MongoDB surface duplicate key failures", async () => {
        const duplicateKeyError = new Error("E11000 duplicate key error");
        const { db } = buildDb({
            createIndex: async () => {
                throw duplicateKeyError;
            },
        });

        await assert.rejects(() => up(db), duplicateKeyError);
    });

    void it("delegates implicit collection creation to MongoDB", async () => {
        const { calls, db } = buildDb();

        await up(db);

        assert.equal(
            calls.some(([name]) => name === "createCollection"),
            false,
        );
    });

    void it("drops the telegramId_unique index from users", async () => {
        const { calls, db } = buildDb();

        await down(db);

        assert.deepEqual(calls, [
            ["collection", ["users"]],
            ["dropIndex", ["telegramId_unique"]],
        ]);
    });
});
```

- [ ] **Step 2: Run the targeted test to watch it fail**

Run:

```bash
npm run test -w server -- src/test/migrations/add-users-telegram-id-unique-index.test.js
```

Expected: the test run fails because `../../../migrations/20260418193000-add-users-telegram-id-unique-index.js` does not exist yet.

- [ ] **Step 3: Create the first migration file with the minimal implementation**

Create [apps/server/migrations/20260418193000-add-users-telegram-id-unique-index.js](/Users/aleksandr/github/projects/smart-assistant/apps/server/migrations/20260418193000-add-users-telegram-id-unique-index.js):

```js
export async function up(db) {
    await db.collection("users").createIndex(
        { telegramId: 1 },
        { unique: true, name: "telegramId_unique" },
    );
}

export async function down(db) {
    await db.collection("users").dropIndex("telegramId_unique");
}
```

- [ ] **Step 4: Run the targeted test again to verify it passes**

Run:

```bash
npm run test -w server -- src/test/migrations/add-users-telegram-id-unique-index.test.js
```

Expected: the migration test file passes with 4 passing tests and 0 failures.

- [ ] **Step 5: Commit the first migration and tests**

Run:

```bash
git add apps/server/migrations/20260418193000-add-users-telegram-id-unique-index.js apps/server/src/test/migrations/add-users-telegram-id-unique-index.test.js
git commit -m "feat: add users telegramId migration"
```

### Task 3: Verify the Full Workspace Behavior

**Files:**
- Verify: `apps/server/package.json`
- Verify: `apps/server/migrate-mongo-config.js`
- Verify: `apps/server/migrations/20260418193000-add-users-telegram-id-unique-index.js`
- Verify: `apps/server/src/test/migrations/add-users-telegram-id-unique-index.test.js`

- [ ] **Step 1: Run the full server test suite**

Run:

```bash
npm run test -w server
```

Expected: all existing TypeScript tests and the new JavaScript migration test pass.

- [ ] **Step 2: Run the server lint command**

Run:

```bash
npm run lint -w server
```

Expected: ESLint exits with 0 errors.

- [ ] **Step 3: Run the server formatter**

Run:

```bash
npm run format -w server
```

Expected: the updated server workspace files are normalized according to the repo rules.

- [ ] **Step 4: Run a real migration status check**

Run:

```bash
npm run migrate:status -w server
```

Expected:
- if `DATABASE_URL` points at a reachable database, the command prints the migration table and shows `20260418193000-add-users-telegram-id-unique-index.js` as `PENDING` or with an applied timestamp
- if `DATABASE_URL` is missing or the database is unreachable, the command fails with a connection/configuration error rather than an npm-script or module-resolution error

- [ ] **Step 5: Smoke-test `up` and `down` against a real local database**

Run:

```bash
npm run migrate:up -w server
npm run migrate:down -w server
```

Expected:
- `migrate:up` applies `20260418193000-add-users-telegram-id-unique-index.js`
- `migrate:down` reverts that same migration
- the commands stop on any MongoDB duplicate-key error, matching the agreed fail-fast behavior

- [ ] **Step 6: Commit the verified final state**

Run:

```bash
git add apps/server/package.json apps/server/migrate-mongo-config.js apps/server/migrations/20260418193000-add-users-telegram-id-unique-index.js apps/server/src/test/migrations/add-users-telegram-id-unique-index.test.js package-lock.json
git commit -m "feat: add MongoDB migrations"
```
