import { Redis } from "ioredis";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setTimeout } from "node:timers/promises";
import { buildTestApp } from "../test/helper.js";
import {
    buildTelegramCommandUpdate,
    buildTelegramPrivateChat,
    buildTelegramWebhookHeaders,
    testTelegramWebhookPath,
} from "../test/telegram-fixtures.js";

const healthCheckWaitMilliseconds = 15_000;

void describe("GET /live", () => {
    void it("answers while MongoDB or Valkey is down, and the other routes shed the load", async (t) => {
        const { app } = await buildTestApp({ t });
        const valkey = app.getDecorator<Redis>("valkey");

        valkey.disconnect();

        try {
            const deadline = Date.now() + healthCheckWaitMilliseconds;

            while (!app.isUnderPressure()) {
                assert.ok(
                    Date.now() < deadline,
                    "the health check never failed",
                );
                await setTimeout(100);
            }

            const live = await app.inject({ method: "GET", url: "/live" });
            const metrics = await app.inject({
                method: "GET",
                url: "/metrics",
            });
            const status = await app.inject({ method: "GET", url: "/status" });
            const webhook = await app.inject({
                method: "POST",
                url: testTelegramWebhookPath,
                headers: buildTelegramWebhookHeaders(),
                body: buildTelegramCommandUpdate(
                    buildTelegramPrivateChat({ id: 987654833 }),
                    "/start",
                ),
            });

            assert.equal(live.statusCode, 200);
            assert.deepEqual(live.json(), { status: "ok" });
            assert.equal(metrics.statusCode, 200);
            assert.equal(status.statusCode, 503);
            assert.equal(webhook.statusCode, 503);
        } finally {
            await valkey.connect();
        }
    });
});
