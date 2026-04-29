import Fastify, { FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { MongoClient } from "mongodb";
import { TestContext } from "node:test";
import { options as appOptions } from "../app.js";
import cachePlugin, { CacheService } from "../plugins/app/cache.js";
import appLoggerPlugin from "../plugins/app/logger.js";
import telegramPlugin from "../plugins/app/telegram/index.js";
import { TelegramBotService } from "../plugins/app/telegram/telegram-bot-service.js";
import usersRepositoryPlugin, {
    UsersRepository,
} from "../plugins/app/users-repository.js";
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
}

export interface TelegramBotServiceTestApp {
    app: FastifyInstance;
    cache: CacheService;
    keyPrefix: string;
    telegramApiService: TelegramApiServiceMock;
    telegramBotService: TelegramBotService;
    usersRepository: UsersRepository;
}

export async function buildTelegramBotServiceTestApp({
    databaseName,
    mongoClient,
    t,
    telegramApiService = buildTelegramApiServiceMock({ t }),
}: BuildTelegramBotServiceTestAppOptions): Promise<TelegramBotServiceTestApp> {
    const keyPrefix = createTestKeyPrefix();
    const resourceName = keyPrefix.slice("smart-assistant:".length, -1);
    const app = Fastify({
        logger: false,
        trustProxy: true,
        ...appOptions,
    });

    app.register(envPlugin, {
        ...envAutoConfig,
        data: { ...process.env, RESOURCE_NAME: resourceName },
    });
    app.register(mongoPlugin, {
        client: mongoClient,
        database: databaseName,
    });
    app.register(valkeyPlugin);
    app.register(requestContextPlugin, requestContextAutoConfig);
    app.register(usersRepositoryPlugin);
    app.register(appLoggerPlugin);
    app.register(cachePlugin);
    app.register(telegramPlugin, { telegramApiService });

    await app.ready();

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
        telegramApiService,
        telegramBotService:
            app.getDecorator<TelegramBotService>("telegramBotService"),
        usersRepository: app.getDecorator<UsersRepository>("usersRepository"),
    };
}
