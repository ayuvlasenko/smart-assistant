import {
    FastifyPluginAsyncTypebox,
    Type,
} from "@fastify/type-provider-typebox";
import { pressureExemptConfig } from "../plugins/external/under-pressure.js";

const plugin: FastifyPluginAsyncTypebox = async (fastify) => {
    fastify.get(
        "/live",
        {
            logLevel: "silent",
            config: pressureExemptConfig,
            schema: {
                response: {
                    200: Type.Object({ status: Type.Literal("ok") }),
                },
            },
        },
        async () => ({ status: "ok" as const }),
    );
};

export default plugin;
