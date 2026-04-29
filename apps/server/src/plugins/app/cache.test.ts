import { Type } from "@sinclair/typebox";
import { ObjectId } from "mongodb";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCacheServiceTestApp } from "../../test/cache-service-helper.js";
import { CacheService } from "./cache.js";

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

        await cache.setJson("users:1", { id: "1", name: "Ada" }, 30);

        const key = `${keyPrefix}users:1`;
        const ttl = await client.ttl(key);

        assert.equal(
            await client.get(key),
            JSON.stringify({ id: "1", name: "Ada" }),
        );
        assert.ok(ttl > 0);
        assert.ok(ttl <= 30);
    });

    void it("writes JSON only when the key is missing", async (t) => {
        const { cache, client, keyPrefix } = await buildCacheServiceTestApp({
            t,
        });

        const firstWrite = await cache.setJsonIfMissing(
            "jobs:1",
            { id: "1", status: "queued" },
            30,
        );
        const secondWrite = await cache.setJsonIfMissing(
            "jobs:1",
            { id: "1", status: "running" },
            30,
        );
        const key = `${keyPrefix}jobs:1`;
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

    void it("rejects non-positive TTL values for missing-only writes", async (t) => {
        const { cache } = await buildCacheServiceTestApp({ t });

        await assert.rejects(
            () => cache.setJsonIfMissing("jobs:1", { id: "1" }, 0),
            { message: "Cache TTL must be a positive integer" },
        );
    });

    void it("rejects non-positive TTL values", async (t) => {
        const { cache } = await buildCacheServiceTestApp({ t });

        await assert.rejects(
            () => cache.setJson("users:1", { id: "1", name: "Ada" }, 0),
            { message: "Cache TTL must be a positive integer" },
        );
    });

    void it("rejects key prefixes that end with a separator", async (t) => {
        const { app, client, keyPrefix } = await buildCacheServiceTestApp({
            t,
        });

        assert.throws(() => new CacheService(client, keyPrefix, app.log), {
            message: "Cache key prefix must not end with ':'",
        });
    });

    void it("returns undefined for missing values", async (t) => {
        const { cache } = await buildCacheServiceTestApp({ t });

        assert.equal(await cache.getJson("users:1", userSchema), undefined);
    });

    void it("returns decoded values that match the schema", async (t) => {
        const { cache, client, keyPrefix } = await buildCacheServiceTestApp({
            t,
        });

        await client.set(
            `${keyPrefix}users:1`,
            JSON.stringify({ id: "1", name: "Ada" }),
        );

        assert.deepEqual(await cache.getJson("users:1", userSchema), {
            id: "1",
            name: "Ada",
        });
    });

    void it("serializes and deserializes ObjectId and Date values through schema transforms", async (t) => {
        const { cache, client, keyPrefix } = await buildCacheServiceTestApp({
            t,
        });
        const objectId = new ObjectId();
        const createdAt = new Date("2026-04-28T10:30:00.000Z");
        const updatedAt = new Date("2026-04-28T10:45:00.000Z");

        await cache.setJson(
            "documents:1",
            {
                _id: objectId,
                createdAt,
                updatedAt,
            },
            30,
        );

        const expectedValue = {
            _id: objectId.toHexString(),
            createdAt: createdAt.toISOString(),
            updatedAt: updatedAt.toISOString(),
        };

        assert.equal(
            await client.get(`${keyPrefix}documents:1`),
            JSON.stringify(expectedValue),
        );

        const decoded = await cache.getJson(
            "documents:1",
            cachedDocumentSchema,
        );

        assert.ok(decoded);
        assert.ok(decoded._id instanceof ObjectId);
        assert.ok(decoded.createdAt instanceof Date);
        assert.ok(decoded.updatedAt instanceof Date);
        assert.ok(decoded._id.equals(objectId));
        assert.equal(decoded.createdAt.toISOString(), createdAt.toISOString());
        assert.equal(decoded.updatedAt.toISOString(), updatedAt.toISOString());
    });

    void it("deletes invalid JSON and returns a cache miss", async (t) => {
        const { cache, client, keyPrefix } = await buildCacheServiceTestApp({
            t,
        });
        const key = `${keyPrefix}users:1`;

        await client.set(key, "{");

        assert.equal(await cache.getJson("users:1", userSchema), undefined);
        assert.equal(await client.get(key), null);
    });

    void it("deletes schema-invalid JSON and returns a cache miss", async (t) => {
        const { cache, client, keyPrefix } = await buildCacheServiceTestApp({
            t,
        });
        const key = `${keyPrefix}users:1`;

        await client.set(key, JSON.stringify({ id: "1" }));

        assert.equal(await cache.getJson("users:1", userSchema), undefined);
        assert.equal(await client.get(key), null);
    });

    void it("loads and stores a missing value through rememberJson", async (t) => {
        const { cache, client, keyPrefix } = await buildCacheServiceTestApp({
            t,
        });

        const value = await cache.rememberJson(
            "users:1",
            userSchema,
            60,
            async () => ({
                id: "1",
                name: "Ada",
            }),
        );

        assert.deepEqual(value, { id: "1", name: "Ada" });
        assert.equal(
            await client.get(`${keyPrefix}users:1`),
            JSON.stringify({ id: "1", name: "Ada" }),
        );
    });

    void it("returns cached values through rememberJson without loading", async (t) => {
        const { cache, client, keyPrefix } = await buildCacheServiceTestApp({
            t,
        });

        await client.set(
            `${keyPrefix}users:1`,
            JSON.stringify({ id: "1", name: "Ada" }),
        );

        const value = await cache.rememberJson(
            "users:1",
            userSchema,
            60,
            async () => {
                throw new Error("loader should not run");
            },
        );

        assert.deepEqual(value, { id: "1", name: "Ada" });
    });
});
