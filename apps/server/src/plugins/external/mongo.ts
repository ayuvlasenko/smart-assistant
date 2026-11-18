import mongo, { FastifyMongodbOptions } from "@fastify/mongodb";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Db } from "mongodb";
import { Env } from "../../env.js";

export const autoConfig = (fastify: FastifyInstance): FastifyMongodbOptions => {
    return {
        forceClose: true,
        monitorCommands: true,
        url: fastify.getDecorator<Env>("config").DATABASE_URL,
    };
};

export function readMongoDb(fastify: FastifyInstance): Db {
    if (!fastify.mongo.db) {
        throw new Error("MongoDB is not connected");
    }

    return fastify.mongo.db;
}

export default fp(mongo, {
    name: "@fastify/mongodb",
    dependencies: ["@fastify/env"],
});
