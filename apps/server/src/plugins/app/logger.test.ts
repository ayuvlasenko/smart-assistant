import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Fastify from "fastify";
import { requestIdOptions } from "../../constants/options.js";
import { createLogCollector } from "../../test/log-collector.js";
import requestContextPlugin, {
    autoConfig as requestContextAutoConfig,
} from "../external/request-context.js";
import loggerPlugin, { AppLogger } from "./logger.js";

void describe("AppLogger", () => {
    void it("uses the fallback logger with nested child bindings outside request context", async (t) => {
        const logs = createLogCollector();
        const app = Fastify({
            logger: logs.logger,
            ...requestIdOptions,
        });

        await app.register(requestContextPlugin, requestContextAutoConfig);
        await app.register(loggerPlugin);

        await app.ready();
        t.after(() => app.close());

        app.getDecorator<AppLogger>("appLogger")
            .child({ module: "telegram" })
            .child({ handler: "webhook" })
            .info("outside request");

        const entry = logs
            .readEntries()
            .find((logEntry) => logEntry.msg === "outside request");

        assert.ok(entry);
        assert.equal(entry.module, "telegram");
        assert.equal(entry.handler, "webhook");
        assert.equal(entry.reqId, undefined);
    });

    void it("uses the request logger with nested child bindings inside request context", async (t) => {
        const logs = createLogCollector();
        const app = Fastify({
            logger: logs.logger,
            ...requestIdOptions,
        });

        await app.register(requestContextPlugin, requestContextAutoConfig);
        await app.register(loggerPlugin);
        app.get("/request-log", () => {
            app.getDecorator<AppLogger>("appLogger")
                .child({ module: "telegram" })
                .child({ handler: "webhook" })
                .info("inside request");

            return null;
        });

        await app.ready();
        t.after(() => app.close());

        const response = await app.inject({
            method: "GET",
            url: "/request-log",
        });
        const entry = logs
            .readEntries()
            .find((logEntry) => logEntry.msg === "inside request");

        assert.equal(response.statusCode, 200);
        assert.ok(entry);
        assert.equal(entry.module, "telegram");
        assert.equal(entry.handler, "webhook");
        assert.match(entry.reqId ?? "", /^[0-9a-f-]{36}$/);
    });
});
