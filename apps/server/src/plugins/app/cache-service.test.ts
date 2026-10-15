import { Type } from "@sinclair/typebox";
import { ObjectId } from "mongodb";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setTimeout } from "node:timers/promises";
import { buildCacheServiceTestApp } from "../../test/cache-service-helper.js";
import { buildTestValkey } from "../../test/valkey.js";

const userIdSchema = Type.Object({ id: Type.String() });

const userSchema = Type.Object({
    id: Type.String(),
    name: Type.String(),
});

const objectIdSchema = Type.Transform(Type.String())
    .Decode((value) => new ObjectId(value))
    .Encode((value) => value.toHexString());

const dateSchema = Type.Transform(Type.String())
    .Decode((value) => new Date(value))
    .Encode((value) => value.toISOString());

const cachedDocumentSchema = Type.Object({
    _id: objectIdSchema,
    createdAt: dateSchema,
    updatedAt: dateSchema,
});

void describe("CacheService", () => {
    void it("writes plain JSON with a required TTL and configured prefix", async (t) => {
        const { cache, client, keyPrefix } = await buildCacheServiceTestApp({
            t,
        });

        await cache.set(
            "users:1",
            { id: "1", name: "Ada" },
            { ttlMilliseconds: 30_000 },
        );

        const { client: unprefixedClient } = await buildTestValkey(t, {
            keyPrefix,
        });
        const ttl = await client.ttl("users:1");

        assert.equal(
            await unprefixedClient.get(`${keyPrefix}users:1`),
            JSON.stringify({ id: "1", name: "Ada" }),
        );
        assert.ok(ttl > 0);
        assert.ok(ttl <= 30);
    });

    void it("writes JSON only when the key is missing", async (t) => {
        const { cache, client } = await buildCacheServiceTestApp({
            t,
        });

        const firstWrite = await cache.set(
            "jobs:1",
            { id: "1", status: "queued" },
            { ttlMilliseconds: 30_000, ifMissing: true },
        );
        const secondWrite = await cache.set(
            "jobs:1",
            { id: "1", status: "running" },
            { ttlMilliseconds: 30_000, ifMissing: true },
        );
        const key = "jobs:1";
        const ttl = await client.ttl(key);

        assert.equal(firstWrite, true);
        assert.equal(secondWrite, false);
        assert.equal(
            await client.get(key),
            JSON.stringify({ id: "1", status: "queued" }),
        );
        assert.ok(ttl > 0);
        assert.ok(ttl <= 30);
    });

    void it("writes a value only while the condition key holds the expected value", async (t) => {
        const { cache } = await buildCacheServiceTestApp({ t });
        const ifEquals = { key: "owner:1", value: "ada" };

        await cache.set("owner:1", "bob", { ttlMilliseconds: 30_000 });
        const rejectedWrite = await cache.set("jobs:2", "queued", {
            ttlMilliseconds: 30_000,
            ifEquals,
        });
        await cache.set("owner:1", "ada", { ttlMilliseconds: 30_000 });
        const acceptedWrite = await cache.set("jobs:2", "running", {
            ttlMilliseconds: 30_000,
            ifEquals,
        });

        assert.equal(rejectedWrite, false);
        assert.equal(acceptedWrite, true);
        assert.equal(await cache.get("jobs:2", Type.String()), "running");
    });

    void it("deletes a key only while the condition holds", async (t) => {
        const { cache } = await buildCacheServiceTestApp({ t });

        await cache.set("lock:1", "ada", { ttlMilliseconds: 30_000 });

        assert.equal(
            await cache.delete("lock:1", {
                ifEquals: { key: "lock:1", value: "bob" },
            }),
            false,
        );
        assert.equal(await cache.get("lock:1", Type.String()), "ada");
        assert.equal(
            await cache.delete("lock:1", {
                ifEquals: { key: "lock:1", value: "ada" },
            }),
            true,
        );
        assert.equal(await cache.get("lock:1", Type.String()), undefined);
        assert.equal(await cache.delete("lock:1"), false);
    });

    void it("changes the TTL of a key only while the condition holds", async (t) => {
        const { cache, client } = await buildCacheServiceTestApp({ t });

        await cache.set("lock:2", "ada", { ttlMilliseconds: 1_000 });

        assert.equal(
            await cache.expire("lock:2", 60_000, {
                ifEquals: { key: "lock:2", value: "bob" },
            }),
            false,
        );
        assert.ok((await client.pttl("lock:2")) <= 1_000);
        assert.equal(
            await cache.expire("lock:2", 60_000, {
                ifEquals: { key: "lock:2", value: "ada" },
            }),
            true,
        );
        assert.ok((await client.pttl("lock:2")) > 1_000);
        assert.equal(await cache.expire("missing:1", 60_000), false);
    });

    void it("rejects non-positive TTL values", async (t) => {
        const { cache } = await buildCacheServiceTestApp({ t });

        await assert.rejects(
            () =>
                cache.set(
                    "users:1",
                    { id: "1", name: "Ada" },
                    {
                        ttlMilliseconds: 0,
                    },
                ),
            { message: "Cache TTL must be a positive integer" },
        );
        await assert.rejects(() => cache.expire("users:1", 0), {
            message: "Cache TTL must be a positive integer",
        });
    });

    void it("returns undefined for missing values", async (t) => {
        const { cache } = await buildCacheServiceTestApp({ t });

        assert.equal(await cache.get("users:1", userSchema), undefined);
    });

    void it("returns decoded values that match the schema", async (t) => {
        const { cache, client } = await buildCacheServiceTestApp({
            t,
        });

        await client.set("users:1", JSON.stringify({ id: "1", name: "Ada" }));

        assert.deepEqual(await cache.get("users:1", userSchema), {
            id: "1",
            name: "Ada",
        });
    });

    void it("serializes and deserializes ObjectId and Date values through schema transforms", async (t) => {
        const { cache, client } = await buildCacheServiceTestApp({
            t,
        });
        const objectId = new ObjectId();
        const createdAt = new Date("2026-04-28T10:30:00.000Z");
        const updatedAt = new Date("2026-04-28T10:45:00.000Z");

        await cache.set(
            "documents:1",
            {
                _id: objectId,
                createdAt,
                updatedAt,
            },
            { ttlMilliseconds: 30_000 },
        );

        const expectedValue = {
            _id: objectId.toHexString(),
            createdAt: createdAt.toISOString(),
            updatedAt: updatedAt.toISOString(),
        };

        assert.equal(
            await client.get("documents:1"),
            JSON.stringify(expectedValue),
        );

        const decoded = await cache.get("documents:1", cachedDocumentSchema);

        assert.ok(decoded);
        assert.ok(decoded._id instanceof ObjectId);
        assert.ok(decoded.createdAt instanceof Date);
        assert.ok(decoded.updatedAt instanceof Date);
        assert.ok(decoded._id.equals(objectId));
        assert.equal(decoded.createdAt.toISOString(), createdAt.toISOString());
        assert.equal(decoded.updatedAt.toISOString(), updatedAt.toISOString());
    });

    void it("deletes invalid JSON and returns a cache miss", async (t) => {
        const { cache, client } = await buildCacheServiceTestApp({
            t,
        });
        const key = "users:1";

        await client.set(key, "{");

        assert.equal(await cache.get("users:1", userSchema), undefined);
        assert.equal(await client.get(key), null);
    });

    void it("deletes schema-invalid JSON and returns a cache miss", async (t) => {
        const { cache, client } = await buildCacheServiceTestApp({
            t,
        });
        const key = "users:1";

        await client.set(key, JSON.stringify({ id: "1" }));

        assert.equal(await cache.get("users:1", userSchema), undefined);
        assert.equal(await client.get(key), null);
    });

    void it("loads and stores a missing value through remember", async (t) => {
        const { cache, client } = await buildCacheServiceTestApp({
            t,
        });

        const value = await cache.remember(
            "users:1",
            userSchema,
            60_000,
            async () => ({
                id: "1",
                name: "Ada",
            }),
        );

        assert.deepEqual(value, { id: "1", name: "Ada" });
        assert.equal(
            await client.get("users:1"),
            JSON.stringify({ id: "1", name: "Ada" }),
        );
    });

    void it("returns cached values through remember without loading", async (t) => {
        const { cache, client } = await buildCacheServiceTestApp({
            t,
        });

        await client.set("users:1", JSON.stringify({ id: "1", name: "Ada" }));

        const value = await cache.remember(
            "users:1",
            userSchema,
            60_000,
            async () => {
                throw new Error("loader should not run");
            },
        );

        assert.deepEqual(value, { id: "1", name: "Ada" });
    });

    void it("updates hash fields only while the condition holds", async (t) => {
        const { cache } = await buildCacheServiceTestApp({ t });
        const ifEquals = { key: "lock:4", value: "owner" };
        const otherCondition = { key: "lock:4", value: "other" };
        const write = {
            field: "user",
            value: { id: "1" },
            ttlMilliseconds: 60_000,
        };

        await cache.set("lock:4", "owner", { ttlMilliseconds: 10_000 });
        assert.equal(
            await cache.updateHash(
                "hash:4",
                { writes: [write], removals: [] },
                { ifEquals: otherCondition },
            ),
            false,
        );
        assert.equal(
            await cache.getHashField("hash:4", "user", userIdSchema),
            undefined,
        );
        assert.equal(
            await cache.updateHash(
                "hash:4",
                { writes: [write], removals: [] },
                { ifEquals },
            ),
            true,
        );
        assert.deepEqual(
            await cache.getHashField("hash:4", "user", userIdSchema),
            { id: "1" },
        );
        assert.equal(
            await cache.updateHash("hash:4", {
                writes: [],
                removals: ["user"],
            }),
            true,
        );
        assert.equal(
            await cache.getHashField("hash:4", "user", userIdSchema),
            undefined,
        );
    });

    void it("expires each hash field after its own TTL", async (t) => {
        const { cache } = await buildCacheServiceTestApp({ t });

        await cache.updateHash("hash:5", {
            writes: [
                { field: "short", value: { id: "1" }, ttlMilliseconds: 100 },
                { field: "long", value: { id: "2" }, ttlMilliseconds: 60_000 },
            ],
            removals: [],
        });
        await setTimeout(200);

        assert.equal(
            await cache.getHashField("hash:5", "short", userIdSchema),
            undefined,
        );
        assert.deepEqual(
            await cache.getHashField("hash:5", "long", userIdSchema),
            { id: "2" },
        );
    });

    void it("deletes an invalid hash field and returns a cache miss", async (t) => {
        const { cache, client } = await buildCacheServiceTestApp({
            t,
        });
        const key = "hash:6";

        await client.hset(
            key,
            "user",
            JSON.stringify({ name: 1 }),
            "other",
            "{}",
        );

        assert.equal(
            await cache.getHashField("hash:6", "user", userIdSchema),
            undefined,
        );
        assert.equal(await client.hget(key, "user"), null);
        assert.equal(await client.hget(key, "other"), "{}");
    });

    void it("rejects non-positive TTL values for hash fields", async (t) => {
        const { cache } = await buildCacheServiceTestApp({ t });

        await assert.rejects(
            () =>
                cache.updateHash("hash:7", {
                    writes: [{ field: "user", value: {}, ttlMilliseconds: 0 }],
                    removals: [],
                }),
            { message: "Cache TTL must be a positive integer" },
        );
    });
});
