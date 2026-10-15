import { FastifyBaseLogger, FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Counter } from "prom-client";
import { AppLogger } from "./app-logger.js";
import { MetricsService } from "./metrics-service.js";

export class UnhandledRejectionReporter {
    private readonly rejections: Counter;
    private readonly log: FastifyBaseLogger;

    constructor(log: FastifyBaseLogger, metrics: MetricsService) {
        this.log = log;

        this.rejections = metrics.counter({
            name: "unhandled_rejections_total",
            help: "Promise rejections that no code handled",
        });
    }

    report(reason: unknown): void {
        this.rejections.inc();
        this.log.error({ err: reason }, "Unhandled promise rejection");
    }
}

export default fp(
    async function (fastify: FastifyInstance) {
        const reporter = new UnhandledRejectionReporter(
            fastify.getDecorator<AppLogger>("appLogger"),
            fastify.getDecorator<MetricsService>("metrics"),
        );
        const onRejection = (reason: unknown) => {
            reporter.report(reason);
        };

        process.on("unhandledRejection", onRejection);
        fastify.addHook("onClose", async () => {
            process.off("unhandledRejection", onRejection);
        });
    },
    {
        name: "unhandled-rejection-reporter",
        dependencies: ["app-logger", "metrics"],
    },
);
