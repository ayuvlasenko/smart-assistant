import helmet, { FastifyHelmetOptions } from "@fastify/helmet";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

export const autoConfig = (fastify: FastifyInstance): FastifyHelmetOptions => {
    return {
        hsts: fastify.config.ENABLE_SECURITY_HEADERS,
        contentSecurityPolicy: fastify.config.ENABLE_SECURITY_HEADERS,
    };
};

export default fp(helmet, {
    name: "@fastify/helmet",
    dependencies: ["@fastify/env"],
});
