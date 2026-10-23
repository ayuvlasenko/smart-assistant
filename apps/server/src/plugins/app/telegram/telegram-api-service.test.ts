import Fastify from "fastify";
import assert from "node:assert/strict";
import { describe, it, TestContext } from "node:test";
import { setTimeout } from "node:timers/promises";
import { buildCacheServiceTestApp } from "../../../test/cache-service-helper.js";
import { createLogCollector } from "../../../test/log-collector.js";
import { MetricsService } from "../metrics-service.js";
import {
    telegramApiScope,
    TelegramApiService,
} from "./telegram-api-service.js";
import { TelegramMetrics } from "./telegram-metrics.js";

const botToken = "123:secret";
const rateLimitedResponse = {
    ok: false,
    error_code: 429,
    description: "Too Many Requests: retry after 1",
    parameters: { retry_after: 1 },
};

void describe("TelegramApiService", () => {
    void it("records successful requests", async (t) => {
        const { metrics, telegramApiService } = await buildApiService(t, [
            {
                ok: true,
                result: true,
            },
        ]);

        await telegramApiService.setMyCommands({ commands: [] });

        assert.match(
            await metrics.metrics(),
            /^telegram_api_requests_total\{method="setMyCommands",result="ok",error_code=""\} 1$/m,
        );
    });

    void it("records and logs rejected requests", async (t) => {
        const logs = createLogCollector();
        const { metrics, telegramApiService } = await buildApiService(
            t,
            [{ ok: false, error_code: 403, description: "Forbidden" }],
            logs,
        );

        const result = await telegramApiService.sendMessage({
            chat_id: 1,
            text: "hello",
        });

        assert.equal(result.ok, false);
        assert.match(
            await metrics.metrics(),
            /^telegram_api_requests_total\{method="sendMessage",result="error",error_code="403"\} 1$/m,
        );
        assert.ok(
            logs
                .readEntries()
                .some((entry) => entry.msg === "Telegram API request failed"),
        );
    });

    void it("aborts a request that takes longer than the timeout", async (t) => {
        mockFetchUntilAbort(t);
        const { rateLimiter } = await buildCacheServiceTestApp({ t });
        const metrics = new MetricsService();
        const telegramApiService = new TelegramApiService(
            botToken,
            Fastify({ logger: false }).log,
            new TelegramMetrics(metrics),
            rateLimiter,
            50,
        );

        await assert.rejects(() => telegramApiService.getMe(), {
            name: "TimeoutError",
        });
        assert.match(
            await metrics.metrics(),
            /^telegram_api_requests_total\{method="getMe",result="network_error",error_code=""\} 1$/m,
        );
    });

    void it("records network failures", async (t) => {
        const { metrics, telegramApiService } = await buildApiService(t, []);

        await assert.rejects(() => telegramApiService.getMe(), {
            message: "network down",
        });
        assert.match(
            await metrics.metrics(),
            /^telegram_api_requests_total\{method="getMe",result="network_error",error_code=""\} 1$/m,
        );
    });

    void it("records the rate limiter wait of a limited method", async (t) => {
        const { metrics, telegramApiService } = await buildApiService(t, [
            { ok: true, result: true },
        ]);

        await telegramApiService.deleteMessage({ chat_id: 1, message_id: 1 });

        assert.match(
            await metrics.metrics(),
            /^telegram_rate_limit_wait_seconds_count\{method="deleteMessage",priority="interactive"\} 1$/m,
        );
    });

    void it("deletes a message while the chat has no tokens for new messages", async (t) => {
        const chatMessagesBurst = 20;
        const { telegramApiService } = await buildApiService(
            t,
            Array.from({ length: chatMessagesBurst + 2 }, () => ({
                ok: true,
                result: true,
            })),
        );

        for (let sent = 0; sent <= chatMessagesBurst; sent++) {
            await telegramApiService.sendMessage({ chat_id: 1, text: "hello" });
        }

        const startedAt = performance.now();

        await telegramApiService.deleteMessage({ chat_id: 1, message_id: 1 });

        assert.ok(performance.now() - startedAt < 500);
    });

    void it("records the rate limiter wait of setMyCommands", async (t) => {
        const { metrics, telegramApiService } = await buildApiService(t, [
            { ok: true, result: true },
        ]);

        await telegramApiService.setMyCommands({ commands: [] });

        assert.match(
            await metrics.metrics(),
            /^telegram_rate_limit_wait_seconds_count\{method="setMyCommands",priority="interactive"\} 1$/m,
        );
    });

    void it("waits for retry_after and repeats a request that got a 429", async (t) => {
        const { fetch, metrics, telegramApiService } = await buildApiService(
            t,
            [rateLimitedResponse, { ok: true, result: true }],
        );
        const startedAt = performance.now();

        const result = await telegramApiService.deleteMessage({
            chat_id: 1,
            message_id: 1,
        });

        assert.equal(result.ok, true);
        assert.equal(fetch.mock.callCount(), 2);
        assert.ok(performance.now() - startedAt >= 900);

        const output = await metrics.metrics();

        assert.match(
            output,
            /^telegram_api_requests_total\{method="deleteMessage",result="rate_limited",error_code="429"\} 1$/m,
        );
        assert.match(
            output,
            /^telegram_api_requests_total\{method="deleteMessage",result="ok",error_code=""\} 1$/m,
        );
        assert.match(
            output,
            /^telegram_api_retry_after_seconds_count\{method="deleteMessage"\} 1$/m,
        );
    });

    void it("aborts a request in flight when the signal of its scope aborts", async (t) => {
        mockFetchUntilAbort(t);
        const { rateLimiter } = await buildCacheServiceTestApp({ t });
        const metrics = new MetricsService();
        const telegramApiService = new TelegramApiService(
            botToken,
            Fastify({ logger: false }).log,
            new TelegramMetrics(metrics),
            rateLimiter,
        );
        const controller = new AbortController();
        const reason = new Error("lock lost");

        const request = telegramApiScope.run(
            { signal: controller.signal, priority: "interactive" },
            () => telegramApiService.getMe(),
        );
        await setTimeout(50);
        controller.abort(reason);

        await assert.rejects(request, reason);
        assert.match(
            await metrics.metrics(),
            /^telegram_api_requests_total\{method="getMe",result="aborted",error_code=""\} 1$/m,
        );
    });

    void it("stops waiting when the signal of its scope aborts", async (t) => {
        const { telegramApiService } = await buildApiService(t, [
            rateLimitedResponse,
        ]);
        const controller = new AbortController();
        const reason = new Error("lock lost");

        const request = telegramApiScope.run(
            { signal: controller.signal, priority: "interactive" },
            () => telegramApiService.getMe(),
        );
        await setTimeout(100);
        controller.abort(reason);

        await assert.rejects(request, reason);
    });
});

function mockFetchUntilAbort(t: TestContext): void {
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
}

async function buildApiService(
    t: TestContext,
    responseBodies: object[],
    logs = createLogCollector(),
) {
    const fetch = t.mock.method(globalThis, "fetch", async () => {
        const responseBody = responseBodies.shift() ?? responseBodies.at(-1);

        if (!responseBody) {
            throw new Error("network down");
        }

        return new Response(JSON.stringify(responseBody));
    });
    const { rateLimiter } = await buildCacheServiceTestApp({ t });
    const metrics = new MetricsService();
    const app = Fastify({ logger: logs.logger });
    const telegramApiService = new TelegramApiService(
        botToken,
        app.log,
        new TelegramMetrics(metrics),
        rateLimiter,
    );

    return { fetch, metrics, telegramApiService };
}
