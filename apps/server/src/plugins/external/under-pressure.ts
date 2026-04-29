import underPressure, {
    FastifyUnderPressureOptions,
} from "@fastify/under-pressure";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Redis } from "ioredis";

export const autoConfig = (
    fastify: FastifyInstance,
): FastifyUnderPressureOptions => {
    return {
        maxEventLoopDelay: 1000,
        maxHeapUsedBytes: 100_000_000,
        maxRssBytes: 1_000_000_000,
        maxEventLoopUtilization: 0.98,
        message: "The server is under pressure, retry later!",
        retryAfter: 50,
        exposeStatusRoute: {
            routeOpts: {
                logLevel: "silent",
            },
            url: "/status",
        },
        healthCheck: async () => {
            try {
                if (!fastify.mongo.db) {
                    throw new Error("Database connection is not available");
                }

                await fastify.mongo.db.collection("test").findOne({});

                const valkey = fastify.getDecorator<Redis>("valkey");
                await valkey.ping();

                return true;
            } catch (err) {
                fastify.log.error(err, "healthCheck has failed");

                throw new Error("Database connection is not available");
            }
        },
        healthCheckInterval: 5000,
    };
};

export default fp(underPressure, {
    name: "@fastify/under-pressure",
    dependencies: ["@fastify/env", "@fastify/mongodb", "valkey"],
});
