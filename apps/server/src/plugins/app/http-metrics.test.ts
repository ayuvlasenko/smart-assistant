import Fastify from "fastify";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import httpMetricsPlugin from "./http-metrics.js";
import metricsPlugin, { MetricsService } from "./metrics-service.js";

void describe("HttpMetrics", () => {
    void it("measures a request by its route template and status code", async (t) => {
        const app = Fastify();

        t.after(() => app.close());
        await app.register(metricsPlugin);
        await app.register(httpMetricsPlugin);
        app.get("/rooms/:roomId", async () => ({ ok: true }));
        await app.ready();

        await app.inject({ method: "GET", url: "/rooms/42" });
        await app.inject({ method: "GET", url: "/missing" });

        const output = await app
            .getDecorator<MetricsService>("metrics")
            .metrics();

        assert.match(
            output,
            /^http_request_duration_seconds_count\{method="GET",route="\/rooms\/:roomId",status_code="200"\} 1$/m,
        );
        assert.match(
            output,
            /^http_request_duration_seconds_count\{method="GET",route="unmatched",status_code="404"\} 1$/m,
        );
    });
});
