import helmet, { FastifyHelmetOptions } from "@fastify/helmet";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Env } from "../../schemas/env.js";

export const autoConfig = (fastify: FastifyInstance): FastifyHelmetOptions => {
    const { ENABLE_SECURITY_HEADERS } = fastify.getDecorator<Env>("config");

    return {
        hsts: ENABLE_SECURITY_HEADERS,
        contentSecurityPolicy: ENABLE_SECURITY_HEADERS,
    };
};

export default fp(helmet, {
    name: "@fastify/helmet",
    dependencies: ["@fastify/env"],
});
