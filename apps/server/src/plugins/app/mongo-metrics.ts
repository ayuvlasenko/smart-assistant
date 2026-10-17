import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import {
    CommandFailedEvent,
    CommandSucceededEvent,
    MongoClient,
} from "mongodb";
import { Histogram } from "prom-client";
import { MetricsService } from "./metrics-service.js";

export class MongoMetrics {
    private readonly commandDuration: Histogram<"command" | "result">;

    constructor(metrics: MetricsService) {
        this.commandDuration = metrics.histogram({
            name: "mongodb_command_duration_seconds",
            help: "Time of a MongoDB command as the driver sees it, by command name and result",
            labelNames: ["command", "result"],
            buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
        });
    }

    watch(client: MongoClient): () => void {
        const onSucceeded = (event: CommandSucceededEvent) => {
            this.record(event, "ok");
        };
        const onFailed = (event: CommandFailedEvent) => {
            this.record(event, "error");
        };

        client.on("commandSucceeded", onSucceeded);
        client.on("commandFailed", onFailed);

        return () => {
            client.off("commandSucceeded", onSucceeded);
            client.off("commandFailed", onFailed);
        };
    }

    private record(
        event: CommandSucceededEvent | CommandFailedEvent,
        result: "ok" | "error",
    ): void {
        this.commandDuration.observe(
            { command: event.commandName, result },
            event.duration / 1000,
        );
    }
}

export default fp(
    async function (fastify: FastifyInstance) {
        const mongoMetrics = new MongoMetrics(
            fastify.getDecorator<MetricsService>("metrics"),
        );
        const unwatch = mongoMetrics.watch(fastify.mongo.client);

        fastify.addHook("onClose", async () => {
            unwatch();
        });
    },
    {
        name: "mongo-metrics",
        dependencies: ["@fastify/mongodb", "metrics"],
    },
);
