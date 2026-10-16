import Fastify, {
    FastifyInstance,
    FastifyPluginAsync,
    FastifyServerOptions,
} from "fastify";
import fp from "fastify-plugin";
import { Redis } from "ioredis";
import { MongoClient } from "mongodb";
import { TestContext } from "node:test";
import { options as appOptions } from "../app.js";
import { Env } from "../env.js";
import appLoggerPlugin from "../plugins/app/app-logger.js";
import cachePlugin, { CacheService } from "../plugins/app/cache-service.js";
import i18nPlugin from "../plugins/app/i18n-service.js";
import lockPlugin from "../plugins/app/lock-service.js";
import metricsPlugin, {
    MetricsService,
} from "../plugins/app/metrics-service.js";
import rateLimiterPlugin from "../plugins/app/rate-limiter.js";
import telegramApiPlugin from "../plugins/app/telegram/telegram-api-service.js";
import telegramPlugin, {
    TelegramBotService,
} from "../plugins/app/telegram/telegram-bot-service.js";
import telegramChatsPlugin, {
    TelegramChats,
} from "../plugins/app/telegram/telegram-chats.js";
import telegramMetricsPlugin from "../plugins/app/telegram/telegram-metrics.js";
import telegramRouterPlugin, {
    TelegramRouter,
} from "../plugins/app/telegram/telegram-router.js";
import telegramSceneEnginePlugin, {
    TelegramSceneEngine,
} from "../plugins/app/telegram/telegram-scene-engine.js";
import telegramSessionStorePlugin, {
    TelegramSessionStoreOptions,
} from "../plugins/app/telegram/telegram-session-store.js";
import telegramSystemHandlersPlugin from "../plugins/app/telegram/telegram-system-handlers.js";
import telegramUpdateHandlerPlugin, {
    TelegramUpdateHandler,
} from "../plugins/app/telegram/telegram-update-handler.js";
import usersRepositoryPlugin, {
    UsersRepository,
} from "../plugins/app/users/users-repository.js";
import usersServicePlugin from "../plugins/app/users/users-service.js";
import emitteryPlugin from "../plugins/external/emittery.js";
import envPlugin, {
    autoConfig as envAutoConfig,
} from "../plugins/external/env.js";
import valkeyPlugin from "../plugins/external/kv-valkey.js";
import mongoPlugin from "../plugins/external/mongo.js";
import requestContextPlugin, {
    autoConfig as requestContextAutoConfig,
} from "../plugins/external/request-context.js";
import {
    buildTelegramApiServiceMock,
    TelegramApiServiceMock,
} from "./telegram-api-service-mock.js";
import { createTestKeyPrefix, deleteKeysByPrefix } from "./valkey.js";

export interface BuildTelegramBotServiceTestAppOptions {
    databaseName: string;
    mongoClient: MongoClient;
    t: TestContext;
    telegramApiService?: TelegramApiServiceMock;
    environment?: Env["ENVIRONMENT"];
    env?: Record<string, string>;
    sessionStoreOptions?: TelegramSessionStoreOptions;
    plugins?: FastifyPluginAsync[];
    registerRoutes?: (
        router: TelegramRouter,
        sceneEngine: TelegramSceneEngine,
    ) => void;
    logger?: FastifyServerOptions["logger"];
}

export interface TelegramBotServiceTestApp {
    app: FastifyInstance;
    cache: CacheService;
    keyPrefix: string;
    metrics: MetricsService;
    telegramChats: TelegramChats;
    telegramApiService: TelegramApiServiceMock;
    telegramBotService: TelegramBotService;
    telegramUpdateHandler: TelegramUpdateHandler;
    usersRepository: UsersRepository;
}

export async function buildTelegramBotServiceTestApp({
    databaseName,
    mongoClient,
    t,
    telegramApiService = buildTelegramApiServiceMock({ t }),
    environment = "production",
    env = {},
    sessionStoreOptions,
    plugins = [],
    registerRoutes,
    logger = false,
}: BuildTelegramBotServiceTestAppOptions): Promise<TelegramBotServiceTestApp> {
    const keyPrefix = createTestKeyPrefix();
    const resourceName = keyPrefix.slice("smart-assistant:".length, -1);
    const app = Fastify({
        logger,
        trustProxy: true,
        ...appOptions,
    });

    app.register(envPlugin, {
        ...envAutoConfig,
        env: false,
        data: {
            ...withoutInviteToken(process.env),
            ENVIRONMENT: environment,
            RESOURCE_NAME: resourceName,
            ...env,
        },
    });
    app.register(mongoPlugin, {
        client: mongoClient,
        database: databaseName,
    });
    app.register(valkeyPlugin);
    app.register(requestContextPlugin, requestContextAutoConfig);
    app.register(emitteryPlugin);
    app.register(usersRepositoryPlugin);
    app.register(usersServicePlugin);
    app.register(appLoggerPlugin);
    app.register(cachePlugin);
    app.register(i18nPlugin);
    app.register(metricsPlugin);
    app.register(lockPlugin);
    app.register(rateLimiterPlugin);
    app.register(telegramMetricsPlugin);
    app.register(telegramApiPlugin, { telegramApiService });
    app.register(telegramSessionStorePlugin, {
        telegramSessionStore: sessionStoreOptions,
    });
    app.register(telegramSceneEnginePlugin);
    app.register(telegramChatsPlugin);
    app.register(telegramRouterPlugin);
    app.register(telegramSystemHandlersPlugin);
    app.register(telegramPlugin);
    app.register(telegramUpdateHandlerPlugin);

    for (const plugin of plugins) {
        app.register(plugin);
    }

    if (registerRoutes) {
        app.register(
            fp(
                async (fastify) => {
                    registerRoutes(
                        fastify.getDecorator<TelegramRouter>("telegramRouter"),
                        fastify.getDecorator<TelegramSceneEngine>(
                            "telegramSceneEngine",
                        ),
                    );
                },
                { dependencies: ["telegram-router", "telegram-scene-engine"] },
            ),
        );
    }

    try {
        await app.ready();
    } catch (err) {
        await app.close();
        throw err;
    }

    const valkey = app.getDecorator<Redis>("valkey");

    t.after(async () => {
        try {
            await deleteKeysByPrefix(valkey, keyPrefix);
        } finally {
            await app.close();
        }
    });

    return {
        app,
        cache: app.getDecorator<CacheService>("cache"),
        keyPrefix,
        metrics: app.getDecorator<MetricsService>("metrics"),
        telegramChats: app.getDecorator<TelegramChats>("telegramChats"),
        telegramApiService,
        telegramBotService:
            app.getDecorator<TelegramBotService>("telegramBotService"),
        telegramUpdateHandler: app.getDecorator<TelegramUpdateHandler>(
            "telegramUpdateHandler",
        ),
        usersRepository: app.getDecorator<UsersRepository>("usersRepository"),
    };
}

function withoutInviteToken(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const copy = { ...env };

    delete copy.INVITE_TOKEN;

    return copy;
}
