import { FastifyInstance, FastifyPluginOptions } from "fastify";
import fp from "fastify-plugin";
import { CacheService } from "../cache.js";
import { AppLogger } from "../logger.js";
import { UsersRepository } from "../users-repository.js";
import {
    TelegramApiClient,
    TelegramApiService,
} from "./telegram-api-service.js";
import { TelegramBotService } from "./telegram-bot-service.js";

export interface TelegramPluginOptions extends FastifyPluginOptions {
    telegramApiService?: TelegramApiClient;
}

export default fp(
    async function (fastify: FastifyInstance, opts: TelegramPluginOptions) {
        const telegramApiService =
            opts.telegramApiService ??
            new TelegramApiService(fastify.config.TELEGRAM_BOT_TOKEN);
        const usersRepository =
            fastify.getDecorator<UsersRepository>("usersRepository");
        const appLogger = fastify.getDecorator<AppLogger>("appLogger");
        const cache = fastify.getDecorator<CacheService>("cache");
        const telegramBotService = new TelegramBotService(
            appLogger.child({ module: "telegram" }),
            telegramApiService,
            usersRepository,
            cache,
            fastify.config,
        );

        fastify.decorate("telegramBotService", telegramBotService);

        fastify.addHook("onListen", async () => {
            await telegramBotService.setWebhook();
        });
    },
    {
        name: "telegram-bot-service",
        dependencies: [
            "@fastify/env",
            "app-logger",
            "cache",
            "users-repository",
        ],
    },
);
