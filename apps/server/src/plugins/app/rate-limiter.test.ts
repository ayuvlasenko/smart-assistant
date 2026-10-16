import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setTimeout } from "node:timers/promises";
import { buildCacheServiceTestApp } from "../../test/cache-service-helper.js";
import { RateLimitBucket, RateLimiter } from "./rate-limiter.js";

const shares = { interactive: 0.8, background: 0.2 };

void describe("RateLimiter", () => {
    void it("lets a burst through and then waits for the next token", async (t) => {
        const { rateLimiter } = await buildCacheServiceTestApp({ t });
        const bucket = { key: "rate:burst", ratePerSecond: 2, burst: 3 };

        const waits = [];
        for (let index = 0; index < 4; index++) {
            waits.push(await acquire(rateLimiter, bucket));
        }

        const [first = 0, second = 0, third = 0, fourth = 0] = waits;
        const slowestOfBurst = Math.max(first, second, third);

        assert.ok(
            fourth - slowestOfBurst >= 200,
            `waits were ${waits.join(", ")}`,
        );
        assert.ok(fourth < 900, `waits were ${waits.join(", ")}`);
    });

    void it("makes a paused bucket wait for the delay", async (t) => {
        const { rateLimiter } = await buildCacheServiceTestApp({ t });
        const bucket = { key: "rate:pause", ratePerSecond: 20, burst: 3 };

        await rateLimiter.pause(bucket, 300);
        const wait = await acquire(rateLimiter, bucket);

        assert.ok(wait >= 250 && wait < 600);
    });

    void it("rejects a wait with the reason of the aborted signal", async (t) => {
        const { rateLimiter } = await buildCacheServiceTestApp({ t });
        const reason = new Error("stopped");
        const own = { key: "rate:abort:own", ratePerSecond: 1, burst: 1 };
        const shared = { ...own, key: "rate:abort:shared", shares };

        await acquire(rateLimiter, own);
        await acquire(rateLimiter, shared);
        const controller = new AbortController();
        const waits = [own, shared].map((bucket) =>
            rateLimiter.acquire(bucket, {
                className: "interactive",
                signal: controller.signal,
            }),
        );
        await setTimeout(50);
        controller.abort(reason);

        for (const wait of waits) {
            await assert.rejects(wait, reason);
        }
    });

    void it("gives the whole rate to a class that waits alone", async (t) => {
        const { rateLimiter } = await buildCacheServiceTestApp({ t });
        const bucket = {
            key: "rate:alone",
            ratePerSecond: 100,
            burst: 1,
            shares,
        };
        const startedAt = performance.now();

        await Promise.all(
            Array.from({ length: 20 }, () =>
                acquire(rateLimiter, bucket, "background"),
            ),
        );

        assert.ok(performance.now() - startedAt < 600);
    });

    void it("splits the rate by shares while both classes wait", async (t) => {
        const { rateLimiter } = await buildCacheServiceTestApp({ t });
        const bucket = {
            key: "rate:split",
            ratePerSecond: 100,
            burst: 5,
            shares,
        };

        const granted = await countGrants(t.signal, bucket, [
            [rateLimiter, "interactive"],
            [rateLimiter, "background"],
        ]);

        assertSplit(granted, bucket);
    });

    void it("keeps almost the whole rate for a class while the other comes rarely", async (t) => {
        const { rateLimiter } = await buildCacheServiceTestApp({ t });
        const bucket = {
            key: "rate:rare",
            ratePerSecond: 100,
            burst: 5,
            shares,
        };
        const rareSends = (async () => {
            for (let index = 0; index < 10; index++) {
                await setTimeout(100);
                await acquire(rateLimiter, bucket, "interactive");
            }
        })();

        const granted = await countGrants(t.signal, bucket, [
            [rateLimiter, "background"],
        ]);
        await rareSends;

        assert.ok(
            (granted.background ?? 0) >= 75,
            `background got ${granted.background} tokens`,
        );
    });

    void it("splits the rate by shares between limiters of different pods", async (t) => {
        const { client, rateLimiter } = await buildCacheServiceTestApp({ t });
        const otherPod = new RateLimiter(client);
        const bucket = {
            key: "rate:pods",
            ratePerSecond: 100,
            burst: 5,
            shares,
        };

        const granted = await countGrants(t.signal, bucket, [
            [rateLimiter, "interactive"],
            [otherPod, "background"],
        ]);

        assertSplit(granted, bucket);
    });
});

function acquire(
    rateLimiter: RateLimiter,
    bucket: RateLimitBucket,
    className = "interactive",
): Promise<number> {
    return rateLimiter.acquire(bucket, { className });
}

async function countGrants(
    testSignal: AbortSignal,
    bucket: RateLimitBucket,
    waiters: [RateLimiter, string][],
): Promise<Record<string, number>> {
    const granted: Record<string, number> = {};
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, testSignal]);
    const loops = waiters.flatMap(([rateLimiter, className]) =>
        Array.from({ length: 10 }, async () => {
            for (;;) {
                await rateLimiter.acquire(bucket, { className, signal });
                granted[className] = (granted[className] ?? 0) + 1;
            }
        }),
    );

    await setTimeout(1_000);
    controller.abort(new Error("done"));
    await Promise.allSettled(loops);

    return granted;
}

function assertSplit(
    granted: Record<string, number>,
    bucket: RateLimitBucket,
): void {
    const interactive = granted.interactive ?? 0;
    const background = granted.background ?? 0;

    assert.ok(
        interactive + background <= bucket.ratePerSecond + bucket.burst + 2,
        `granted ${interactive + background} tokens in a second`,
    );
    assert.ok(
        interactive >= 70 && interactive <= 90,
        `interactive got ${interactive} tokens`,
    );
    assert.ok(
        background >= 15 && background <= 30,
        `background got ${background} tokens`,
    );
}
