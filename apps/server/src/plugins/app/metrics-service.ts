import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import {
    collectDefaultMetrics,
    Counter,
    type CounterConfiguration,
    Gauge,
    type GaugeConfiguration,
    Histogram,
    type HistogramConfiguration,
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

    counter<TLabel extends string>(
        config: Omit<CounterConfiguration<TLabel>, "registers">,
    ): Counter<TLabel> {
        return new Counter({ ...config, registers: [this.registry] });
    }

    gauge<TLabel extends string>(
        config: Omit<GaugeConfiguration<TLabel>, "registers">,
    ): Gauge<TLabel> {
        return new Gauge({ ...config, registers: [this.registry] });
    }

    histogram<TLabel extends string>(
        config: Omit<HistogramConfiguration<TLabel>, "registers">,
    ): Histogram<TLabel> {
        return new Histogram({ ...config, registers: [this.registry] });
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
