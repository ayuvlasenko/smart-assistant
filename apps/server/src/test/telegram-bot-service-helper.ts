import Fastify, {
    FastifyInstance,
    FastifyPluginAsync,
    FastifyServerOptions,
} from "fastify";
import fp from "fastify-plugin";
import { Redis } from "ioredis";
import { randomBytes } from "node:crypto";
import { TestContext } from "node:test";
import { options as appOptions } from "../app.js";
import { Env } from "../env.js";
import accessDefaultGrantsPlugin from "../plugins/app/access/access-default-grants.js";
import accessPlugin from "../plugins/app/access/access-service.js";
import appLoggerPlugin from "../plugins/app/app-logger.js";
import { BotTokenCipher } from "../plugins/app/bots/bot-token-cipher.js";
import botsRegistryPlugin, {
    BotsRegistry,
} from "../plugins/app/bots/bots-registry.js";
import botsRepositoryPlugin, {
    BotsRepository,
} from "../plugins/app/bots/bots-repository.js";
import cachePlugin, { CacheService } from "../plugins/app/cache-service.js";
import i18nPlugin from "../plugins/app/i18n-service.js";
import lockPlugin from "../plugins/app/lock-service.js";
import metricsPlugin, {
    MetricsService,
} from "../plugins/app/metrics-service.js";
import rateLimiterPlugin from "../plugins/app/rate-limiter.js";
import settingsRepositoryPlugin from "../plugins/app/settings/settings-repository.js";
import settingsServicePlugin, {
    SettingsService,
} from "../plugins/app/settings/settings-service.js";
import userSettingsServicePlugin from "../plugins/app/settings/user-settings-service.js";
import telegramPlugin, {
    TelegramBotService,
} from "../plugins/app/telegram/telegram-bot-service.js";
import telegramBotsPlugin, {
    TelegramApiFactory,
    TelegramBots,
} from "../plugins/app/telegram/telegram-bots.js";
import telegramChatsPlugin, {
    TelegramChats,
} from "../plugins/app/telegram/telegram-chats.js";
import telegramCommandMenusPlugin, {
    TelegramCommandMenus,
} from "../plugins/app/telegram/telegram-command-menus.js";
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
import telegramStartEntriesPlugin from "../plugins/app/telegram/telegram-start-entries.js";
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
import valkeyPlugin, {
    valkeyKeyPrefixOf,
} from "../plugins/external/kv-valkey.js";
import mongoPlugin from "../plugins/external/mongo.js";
import requestContextPlugin, {
    autoConfig as requestContextAutoConfig,
} from "../plugins/external/request-context.js";
import { TestMongo } from "./mongo.js";
import {
    buildTelegramApiServiceMock,
    TelegramApiServiceMock,
} from "./telegram-api-service-mock.js";
import { createTestResourceName, deleteKeysByPrefix } from "./valkey.js";

export interface BuildTelegramBotServiceTestAppOptions {
    testMongo: TestMongo;
    t: TestContext;
    telegramApiService?: TelegramApiServiceMock;
    telegramApiFactory?: TelegramApiFactory;
    modules?: string[];
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
    botsRegistry: BotsRegistry;
    botsRepository: BotsRepository;
    cache: CacheService;
    keyPrefix: string;
    metrics: MetricsService;
    settingsService: SettingsService;
    telegramChats: TelegramChats;
    telegramApiService: TelegramApiServiceMock;
    telegramBotService: TelegramBotService;
    telegramBots: TelegramBots;
    telegramCommandMenus: TelegramCommandMenus;
    telegramUpdateHandler: TelegramUpdateHandler;
    usersRepository: UsersRepository;
}

export async function buildTelegramBotServiceTestApp({
    testMongo,
    t,
    telegramApiService = buildTelegramApiServiceMock({ t }),
    telegramApiFactory,
    modules = ["poker", "ping"],
    environment = "production",
    env = {},
    sessionStoreOptions,
    plugins = [],
    registerRoutes,
    logger = false,
}: BuildTelegramBotServiceTestAppOptions): Promise<TelegramBotServiceTestApp> {
    const resourceName = createTestResourceName();
    const keyPrefix = valkeyKeyPrefixOf(resourceName);
    const rootToken = env.TELEGRAM_BOT_TOKEN ?? process.env.TELEGRAM_BOT_TOKEN;
    const app = Fastify({
        logger,
        ...appOptions,
    });

    app.register(envPlugin, {
        ...envAutoConfig,
        env: false,
        data: {
            ...withoutLocalSecrets(process.env),
            ENVIRONMENT: environment,
            RESOURCE_NAME: resourceName,
            ...env,
        },
    });
    app.register(mongoPlugin, {
        client: testMongo.client,
        database: testMongo.databaseName,
    });
    app.register(valkeyPlugin);
    app.register(requestContextPlugin, requestContextAutoConfig);
    app.register(emitteryPlugin);
    app.register(usersRepositoryPlugin);
    app.register(appLoggerPlugin);
    app.register(cachePlugin);
    app.register(i18nPlugin);
    app.register(accessPlugin);
    app.register(settingsRepositoryPlugin);
    app.register(settingsServicePlugin);
    app.register(userSettingsServicePlugin);
    app.register(accessDefaultGrantsPlugin);
    app.register(botsRepositoryPlugin);
    app.register(botsRegistryPlugin);
    app.register(usersServicePlugin);
    app.register(metricsPlugin);
    app.register(lockPlugin);
    app.register(rateLimiterPlugin);
    app.register(telegramMetricsPlugin);
    app.register(telegramBotsPlugin, {
        telegramApiFactory: (token: string) => {
            if (token === rootToken || !telegramApiFactory) {
                return telegramApiService;
            }

            return telegramApiFactory(token);
        },
    });
    app.register(telegramSessionStorePlugin, {
        telegramSessionStore: sessionStoreOptions,
    });
    app.register(telegramSceneEnginePlugin);
    app.register(telegramChatsPlugin);
    app.register(telegramRouterPlugin);
    app.register(telegramStartEntriesPlugin);
    app.register(telegramSystemHandlersPlugin);
    app.register(telegramCommandMenusPlugin);
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

    const botsRegistry = app.getDecorator<BotsRegistry>("botsRegistry");
    const botsRepository = app.getDecorator<BotsRepository>("botsRepository");
    await botsRepository.updateModules(botsRegistry.rootId, modules);

    return {
        app,
        botsRegistry,
        botsRepository,
        cache: app.getDecorator<CacheService>("cache"),
        keyPrefix,
        metrics: app.getDecorator<MetricsService>("metrics"),
        settingsService: app.getDecorator<SettingsService>("settingsService"),
        telegramChats: app.getDecorator<TelegramChats>("telegramChats"),
        telegramApiService,
        telegramBotService:
            app.getDecorator<TelegramBotService>("telegramBotService"),
        telegramBots: app.getDecorator<TelegramBots>("telegramBots"),
        telegramCommandMenus: app.getDecorator<TelegramCommandMenus>(
            "telegramCommandMenus",
        ),
        telegramUpdateHandler: app.getDecorator<TelegramUpdateHandler>(
            "telegramUpdateHandler",
        ),
        usersRepository: app.getDecorator<UsersRepository>("usersRepository"),
    };
}

export async function buildTwoBotsTestApp(
    options: BuildTelegramBotServiceTestAppOptions,
): Promise<
    TelegramBotServiceTestApp & {
        child: TelegramApiServiceMock;
        childBotId: string;
    }
> {
    const key = randomBytes(32).toString("base64");
    const child = buildTelegramApiServiceMock({ t: options.t });
    const app = await buildTelegramBotServiceTestApp({
        ...options,
        telegramApiFactory: () => child,
        env: { ...options.env, BOTS_ENCRYPTION_KEY: key },
    });
    const bot = await app.botsRepository.createIfMissing({
        telegramId: "42",
        username: "child_bot",
        token: new BotTokenCipher(key).encrypt("42:child-token"),
    });

    if (!bot) {
        throw new Error("Bot 42 is already stored");
    }

    return { ...app, child, childBotId: bot._id };
}

function withoutLocalSecrets(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const copy = { ...env };

    delete copy.INVITE_TOKEN;
    delete copy.BOTS_ENCRYPTION_KEY;

    return copy;
}
