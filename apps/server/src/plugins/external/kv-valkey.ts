import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Redis, RedisOptions } from "ioredis";
import { Env } from "../../schemas/env.js";

export function buildValkeyKeyPrefix(
    config: Pick<Env, "RESOURCE_NAME">,
): string {
    return `smart-assistant:${config.RESOURCE_NAME}`;
}

export default fp(
    async function valkeyPlugin(fastify: FastifyInstance) {
        const client = buildValkeyClient(fastify.config);

        fastify.decorate("valkey", client);

        try {
            await client.connect();
        } catch (err) {
            client.disconnect();
            throw err;
        }

        fastify.addHook("onClose", async () => {
            await client.quit();
        });
    },
    {
        name: "valkey",
        dependencies: ["@fastify/env"],
    },
);

function buildValkeyClient(config: Env): Redis {
    const options: RedisOptions = {
        connectTimeout: config.VALKEY_CONNECT_TIMEOUT_MS,
        enableOfflineQueue: false,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null,
    };

    return new Redis(config.VALKEY_URL, options);
}
