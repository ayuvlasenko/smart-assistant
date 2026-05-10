import assert from "node:assert/strict";
import Fastify from "fastify";
import { describe, it, TestContext } from "node:test";
import metricsPlugin, { MetricsService } from "./metrics.js";

const prometheusContentType = "text/plain; version=0.0.4; charset=utf-8";

void describe("metrics plugin", () => {
    void it("collects default metrics in Prometheus text format", async (t) => {
        const app = await buildMetricsPluginApp(t);
        const metrics = app.getDecorator<MetricsService>("metrics");
        const body = await metrics.metrics();

        assert.equal(metrics.contentType, prometheusContentType);
        assert.match(body, /^# HELP process_cpu_user_seconds_total/m);
        assert.match(body, /^# TYPE process_cpu_user_seconds_total counter/m);
    });

    void it("can be registered on multiple Fastify apps in one process", async (t) => {
        const firstApp = await buildMetricsPluginApp(t);
        const secondApp = await buildMetricsPluginApp(t);
        const firstMetrics = firstApp.getDecorator<MetricsService>("metrics");
        const secondMetrics = secondApp.getDecorator<MetricsService>("metrics");

        assert.match(
            await firstMetrics.metrics(),
            /^# HELP process_cpu_user_seconds_total/m,
        );
        assert.match(
            await secondMetrics.metrics(),
            /^# HELP process_cpu_user_seconds_total/m,
        );
    });
});

async function buildMetricsPluginApp(t: TestContext) {
    const app = Fastify({ logger: false });

    await app.register(metricsPlugin);
    await app.ready();
    t.after(() => app.close());

    return app;
}
