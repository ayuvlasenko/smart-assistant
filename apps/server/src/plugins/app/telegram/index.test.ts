import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTestApp } from "../../../test/helper.js";
import { createLogCollector } from "../../../test/log-collector.js";

void describe("telegram plugin on listen", () => {
    void it("sets the webhook once on production", async (t) => {
        const logs = createLogCollector();
        const { app, telegramApiService } = await buildTestApp({
            t,
            environment: "production",
            logger: logs.logger,
        });

        await app.listen({ port: 0, host: "127.0.0.1" });
        await logs.waitForEntry(
            (entry) => entry.msg === "Telegram webhook set successfully",
        );

        assert.equal(telegramApiService.setWebhook.mock.callCount(), 1);
    });

    void it("reports the skipped webhook on preview", async (t) => {
        const logs = createLogCollector();
        const { app } = await buildTestApp({
            t,
            environment: "preview",
            logger: logs.logger,
        });

        await app.listen({ port: 0, host: "127.0.0.1" });
        const skipEntry = await logs.waitForEntry(
            (entry) =>
                entry.msg ===
                "Telegram webhook is not set on preview start, claim it with POST /api/telegram/webhook/refresh",
        );

        assert.equal(skipEntry.module, "telegram");
    });
});
