import Fastify from "fastify";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createLogCollector } from "../../test/log-collector.js";
import { MetricsService } from "./metrics-service.js";
import { UnhandledRejectionReporter } from "./unhandled-rejection-reporter.js";

void describe("UnhandledRejectionReporter", () => {
    void it("logs and counts an unhandled rejection", async () => {
        const logs = createLogCollector();
        const metrics = new MetricsService();
        const reporter = new UnhandledRejectionReporter(
            Fastify({ logger: logs.logger }).log,
            metrics,
        );

        reporter.report(new Error("Lost rejection"));

        const entry = logs
            .readEntries()
            .find(({ msg }) => msg === "Unhandled promise rejection");

        assert.ok(entry);
        assert.match(JSON.stringify(entry), /Lost rejection/);
        assert.match(
            await metrics.metrics(),
            /^unhandled_rejections_total 1$/m,
        );
    });
});
