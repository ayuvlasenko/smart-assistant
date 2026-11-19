import env, { FastifyEnvOptions } from "@fastify/env";
import { envSchema, isTimeZone } from "../../env.js";

export const autoConfig: FastifyEnvOptions = {
    confKey: "config",
    schema: envSchema,
    data: process.env,
    ajv: {
        customOptions: (ajv) => ajv.addFormat("time-zone", isTimeZone),
    },
};

export default env;
