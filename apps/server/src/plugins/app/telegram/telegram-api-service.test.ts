import Fastify from "fastify";
import assert from "node:assert/strict";
import { describe, it, TestContext } from "node:test";
import { createLogCollector } from "../../../test/log-collector.js";
import { MetricsService } from "../metrics-service.js";
import { TelegramApiService } from "./telegram-api-service.js";
import { TelegramMetrics } from "./telegram-metrics.js";

void describe("TelegramApiService", () => {
    void it("records successful requests", async (t) => {
        const { metrics, telegramApiService } = buildApiService(t, {
            ok: true,
            result: true,
        });

        await telegramApiService.setMyCommands({ commands: [] });

        assert.match(
            await metrics.metrics(),
            /^telegram_api_requests_total\{method="setMyCommands",result="ok"\} 1$/m,
        );
    });

    void it("records and logs rejected requests", async (t) => {
        const logs = createLogCollector();
        const { metrics, telegramApiService } = buildApiService(
            t,
            { ok: false, error_code: 403, description: "Forbidden" },
            logs,
        );

        const result = await telegramApiService.sendMessage({
            chat_id: 1,
            text: "hello",
        });

        assert.equal(result.ok, false);
        assert.match(
            await metrics.metrics(),
            /^telegram_api_requests_total\{method="sendMessage",result="error"\} 1$/m,
        );
        assert.ok(
            logs
                .readEntries()
                .some((entry) => entry.msg === "Telegram API request failed"),
        );
    });

    void it("aborts a request that takes longer than the timeout", async (t) => {
        t.mock.method(
            globalThis,
            "fetch",
            (_url: string, init: RequestInit) =>
                new Promise((_resolve, reject) => {
                    init.signal?.addEventListener("abort", () => {
                        const reason: unknown = init.signal?.reason;
                        reject(
                            reason instanceof Error
                                ? reason
                                : new Error("Request was aborted"),
                        );
                    });
                }),
        );
        const metrics = new MetricsService();
        const telegramApiService = new TelegramApiService(
            "token",
            Fastify({ logger: false }).log,
            new TelegramMetrics(metrics),
            50,
        );

        await assert.rejects(() => telegramApiService.getMe(), {
            name: "TimeoutError",
        });
        assert.match(
            await metrics.metrics(),
            /^telegram_api_requests_total\{method="getMe",result="network_error"\} 1$/m,
        );
    });

    void it("records network failures", async (t) => {
        const { metrics, telegramApiService } = buildApiService(t, undefined);

        await assert.rejects(() => telegramApiService.getMe(), {
            message: "network down",
        });
        assert.match(
            await metrics.metrics(),
            /^telegram_api_requests_total\{method="getMe",result="network_error"\} 1$/m,
        );
    });
});

function buildApiService(
    t: TestContext,
    responseBody: object | undefined,
    logs = createLogCollector(),
) {
    t.mock.method(globalThis, "fetch", async () => {
        if (!responseBody) {
            throw new Error("network down");
        }

        return new Response(JSON.stringify(responseBody));
    });

    const metrics = new MetricsService();
    const app = Fastify({ logger: logs.logger });
    const telegramApiService = new TelegramApiService(
        "token",
        app.log,
        new TelegramMetrics(metrics),
    );

    return { metrics, telegramApiService };
}
