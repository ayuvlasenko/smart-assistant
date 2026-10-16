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
});
