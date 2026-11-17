import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildLoggerOptions } from "../logger-options.js";
import { REQUEST_ID_HEADER } from "../logger-request.js";
import { buildTestApp } from "../test/helper.js";
import { createLoggerCollector } from "../test/logger-collector.js";

const uuidV4Pattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

void describe("GET /", () => {
    void it("returns a generated x-request-id from the route autohook", async (t) => {
        const { app } = await buildTestApp({ t });

        const response = await app.inject({
            method: "GET",
            url: "/",
            headers: {
                "request-id": "client-request-id",
                [REQUEST_ID_HEADER]: "client-x-request-id",
            },
        });
        const requestId = response.headers[REQUEST_ID_HEADER];

        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.json(), {
            message: "Welcome to the Smart Assistant Project!",
        });
        assert.ok(typeof requestId === "string");
        assert.match(requestId, uuidV4Pattern);
        assert.notEqual(requestId, "client-request-id");
        assert.notEqual(requestId, "client-x-request-id");
    });

    void it("serializes forwarded client address in request logs", async (t) => {
        const logs = createLoggerCollector();
        const { app } = await buildTestApp({
            logger: {
                ...buildLoggerOptions("info"),
                stream: logs.logger.stream,
            },
            t,
        });

        const response = await app.inject({
            method: "GET",
            url: "/",
            headers: {
                "cf-connecting-ip": "203.0.113.10",
                "x-forwarded-port": "443",
            },
        });
        const requestLog = logs
            .readEntries()
            .find((entry) => entry.msg === "request completed");

        assert.equal(response.statusCode, 200);
        assert.ok(requestLog?.req);
        assert.equal(requestLog.req.remoteAddress, "203.0.113.10");
        assert.equal(requestLog.req.remotePort, 443);
    });

    void it("writes one line per request, with the name of the level, the status and the time", async (t) => {
        const logs = createLoggerCollector();
        const { app } = await buildTestApp({
            logger: {
                ...buildLoggerOptions("info"),
                stream: logs.logger.stream,
            },
            t,
        });

        await app.inject({ method: "GET", url: "/" });
        await app.inject({ method: "GET", url: "/missing" });

        const requestLogs = logs
            .readEntries()
            .filter((entry) => entry.req?.url !== undefined);

        assert.deepEqual(
            requestLogs.map(({ msg, level, req, res, pid }) => ({
                msg,
                level,
                url: req?.url,
                statusCode: res?.statusCode,
                pid,
            })),
            [
                {
                    msg: "request completed",
                    level: "info",
                    url: "/",
                    statusCode: 200,
                    pid: undefined,
                },
                {
                    msg: "request completed",
                    level: "info",
                    url: "/missing",
                    statusCode: 404,
                    pid: undefined,
                },
            ],
        );
        assert.ok(
            requestLogs.every(({ responseTime }) => responseTime !== undefined),
        );
    });
});
