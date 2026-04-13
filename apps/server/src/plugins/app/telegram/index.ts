import { FastifyInstance, FastifyPluginOptions } from "fastify";
import fp from "fastify-plugin";
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
        const telegramBotService = new TelegramBotService(telegramApiService);

        fastify.decorate("telegramBotService", telegramBotService);

        fastify.addHook("onListen", async () => {
            const result = await telegramApiService.setWebhook({
                url: `${fastify.config.TELEGRAM_WEBHOOK_URL}/api/telegram/webhook`,
                secret_token: fastify.config.TELEGRAM_WEBHOOK_SECRET_TOKEN,
            });

            if (!result.ok) {
                throw new Error(
                    `Failed to set telegram webhook: ${result.description}`,
                );
            }

            fastify.log.info("Telegram webhook set successfully");
        });
    },
    {
        name: "telegram-bot-service",
        dependencies: ["@fastify/env"],
    },
);
