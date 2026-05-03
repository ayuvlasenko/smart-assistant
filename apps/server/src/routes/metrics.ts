import { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { MetricsService } from "../plugins/app/metrics.js";

const plugin: FastifyPluginAsyncTypebox = async (fastify) => {
    const metrics = fastify.getDecorator<MetricsService>("metrics");

    fastify.get(
        "/metrics",
        {
            logLevel: "silent",
        },
        async (_request, reply) => {
            reply.type(metrics.contentType);

            return metrics.metrics();
        },
    );
};

export default plugin;
