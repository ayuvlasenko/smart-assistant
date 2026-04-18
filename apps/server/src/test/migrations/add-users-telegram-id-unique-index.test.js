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
