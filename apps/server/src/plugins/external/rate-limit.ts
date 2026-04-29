import rateLimit from "@fastify/rate-limit";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { resolveClientAddress } from "../../utils/client-address.js";

export const autoConfig = (fastify: FastifyInstance) => {
    return {
        max: fastify.config.RATE_LIMIT_MAX,
        timeWindow: "1 minute",
        keyGenerator: (request: {
            ip: string;
            headers: Record<string, string | string[] | undefined>;
        }) => {
            return resolveClientAddress(request) ?? request.ip;
        },
    };
};

export default fp(rateLimit, {
    name: "@fastify/rate-limit",
    dependencies: ["@fastify/env"],
});
