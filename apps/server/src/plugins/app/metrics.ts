import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import {
    collectDefaultMetrics,
    Registry,
    type RegistryContentType,
} from "prom-client";

export class MetricsService {
    private readonly registry = new Registry();

    constructor() {
        collectDefaultMetrics({ register: this.registry });
    }

    get contentType(): RegistryContentType {
        return this.registry.contentType;
    }

    async metrics(): Promise<string> {
        return this.registry.metrics();
    }
}

export default fp(
    async function metricsPlugin(fastify: FastifyInstance) {
        fastify.decorate("metrics", new MetricsService());
    },
    {
        name: "metrics",
    },
);
