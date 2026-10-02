import Fastify, { FastifyServerOptions } from "fastify";
import fp from "fastify-plugin";
import { Redis } from "ioredis";
import { TestContext } from "node:test";
import serviceApp, { options } from "../app.js";
import { requestIdOptions } from "../constants/options.js";
import { Env } from "../schemas/env.js";
import {
    buildTelegramApiServiceMock,
    TelegramApiServiceMock,
} from "./telegram-api-service-mock.js";
import { createTestKeyPrefix, deleteKeysByPrefix } from "./valkey.js";

type BuildOptions = {
    t: TestContext;
    logger?: FastifyServerOptions["logger"];
    telegramApiService?: TelegramApiServiceMock;
    environment?: Env["ENVIRONMENT"];
};

export async function buildTestApp({ t, ...opts }: BuildOptions) {
    const keyPrefix = createTestKeyPrefix();
    const app = Fastify({
        logger: opts.logger ?? false,
        ...requestIdOptions,
        trustProxy: true,
        ...options,
    });

    const telegramApiService =
        opts.telegramApiService ?? buildTelegramApiServiceMock({ t });

    app.register(fp(serviceApp), { telegramApiService });

    await withEnv(
        {
            ENVIRONMENT: opts.environment ?? "production",
            RESOURCE_NAME: keyPrefix.slice("smart-assistant:".length, -1),
        },
        () => app.ready(),
    );

    t.after(async () => {
        try {
            await deleteKeysByPrefix(
                app.getDecorator<Redis>("valkey"),
                keyPrefix,
            );
        } finally {
            await app.close();
        }
    });

    return { app, telegramApiService };
}

async function withEnv(
    overrides: Record<string, string>,
    fn: () => PromiseLike<unknown>,
): Promise<void> {
    const previous = Object.keys(overrides).map(
        (key) => [key, process.env[key]] as const,
    );
    Object.assign(process.env, overrides);

    try {
        await fn();
    } finally {
        for (const [key, value] of previous) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    }
}
