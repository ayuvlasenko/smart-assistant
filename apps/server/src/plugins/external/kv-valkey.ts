import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Redis, RedisOptions } from "ioredis";
import { Env } from "../../env.js";

const RECONNECT_DELAY_STEP_MS = 200;
const MAX_RECONNECT_DELAY_MS = 2000;

export default fp(
    async function valkeyPlugin(fastify: FastifyInstance) {
        const client = buildValkeyClient(fastify.getDecorator<Env>("config"));

        client.on("error", (err) => {
            fastify.log.warn({ err }, "Valkey connection error");
        });

        fastify.decorate("valkey", client);

        try {
            await client.connect();
        } catch (err) {
            client.disconnect();
            throw err;
        }

        fastify.addHook("onClose", () => {
            client.disconnect();
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
        keyPrefix: `smart-assistant:${config.RESOURCE_NAME}:`,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        retryStrategy: (attempt) =>
            Math.min(attempt * RECONNECT_DELAY_STEP_MS, MAX_RECONNECT_DELAY_MS),
    };

    return new Redis(config.VALKEY_URL, options);
}
