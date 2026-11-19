import { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { MetricsService } from "../plugins/app/metrics-service.js";
import { pressureExemptConfig } from "../plugins/external/under-pressure.js";

const plugin: FastifyPluginAsyncTypebox = async (fastify) => {
    const metrics = fastify.getDecorator<MetricsService>("metrics");

    fastify.get(
        "/metrics",
        {
            logLevel: "silent",
            config: pressureExemptConfig,
        },
        async (_request, reply) => {
            reply.type(metrics.contentType);

            return metrics.metrics();
        },
    );
};

export default plugin;
