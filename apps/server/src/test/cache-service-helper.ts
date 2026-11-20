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
import rateLimiterPlugin, { RateLimiter } from "../plugins/app/rate-limiter.js";
import envPlugin, {
    autoConfig as envAutoConfig,
} from "../plugins/external/env.js";
import valkeyPlugin, {
    valkeyKeyPrefixOf,
} from "../plugins/external/kv-valkey.js";
import requestContextPlugin, {
    autoConfig as requestContextAutoConfig,
} from "../plugins/external/request-context.js";
import { createTestResourceName, deleteKeysByPrefix } from "./valkey.js";

export interface BuildCacheServiceTestAppOptions {
    t: TestContext;
}

export interface CacheServiceTestApp {
    app: FastifyInstance;
    cache: CacheService;
    client: Redis;
    lockService: LockService;
    metrics: MetricsService;
    rateLimiter: RateLimiter;
    keyPrefix: string;
}

export async function buildCacheServiceTestApp({
    t,
}: BuildCacheServiceTestAppOptions): Promise<CacheServiceTestApp> {
    const resourceName = createTestResourceName();
    const keyPrefix = valkeyKeyPrefixOf(resourceName);
    const app = Fastify({
        logger: false,
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
    app.register(rateLimiterPlugin);

    t.after(async () => {
        try {
            if (app.hasDecorator("valkey")) {
                await deleteKeysByPrefix(
                    app.getDecorator<Redis>("valkey"),
                    keyPrefix,
                );
            }
        } finally {
            await app.close();
        }
    });

    await app.ready();

    const client = app.getDecorator<Redis>("valkey");

    return {
        app,
        cache: app.getDecorator<CacheService>("cache"),
        client,
        lockService: app.getDecorator<LockService>("lockService"),
        metrics: app.getDecorator<MetricsService>("metrics"),
        rateLimiter: app.getDecorator<RateLimiter>("rateLimiter"),
        keyPrefix,
    };
}
