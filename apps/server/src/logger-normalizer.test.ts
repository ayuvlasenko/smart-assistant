import Fastify from "fastify";
import assert from "node:assert/strict";
import { Agent } from "node:http";
import { PassThrough } from "node:stream";
import { describe, it } from "node:test";
import { LoggerNormalizer } from "./logger-normalizer.js";
import { buildLoggerOptions } from "./logger-options.js";
import { createLoggerCollector } from "./test/logger-collector.js";

const botToken = "123456789:AAEhBOweik6ad9r_QXMENQjcrGbqCr4K-bs";

void describe("LoggerNormalizer", () => {
    void it("hides a value under a key that names a secret, at any depth", () => {
        const record = new LoggerNormalizer().normalize({
            botId: "42",
            token: "plain",
            request: {
                headers: { Authorization: "Bearer abc", accept: "json" },
                body: [{ webhook_secret_token: "s3cret", name: "poker" }],
            },
        });

        assert.deepEqual(record, {
            botId: "42",
            token: "[REDACTED]",
            request: {
                headers: { Authorization: "[REDACTED]", accept: "json" },
                body: [{ webhook_secret_token: "[REDACTED]", name: "poker" }],
            },
        });
    });

    void it("keeps a value under a key in which the secret word is only a part", () => {
        const record = { tokens: 3, tokenCount: 2, routingKey: "poker" };

        assert.deepEqual(new LoggerNormalizer().normalize(record), record);
    });

    void it("masks a bot token inside a string", () => {
        const record = new LoggerNormalizer().normalize({
            url: `https://api.telegram.org/bot${botToken}/getMe`,
        });

        assert.deepEqual(record, {
            url: "https://api.telegram.org/bot[REDACTED]/getMe",
        });
    });

    void it("writes an error under any key with its type, message, stack, fields and cause", () => {
        const cause = new TypeError("fetch failed");
        const error = Object.assign(new Error("request failed", { cause }), {
            method: "getMe",
        });
        const record = new LoggerNormalizer().normalize({ replyErr: error });
        const serialized = record.replyErr as Record<string, unknown>;

        assert.equal(serialized.type, "Error");
        assert.equal(serialized.message, "request failed");
        assert.equal(serialized.method, "getMe");
        assert.match(String(serialized.stack), /^Error: request failed\n/);
        assert.deepEqual(
            (serialized.cause as Record<string, unknown>).message,
            "fetch failed",
        );
    });

    void it("masks a bot token in the message and the stack of an error", () => {
        const record = new LoggerNormalizer().normalize({
            err: new Error(`failed https://api.telegram.org/bot${botToken}/`),
        });

        assert.ok(!JSON.stringify(record).includes(botToken));
    });

    void it("replaces a buffer, a stream and an agent, and marks a cycle", () => {
        const cycle: Record<string, unknown> = { name: "loop" };

        cycle.self = cycle;

        assert.deepEqual(
            new LoggerNormalizer().normalize({
                body: Buffer.from("hello"),
                stream: new PassThrough(),
                agent: new Agent(),
                cycle,
                count: 10n,
                at: new Date(0),
            }),
            {
                body: "[Buffer 5 bytes]",
                stream: "[PassThrough]",
                agent: "[Agent]",
                cycle: { name: "loop", self: "[Circular]" },
                count: "10",
                at: "1970-01-01T00:00:00.000Z",
            },
        );
    });

    void it("cuts a long string and a long list and says how much it cut", () => {
        const record = new LoggerNormalizer().normalize({
            text: "a".repeat(10_010),
            items: Array.from({ length: 103 }, (_, index) => index),
        });

        assert.equal(
            record.text,
            `${"a".repeat(10_000)}…[truncated 10 characters]`,
        );
        assert.equal((record.items as unknown[]).length, 101);
        assert.equal(
            (record.items as unknown[]).at(-1),
            "[truncated 3 more items]",
        );
    });

    void it("shrinks a record that is too large and keeps every key of its top level", () => {
        const record = new LoggerNormalizer().normalize({
            botId: "42",
            response: Array.from({ length: 40 }, () => ({
                text: "b".repeat(3_000),
            })),
            note: "kept",
        });
        const size = JSON.stringify(record).length;

        assert.deepEqual(Object.keys(record), ["botId", "response", "note"]);
        assert.equal(record.botId, "42");
        assert.equal(record.note, "kept");
        assert.ok(size < 65_536, `the record takes ${size} characters`);
    });

    void it("leaves the keys of a serializer as they are", () => {
        const request = { raw: { token: "abc" } };
        const record = new LoggerNormalizer(["req"]).normalize({
            req: request,
        });

        assert.equal(record.req, request);
    });

    void it("keeps a secret out of a real log line", async () => {
        const logs = createLoggerCollector();
        const app = Fastify({
            logger: {
                ...buildLoggerOptions("info"),
                stream: logs.logger.stream,
            },
        });

        app.log.error(
            new Error(`failed https://api.telegram.org/bot${botToken}/getMe`),
            "Request failed",
        );
        app.log.info({ invite: { token: "Ab3x" } }, "Invite created");
        await app.close();

        const output = JSON.stringify(logs.readEntries());

        assert.ok(!output.includes(botToken));
        assert.ok(!output.includes("Ab3x"));
        assert.match(output, /"msg":"Request failed"/);
        assert.match(output, /"type":"Error"/);
    });

    void it("keeps a bot token out of the message of a log line", async () => {
        const logs = createLoggerCollector();
        const app = Fastify({
            logger: {
                ...buildLoggerOptions("info"),
                stream: logs.logger.stream,
            },
        });
        const url = `https://api.telegram.org/bot${botToken}/getMe`;

        app.log.error(new Error(`bare ${url}`));
        app.log.error({ err: new Error(`nested ${url}`) });
        app.log.info(`text ${url}`);
        app.log.info({ botId: "42" }, `text with fields ${url}`);
        await app.close();

        const entries = logs.readEntries();

        assert.ok(!JSON.stringify(entries).includes(botToken));
        assert.deepEqual(
            entries.map(({ msg }) => msg),
            [
                "bare https://api.telegram.org/bot[REDACTED]/getMe",
                "nested https://api.telegram.org/bot[REDACTED]/getMe",
                "text https://api.telegram.org/bot[REDACTED]/getMe",
                "text with fields https://api.telegram.org/bot[REDACTED]/getMe",
            ],
        );
    });

    void it("cuts a long message of a log line", async () => {
        const logs = createLoggerCollector();
        const app = Fastify({
            logger: {
                ...buildLoggerOptions("info"),
                stream: logs.logger.stream,
            },
        });

        app.log.error(new Error("x".repeat(50_000)));
        await app.close();

        const [entry] = logs.readEntries();

        assert.equal(
            entry?.msg,
            `${"x".repeat(10_000)}…[truncated 40000 characters]`,
        );
    });
});
