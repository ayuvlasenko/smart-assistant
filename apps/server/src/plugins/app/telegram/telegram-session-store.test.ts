import { Type } from "@sinclair/typebox";
import assert from "node:assert/strict";
import { describe, it, TestContext } from "node:test";
import { buildCacheServiceTestApp } from "../../../test/cache-service-helper.js";
import { LockLostError } from "../lock-errors.js";
import { TelegramSessionStore } from "./telegram-session-store.js";

const noteSchema = Type.Object({ text: Type.String() });

void describe("TelegramSessionStore", () => {
    void it("reads the fields written by an earlier session", async (t) => {
        const { store } = await buildStore(t);

        await store.withSession(1, async (session) => {
            session.write("note", { text: "hello" }, 60_000);
        });

        const note = await store.withSession(1, (session) =>
            session.read("note", noteSchema),
        );

        assert.deepEqual(note, { text: "hello" });
    });

    void it("keeps sessions of different users apart", async (t) => {
        const { store } = await buildStore(t);

        await store.withSession(1, async (session) => {
            session.write("note", { text: "first" }, 60_000);
        });

        const note = await store.withSession(2, (session) =>
            session.read("note", noteSchema),
        );

        assert.equal(note, undefined);
    });

    void it("removes a field", async (t) => {
        const { store } = await buildStore(t);

        await store.withSession(1, async (session) => {
            session.write("note", { text: "hello" }, 60_000);
        });
        await store.withSession(1, async (session) => {
            session.remove("note");
        });

        const note = await store.withSession(1, (session) =>
            session.read("note", noteSchema),
        );

        assert.equal(note, undefined);
    });

    void it("saves the session when the handler fails", async (t) => {
        const { store } = await buildStore(t);

        await assert.rejects(
            () =>
                store.withSession(1, async (session) => {
                    session.write("note", { text: "hello" }, 60_000);
                    throw new Error("Handler failed");
                }),
            { message: "Handler failed" },
        );

        const note = await store.withSession(1, (session) =>
            session.read("note", noteSchema),
        );

        assert.deepEqual(note, { text: "hello" });
    });

    void it("throws a lost lock error instead of saving after the lock is lost", async (t) => {
        const { cache, store } = await buildStore(t);

        await assert.rejects(
            () =>
                store.withSession(1, async (session) => {
                    session.write("note", { text: "hello" }, 60_000);
                    await cache.delete("telegram:session:1:lock");
                }),
            LockLostError,
        );

        const note = await store.withSession(1, (session) =>
            session.read("note", noteSchema),
        );

        assert.equal(note, undefined);
    });

    void it("doesn't write a session without changes", async (t) => {
        const { cache, store } = await buildStore(t);

        const note = await store.withSession(1, async (session) => {
            const value = await session.read("note", noteSchema);

            await cache.delete("telegram:session:1:lock");

            return value;
        });

        assert.equal(note, undefined);
    });
});

async function buildStore(t: TestContext) {
    const testApp = await buildCacheServiceTestApp({ t });

    return {
        ...testApp,
        store: new TelegramSessionStore(testApp.cache, testApp.lockService),
    };
}
