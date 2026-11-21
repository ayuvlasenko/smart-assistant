import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RateLimitGrant, RateLimitQueue } from "./rate-limit-queue.js";

void describe("RateLimitQueue", () => {
    void it("serves a class that joins while a take is pending", async () => {
        const firstTake = Promise.withResolvers<RateLimitGrant>();
        let takes = 0;
        const queue = new RateLimitQueue(
            ["interactive", "background"],
            async (waitingClasses) => {
                takes++;

                if (takes === 1) {
                    return firstTake.promise;
                }

                const className = waitingClasses.has("interactive")
                    ? "interactive"
                    : [...waitingClasses][0];

                return { className, waitMilliseconds: 0 };
            },
        );

        const background = queue.acquire("background");
        const interactive = queue.acquire("interactive");
        firstTake.resolve({ className: undefined, waitMilliseconds: 5_000 });

        assert.ok((await interactive) < 1_000);
        await background;
    });

    void it("fails every waiting call when a take fails, then goes idle and serves the next call", async () => {
        const failingTake = Promise.withResolvers<RateLimitGrant>();
        let idle = Promise.withResolvers<void>();
        let takes = 0;
        const queue = new RateLimitQueue(
            ["interactive", "background"],
            async (waitingClasses) => {
                takes++;

                if (takes === 1) {
                    return failingTake.promise;
                }

                return {
                    className: [...waitingClasses][0],
                    waitMilliseconds: 0,
                };
            },
            () => {
                idle.resolve();
            },
        );

        const interactive = queue.acquire("interactive");
        const background = queue.acquire("background");
        failingTake.reject(new Error("Valkey is down"));

        await Promise.all([
            assert.rejects(interactive, { message: "Valkey is down" }),
            assert.rejects(background, { message: "Valkey is down" }),
        ]);
        await idle.promise;

        idle = Promise.withResolvers<void>();

        await queue.acquire("interactive");
        await idle.promise;
    });
});
