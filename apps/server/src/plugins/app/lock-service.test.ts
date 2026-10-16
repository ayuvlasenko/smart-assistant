import assert from "node:assert/strict";
import { once } from "node:events";
import { describe, it } from "node:test";
import { setTimeout } from "node:timers/promises";
import { buildCacheServiceTestApp } from "../../test/cache-service-helper.js";
import { LockHoldTimeoutError, LockLostError } from "./lock-errors.js";
import { LockOptions } from "./lock-service.js";

const lockOptions: LockOptions = {
    name: "test",
    ttlMilliseconds: 10_000,
    maxHoldMilliseconds: 10_000,
};

void describe("LockService", () => {
    void it("waits until the owner releases the lock", async (t) => {
        const { lockService } = await buildCacheServiceTestApp({ t });
        const events: string[] = [];

        const first = await lockService.acquire("lock:1", lockOptions);
        const second = lockService
            .acquire("lock:1", lockOptions)
            .then(async (lock) => {
                events.push("second");
                await lock[Symbol.asyncDispose]();
            });

        await setTimeout(100);
        events.push("first");
        await first[Symbol.asyncDispose]();
        await second;

        assert.deepEqual(events, ["first", "second"]);
    });

    void it("waits for a taken lock until its TTL runs out", async (t) => {
        const { client, lockService } = await buildCacheServiceTestApp({ t });

        await client.set("lock:2", "other", "PX", 300);
        const lock = await lockService.acquire("lock:2", lockOptions);
        await lock[Symbol.asyncDispose]();

        assert.notEqual(lock.token, "other");
    });

    void it("aborts the signal and stops the renewal after the maximum hold time", async (t) => {
        const { client, lockService } = await buildCacheServiceTestApp({ t });

        const lock = await lockService.acquire("lock:7", {
            ...lockOptions,
            ttlMilliseconds: 150,
            maxHoldMilliseconds: 100,
        });
        await once(lock.signal, "abort");
        await setTimeout(300);
        const heldToken = await client.get("lock:7");
        await lock[Symbol.asyncDispose]();

        assert.ok(lock.signal.reason instanceof LockHoldTimeoutError);
        assert.equal(heldToken, null);
    });

    void it("aborts the signal when another owner takes the lock", async (t) => {
        const { client, lockService } = await buildCacheServiceTestApp({ t });

        const lock = await lockService.acquire("lock:8", {
            ...lockOptions,
            ttlMilliseconds: 150,
        });
        await client.set("lock:8", "other", "PX", 10_000);
        await once(lock.signal, "abort");
        await lock[Symbol.asyncDispose]();

        assert.ok(lock.signal.reason instanceof LockLostError);
    });

    void it("keeps the signal after the lock is released", async (t) => {
        const { lockService } = await buildCacheServiceTestApp({ t });

        const lock = await lockService.acquire("lock:9", {
            ...lockOptions,
            maxHoldMilliseconds: 100,
        });
        await lock[Symbol.asyncDispose]();
        await setTimeout(200);

        assert.equal(lock.signal.aborted, false);
    });

    void it("keeps the lock past its TTL while it is held", async (t) => {
        const { client, lockService } = await buildCacheServiceTestApp({ t });

        const lock = await lockService.acquire("lock:3", {
            ...lockOptions,
            ttlMilliseconds: 150,
        });
        await setTimeout(400);
        const heldToken = await client.get("lock:3");
        await lock[Symbol.asyncDispose]();

        assert.equal(heldToken, JSON.stringify(lock.token));
        assert.equal(await client.get("lock:3"), null);
    });

    void it("takes a lock after a stale owner's TTL runs out", async (t) => {
        const { client, lockService } = await buildCacheServiceTestApp({ t });

        await client.set("lock:5", "stale", "PX", 50);
        const lock = await lockService.acquire("lock:5", lockOptions);
        await lock[Symbol.asyncDispose]();

        assert.notEqual(lock.token, "stale");
    });

    void it("does not release or extend a lock that another owner took", async (t) => {
        const { client, lockService } = await buildCacheServiceTestApp({ t });

        const lock = await lockService.acquire("lock:6", {
            ...lockOptions,
            ttlMilliseconds: 150,
        });
        await client.set("lock:6", "other", "PX", 10_000);
        await setTimeout(200);
        await lock[Symbol.asyncDispose]();

        assert.equal(await client.get("lock:6"), "other");
        assert.ok((await client.pttl("lock:6")) > 1_000);
    });

    void it("gives a claim to one caller until it is released", async (t) => {
        const { lockService } = await buildCacheServiceTestApp({ t });

        const first = await lockService.tryAcquire("claim:1", 10_000);
        const second = await lockService.tryAcquire("claim:1", 10_000);

        assert.ok(first);
        assert.equal(second, undefined);

        await lockService.release(first);

        assert.ok(await lockService.tryAcquire("claim:1", 10_000));
    });

    void it("records the wait and hold times by lock name", async (t) => {
        const { lockService, metrics } = await buildCacheServiceTestApp({ t });

        const lock = await lockService.acquire("lock:4", lockOptions);
        await lock[Symbol.asyncDispose]();
        const output = await metrics.metrics();

        assert.match(output, /^lock_wait_seconds_count\{name="test"\} 1$/m);
        assert.match(output, /^lock_hold_seconds_count\{name="test"\} 1$/m);
    });
});
