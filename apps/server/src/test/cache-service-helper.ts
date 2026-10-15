import Fastify, { FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { TestContext } from "node:test";
import { options as appOptions } from "../app.js";
import appLoggerPlugin from "../plugins/app/app-logger.js";
import cachePlugin, { CacheService } from "../plugins/app/cache-service.js";
import lockPlugin, { LockService } from "../plugins/app/lock-service.js";
import metricsPlugin, {
    MetricsService,
} from "../plugins/app/metrics-service.js";
import envPlugin, {
    autoConfig as envAutoConfig,
} from "../plugins/external/env.js";
import valkeyPlugin from "../plugins/external/kv-valkey.js";
import requestContextPlugin, {
    autoConfig as requestContextAutoConfig,
} from "../plugins/external/request-context.js";
import { createTestKeyPrefix, deleteKeysByPrefix } from "./valkey.js";

export interface BuildCacheServiceTestAppOptions {
    t: TestContext;
}

export interface CacheServiceTestApp {
    app: FastifyInstance;
    cache: CacheService;
    client: Redis;
    lockService: LockService;
    metrics: MetricsService;
    keyPrefix: string;
}

export async function buildCacheServiceTestApp({
    t,
}: BuildCacheServiceTestAppOptions): Promise<CacheServiceTestApp> {
    const keyPrefix = createTestKeyPrefix();
    const resourceName = keyPrefix.slice("smart-assistant:".length, -1);
    const app = Fastify({
        logger: false,
        trustProxy: true,
        ...appOptions,
    });

    app.register(envPlugin, {
        ...envAutoConfig,
        data: {
            ...process.env,
            RESOURCE_NAME: resourceName,
        },
    });
    app.register(requestContextPlugin, requestContextAutoConfig);
    app.register(valkeyPlugin);
    app.register(appLoggerPlugin);
    app.register(cachePlugin);
    app.register(metricsPlugin);
    app.register(lockPlugin);

    await app.ready();

    const client = app.getDecorator<Redis>("valkey");

    t.after(async () => {
        try {
            await deleteKeysByPrefix(client, keyPrefix);
        } finally {
            await app.close();
        }
    });

    return {
        app,
        cache: app.getDecorator<CacheService>("cache"),
        client,
        lockService: app.getDecorator<LockService>("lockService"),
        metrics: app.getDecorator<MetricsService>("metrics"),
        keyPrefix,
    };
}
