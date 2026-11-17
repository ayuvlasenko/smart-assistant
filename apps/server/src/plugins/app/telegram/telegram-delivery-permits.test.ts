import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setTimeout } from "node:timers/promises";
import { TelegramDeliveryPermits } from "./telegram-delivery-permits.js";

void describe("TelegramDeliveryPermits", () => {
    void it("runs no more deliveries of a bot at once than the limit", async () => {
        const permits = new TelegramDeliveryPermits(2);
        let running = 0;
        let mostRunning = 0;

        await Promise.all(
            Array.from({ length: 7 }, () =>
                permits.run("1", async () => {
                    running++;
                    mostRunning = Math.max(mostRunning, running);
                    await setTimeout(10);
                    running--;
                }),
            ),
        );

        assert.equal(mostRunning, 2);
    });

    void it("starts the waiting deliveries in the order they came", async () => {
        const permits = new TelegramDeliveryPermits(1);
        const started: number[] = [];

        await Promise.all(
            [1, 2, 3].map((delivery) =>
                permits.run("1", async () => {
                    started.push(delivery);
                    await setTimeout(5);
                }),
            ),
        );

        assert.deepEqual(started, [1, 2, 3]);
    });

    void it("gives the permit back when a delivery fails", async () => {
        const permits = new TelegramDeliveryPermits(1);
        const failure = new Error("failed");

        await assert.rejects(
            permits.run("1", () => Promise.reject(failure)),
            failure,
        );

        assert.equal(
            await permits.run("1", () => Promise.resolve("done")),
            "done",
        );
    });

    void it("does not make a bot wait for the deliveries of another bot", async () => {
        const permits = new TelegramDeliveryPermits(1);
        const blocked = Promise.withResolvers<void>();
        const first = permits.run("1", () => blocked.promise);

        assert.equal(
            await permits.run("2", () => Promise.resolve("done")),
            "done",
        );

        blocked.resolve();
        await first;
    });
});
