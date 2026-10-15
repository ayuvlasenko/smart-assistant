import mongo, { FastifyMongodbOptions } from "@fastify/mongodb";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Env } from "../../schemas/env.js";

export const autoConfig = (fastify: FastifyInstance): FastifyMongodbOptions => {
    return {
        forceClose: true,
        url: fastify.getDecorator<Env>("config").DATABASE_URL,
    };
};

export default fp(mongo, {
    name: "@fastify/mongodb",
    dependencies: ["@fastify/env"],
});
