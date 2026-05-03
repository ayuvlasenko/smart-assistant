import assert from "node:assert/strict";
import fastifyAutoload from "@fastify/autoload";
import Fastify, { FastifyServerOptions } from "fastify";
import { describe, it, TestContext } from "node:test";
import { requestIdOptions } from "../constants/options.js";
import { createLogCollector } from "../test/log-collector.js";

const prometheusContentType = "text/plain; version=0.0.4; charset=utf-8";
const metricsBody = [
    "# HELP process_cpu_user_seconds_total Total user CPU time spent in seconds.",
    "# TYPE process_cpu_user_seconds_total counter",
    "process_cpu_user_seconds_total 1",
    "",
].join("\n");

const ignoredRoutePattern = /(?:^api\/|\/api\/|\.(?:test|spec)\.(?:js|ts)$)/;

interface MetricsDecorator {
    readonly contentType: string;
    metrics(): Promise<string>;
}

interface BuildOptions {
    logger?: FastifyServerOptions["logger"];
    metrics?: MetricsDecorator;
}

void describe("GET /metrics", () => {
    void it("returns Prometheus metrics with the registry content type", async (t) => {
        const app = await buildMetricsRouteApp(t);

        const response = await app.inject({
            method: "GET",
            url: "/metrics",
        });

        assert.equal(response.statusCode, 200);
        assert.match(
            response.headers["content-type"] as string,
            /^text\/plain; version=0\.0\.4; charset=utf-8/,
        );
        assert.equal(response.body, metricsBody);
    });

    void it("does not add an application-level public address guard", async (t) => {
        const app = await buildMetricsRouteApp(t);

        const response = await app.inject({
            method: "GET",
            url: "/metrics",
            headers: {
                "x-forwarded-for": "203.0.113.10",
            },
        });

        assert.equal(response.statusCode, 200);
        assert.equal(response.body, metricsBody);
    });

    void it("does not write access logs for scrapes", async (t) => {
        const logs = createLogCollector();
        const app = await buildMetricsRouteApp(t, {
            logger: logs.logger,
        });

        const response = await app.inject({
            method: "GET",
            url: "/metrics",
        });
        const accessLogMessages = logs
            .readEntries()
            .map((entry) => entry.msg)
            .filter(
                (message) =>
                    message === "incoming request" ||
                    message === "request completed",
            );

        assert.equal(response.statusCode, 200);
        assert.deepEqual(accessLogMessages, []);
    });
});

async function buildMetricsRouteApp(t: TestContext, opts: BuildOptions = {}) {
    const app = Fastify({
        logger: opts.logger ?? false,
        ...requestIdOptions,
        trustProxy: true,
    });

    app.decorate(
        "metrics",
        opts.metrics ?? {
            contentType: prometheusContentType,
            metrics: async () => metricsBody,
        },
    );

    await app.register(fastifyAutoload, {
        dir: import.meta.dirname,
        ignoreFilter: ignoredRoutePattern,
        autoHooks: true,
        cascadeHooks: true,
        routeParams: true,
    });

    await app.ready();
    t.after(() => app.close());

    return app;
}
