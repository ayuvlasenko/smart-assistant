import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { Histogram } from "prom-client";
import { MetricsService } from "./metrics-service.js";

export class HttpMetrics {
    private readonly requestDuration: Histogram<
        "method" | "route" | "status_code"
    >;

    constructor(metrics: MetricsService) {
        this.requestDuration = metrics.histogram({
            name: "http_request_duration_seconds",
            help: "Time to answer an HTTP request, by route template and status code",
            labelNames: ["method", "route", "status_code"],
            buckets: [0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 30, 60],
        });
    }

    record(request: FastifyRequest, reply: FastifyReply): void {
        this.requestDuration.observe(
            {
                method: request.method,
                route: request.routeOptions.url ?? "unmatched",
                status_code: String(reply.statusCode),
            },
            reply.elapsedTime / 1000,
        );
    }
}

export default fp(
    async function (fastify: FastifyInstance) {
        const httpMetrics = new HttpMetrics(
            fastify.getDecorator<MetricsService>("metrics"),
        );

        fastify.addHook("onResponse", async (request, reply) => {
            httpMetrics.record(request, reply);
        });
    },
    {
        name: "http-metrics",
        dependencies: ["metrics"],
    },
);
