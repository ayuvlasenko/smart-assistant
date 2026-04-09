import env, { FastifyEnvOptions } from "@fastify/env";
import { Env, envSchema } from "../../schemas/env.js";

declare module "fastify" {
    interface FastifyInstance {
        config: Env;
    }
}

export const autoConfig: FastifyEnvOptions = {
    confKey: "config",
    schema: envSchema,
    data: process.env,
};

export default env;
