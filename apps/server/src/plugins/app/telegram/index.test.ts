import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveTelegramWebhookUrl } from "./index.js";

void describe("resolveTelegramWebhookUrl", () => {
    void it("builds a resource-specific webhook URL when no explicit override is set", () => {
        const webhookUrl = resolveTelegramWebhookUrl({
            DOMAIN: "https://smart-assistant.bambom.org",
            RESOURCE_NAME: "pr-123",
        });

        assert.equal(
            webhookUrl,
            "https://smart-assistant.bambom.org/api/telegram/webhook/pr-123",
        );
    });

    void it("uses the explicit webhook URL override when it is present", () => {
        const webhookUrl = resolveTelegramWebhookUrl({
            DOMAIN: "https://smart-assistant.bambom.org",
            RESOURCE_NAME: "pr-123",
            TELEGRAM_WEBHOOK_URL:
                "https://proxy3020.bambom.org/api/telegram/webhook/custom",
        });

        assert.equal(
            webhookUrl,
            "https://proxy3020.bambom.org/api/telegram/webhook/custom",
        );
    });
});
