import Fastify, { FastifyInstance, FastifyServerOptions } from "fastify";
import fp from "fastify-plugin";
import { Redis } from "ioredis";
import { TestContext } from "node:test";
import { setTimeout } from "node:timers/promises";
import serviceApp, { options } from "../app.js";
import { Env } from "../env.js";
import { requestIdOptions } from "../request-logging.js";
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
            INVITE_TOKEN: undefined,
        },
        () => app.ready(),
    );
    await waitUntilNotUnderPressure(app);

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

async function waitUntilNotUnderPressure(app: FastifyInstance): Promise<void> {
    while (app.isUnderPressure()) {
        await setTimeout(50);
    }
}

async function withEnv(
    overrides: Record<string, string | undefined>,
    fn: () => PromiseLike<unknown>,
): Promise<void> {
    const previous = Object.keys(overrides).map(
        (key) => [key, process.env[key]] as const,
    );

    applyEnv(Object.entries(overrides));

    try {
        await fn();
    } finally {
        applyEnv(previous);
    }
}

function applyEnv(
    values: Iterable<readonly [string, string | undefined]>,
): void {
    for (const [key, value] of values) {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
}
