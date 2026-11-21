import Fastify from "fastify";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createLoggerCollector } from "../../test/logger-collector.js";
import requestContextPlugin, {
    autoConfig as requestContextAutoConfig,
} from "../external/request-context.js";
import appLoggerPlugin from "./app-logger.js";
import metricsPlugin, { MetricsService } from "./metrics-service.js";
import unhandledRejectionReporterPlugin from "./unhandled-rejection-reporter.js";

void describe("unhandled rejection reporter", () => {
    void it("listens for rejections that no code handled, logs and counts them, and stops on close", async () => {
        const logs = createLoggerCollector();
        const app = Fastify({ logger: logs.logger });
        const before = process.listeners("unhandledRejection");

        app.register(requestContextPlugin, requestContextAutoConfig);
        app.register(appLoggerPlugin);
        app.register(metricsPlugin);
        app.register(unhandledRejectionReporterPlugin);
        await app.ready();

        const added = process
            .listeners("unhandledRejection")
            .filter((listener) => !before.includes(listener));

        assert.equal(added.length, 1);
        added[0]?.(new Error("Lost rejection"), Promise.resolve());

        const metrics = await app
            .getDecorator<MetricsService>("metrics")
            .metrics();
        const entry = logs
            .readEntries()
            .find(({ msg }) => msg === "Unhandled promise rejection");

        await app.close();

        assert.ok(entry);
        assert.match(JSON.stringify(entry), /Lost rejection/);
        assert.match(metrics, /^unhandled_rejections_total 1$/m);
        assert.deepEqual(process.listeners("unhandledRejection"), before);
    });
});
