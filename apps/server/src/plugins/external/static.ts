import fastifyStatic, { FastifyStaticOptions } from "@fastify/static";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import fs from "node:fs";
import path from "node:path";

export const autoConfig = (fastify: FastifyInstance): FastifyStaticOptions => {
    const dirPath = path.join(
        import.meta.dirname,
        "../../..",
        fastify.config.STATIC_DIRNAME,
    );
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath);
    }

    return {
        root: dirPath,
        prefix: `/api/${fastify.config.STATIC_DIRNAME}`,
    };
};

export default fp(fastifyStatic, {
    name: "@fastify/static",
    dependencies: ["@fastify/env"],
});
