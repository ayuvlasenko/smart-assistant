import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { REQUEST_ID_HEADER } from "../constants/headers.js";
import { requestLogSerializers } from "../constants/options.js";
import { buildTestApp } from "../test/helper.js";
import { createLogCollector } from "../test/log-collector.js";

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
        const logs = createLogCollector();
        const { app } = await buildTestApp({
            logger: {
                ...logs.logger,
                serializers: requestLogSerializers,
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
        const incomingRequestLog = logs
            .readEntries()
            .find((entry) => entry.msg === "incoming request");

        assert.equal(response.statusCode, 200);
        assert.ok(incomingRequestLog?.req);
        assert.equal(incomingRequestLog.req.remoteAddress, "203.0.113.10");
        assert.equal(incomingRequestLog.req.remotePort, 443);
    });
});
