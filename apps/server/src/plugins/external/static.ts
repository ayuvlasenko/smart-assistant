import fastifyStatic, { FastifyStaticOptions } from "@fastify/static";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import fs from "node:fs";
import path from "node:path";
import { Env } from "../../env.js";

export const autoConfig = (fastify: FastifyInstance): FastifyStaticOptions => {
    const config = fastify.getDecorator<Env>("config");
    const dirPath = path.join(
        import.meta.dirname,
        "../../..",
        config.STATIC_DIRNAME,
    );
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath);
    }

    return {
        root: dirPath,
        prefix: `/api/${config.STATIC_DIRNAME}`,
    };
};

export default fp(fastifyStatic, {
    name: "@fastify/static",
    dependencies: ["@fastify/env"],
});
