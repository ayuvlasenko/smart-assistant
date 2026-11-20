import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildLoggerOptions } from "../logger-options.js";
import { buildTestApp } from "../test/helper.js";
import { createLoggerCollector } from "../test/logger-collector.js";

void describe("GET /metrics", () => {
    void it("returns the metrics of the app with the registry content type", async (t) => {
        const { app } = await buildTestApp({ t });

        await app.inject({ method: "GET", url: "/" });

        const response = await app.inject({ method: "GET", url: "/metrics" });

        assert.equal(response.statusCode, 200);
        assert.match(
            response.headers["content-type"] as string,
            /^text\/plain; version=0\.0\.4; charset=utf-8/,
        );
        assert.match(
            response.body,
            /^http_request_duration_seconds_count\{[^}]*route="\/"[^}]*\} 1$/m,
        );
    });

    void it("writes no request log for a scrape", async (t) => {
        const logs = createLoggerCollector();
        const { app } = await buildTestApp({
            logger: {
                ...buildLoggerOptions("info"),
                stream: logs.logger.stream,
            },
            t,
        });

        const response = await app.inject({ method: "GET", url: "/metrics" });

        assert.equal(response.statusCode, 200);
        assert.deepEqual(
            logs.readEntries().filter(({ msg }) => msg === "request completed"),
            [],
        );
    });
});
