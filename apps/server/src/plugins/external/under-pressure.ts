import underPressure, {
    FastifyUnderPressureOptions,
} from "@fastify/under-pressure";
import { FastifyContextConfig, FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Redis } from "ioredis";
import { readMongoDb } from "./mongo.js";

declare module "fastify" {
    interface FastifyContextConfig {
        pressureHandler?: FastifyUnderPressureOptions["pressureHandler"];
    }
}

export const pressureExemptConfig = {
    pressureHandler: () => undefined,
} satisfies FastifyContextConfig;

export const autoConfig = (
    fastify: FastifyInstance,
): FastifyUnderPressureOptions => {
    return {
        maxEventLoopDelay: 1000,
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
                await readMongoDb(fastify).command({ ping: 1 });
                await fastify.getDecorator<Redis>("valkey").ping();

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
