import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTestApp } from "../../../test/helper.js";
import {
    buildTelegramTextMessageUpdate,
    buildTelegramWebhookHeaders,
} from "../../../test/telegram-fixtures.js";

void describe("POST /api/telegram/webhook", () => {
    void it("returns 200 on valid secret", async (t) => {
        const { app } = await buildTestApp({ t });

        const response = await app.inject({
            method: "POST",
            url: "/api/telegram/webhook",
            headers: buildTelegramWebhookHeaders(),
            body: buildTelegramTextMessageUpdate({
                message: {
                    text: "hello",
                },
            }),
        });

        assert.equal(response.statusCode, 200);
    });

    void it("returns 401 on invalid secret", async (t) => {
        const { app } = await buildTestApp({ t });

        const response = await app.inject({
            method: "POST",
            url: "/api/telegram/webhook",
            headers: buildTelegramWebhookHeaders("invalid-secret"),
            body: buildTelegramTextMessageUpdate(),
        });

        assert.equal(response.statusCode, 401);
    });

    void it("returns 400 when secret header is missing", async (t) => {
        const { app } = await buildTestApp({ t });

        const response = await app.inject({
            method: "POST",
            url: "/api/telegram/webhook",
            body: buildTelegramTextMessageUpdate(),
        });

        assert.equal(response.statusCode, 400);
    });
});
