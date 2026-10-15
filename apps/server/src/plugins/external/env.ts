import env, { FastifyEnvOptions } from "@fastify/env";
import { envSchema } from "../../schemas/env.js";

export const autoConfig: FastifyEnvOptions = {
    confKey: "config",
    schema: envSchema,
    data: process.env,
};

export default env;
