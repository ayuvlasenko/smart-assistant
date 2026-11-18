import Fastify from "fastify";
import assert from "node:assert/strict";
import { describe, it, TestContext } from "node:test";
import { setTimeout } from "node:timers/promises";
import { buildCacheServiceTestApp } from "../../../test/cache-service-helper.js";
import { createLoggerCollector } from "../../../test/logger-collector.js";
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
            /^telegram_api_requests_total\{method="setMyCommands",result="ok",error_code="",bot="123"\} 1$/m,
        );
    });

    void it("records and logs rejected requests", async (t) => {
        const logs = createLoggerCollector();
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
            /^telegram_api_requests_total\{method="sendMessage",result="error",error_code="403",bot="123"\} 1$/m,
        );
        assert.ok(
            logs
                .readEntries()
                .some((entry) => entry.msg === "Telegram API request failed"),
        );
    });

    void it("aborts a request that takes longer than the timeout and does not repeat it", async (t) => {
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
            /^telegram_api_requests_total\{method="getMe",result="network_error",error_code="",bot="123"\} 1$/m,
        );
    });

    void it("repeats a request after a network error", async (t) => {
        const { fetch, metrics, telegramApiService } = await buildApiService(
            t,
            [
                new TypeError("fetch failed"),
                { ok: true, result: { message_id: 7 } },
            ],
        );

        const result = await telegramApiService.sendMessage({
            chat_id: 1,
            text: "hello",
        });

        assert.equal(result.ok, true);
        assert.equal(fetch.mock.callCount(), 2);

        const output = await metrics.metrics();

        assert.match(
            output,
            /^telegram_api_requests_total\{method="sendMessage",result="network_error",error_code="",bot="123"\} 1$/m,
        );
        assert.match(
            output,
            /^telegram_api_requests_total\{method="sendMessage",result="ok",error_code="",bot="123"\} 1$/m,
        );
    });

    void it("throws a network error after two repeats, and records and logs every attempt with the method", async (t) => {
        const logs = createLoggerCollector();
        const { fetch, metrics, telegramApiService } = await buildApiService(
            t,
            [],
            logs,
        );

        await assert.rejects(() => telegramApiService.getMe(), {
            message: "network down",
        });
        assert.equal(fetch.mock.callCount(), 3);
        assert.match(
            await metrics.metrics(),
            /^telegram_api_requests_total\{method="getMe",result="network_error",error_code="",bot="123"\} 3$/m,
        );

        const entry = logs
            .readEntries()
            .find(({ msg }) => msg === "Telegram API request got no answer");

        assert.equal(entry?.method, "getMe");
        assert.equal(entry.result, "network_error");
        assert.equal(entry.err?.message, "network down");
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

    void it("deletes a message while a 429 pauses the messages of the chat", async (t) => {
        const { telegramApiService } = await buildApiService(t, [
            rateLimitedResponse,
            { ok: true, result: true },
            { ok: true, result: true },
        ]);
        const pausedSend = telegramApiService.sendMessage({
            chat_id: 1,
            text: "hello",
        });
        await setTimeout(100);
        const startedAt = performance.now();

        await telegramApiService.deleteMessage({ chat_id: 1, message_id: 1 });

        assert.ok(performance.now() - startedAt < 500);
        assert.equal((await pausedSend).ok, true);
    });

    void it("makes another chat wait while a 429 pauses the messages of the bot", async (t) => {
        const { telegramApiService } = await buildApiService(t, [
            rateLimitedResponse,
            { ok: true, result: true },
            { ok: true, result: true },
        ]);
        const pausedSend = telegramApiService.sendMessage({
            chat_id: 1,
            text: "hello",
        });
        await setTimeout(100);
        const startedAt = performance.now();

        await telegramApiService.sendMessage({ chat_id: 2, text: "hello" });

        assert.ok(performance.now() - startedAt >= 700);
        assert.equal((await pausedSend).ok, true);
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
        const logs = createLoggerCollector();
        const { fetch, metrics, telegramApiService } = await buildApiService(
            t,
            [rateLimitedResponse, { ok: true, result: true }],
            logs,
        );
        const startedAt = performance.now();

        const result = await telegramApiService.deleteMessage({
            chat_id: 1,
            message_id: 1,
        });

        assert.equal(result.ok, true);
        assert.equal(fetch.mock.callCount(), 2);
        assert.ok(performance.now() - startedAt >= 900);
        assert.ok(
            logs
                .readEntries()
                .some(
                    ({ msg }) => msg === "Telegram rate limit buckets paused",
                ),
        );

        const output = await metrics.metrics();

        assert.match(
            output,
            /^telegram_api_requests_total\{method="deleteMessage",result="rate_limited",error_code="429",bot="123"\} 1$/m,
        );
        assert.match(
            output,
            /^telegram_api_requests_total\{method="deleteMessage",result="ok",error_code="",bot="123"\} 1$/m,
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
            /^telegram_api_requests_total\{method="getMe",result="aborted",error_code="",bot="123"\} 1$/m,
        );
    });

    void it("stops waiting for a repeat when the signal of its scope aborts", async (t) => {
        const { fetch, telegramApiService } = await buildApiService(t, []);
        const controller = new AbortController();
        const reason = new Error("lock lost");

        const request = telegramApiScope.run(
            { signal: controller.signal, priority: "interactive" },
            () => telegramApiService.getMe(),
        );
        await setTimeout(100);
        controller.abort(reason);

        await assert.rejects(request, reason);
        assert.equal(fetch.mock.callCount(), 1);
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
    logs = createLoggerCollector(),
) {
    const fetch = t.mock.method(globalThis, "fetch", async () => {
        const responseBody = responseBodies.shift() ?? responseBodies.at(-1);

        if (responseBody instanceof Error) {
            throw responseBody;
        }

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
