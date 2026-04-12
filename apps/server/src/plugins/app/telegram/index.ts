import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { TelegramApiService } from "./telegram-api-service.js";
import { TelegramBotService } from "./telegram-bot-service.js";

export default fp(
    async function (fastify: FastifyInstance) {
        const telegramApiService = new TelegramApiService(
            fastify.config.TELEGRAM_BOT_TOKEN,
        );
        const telegramBotService = new TelegramBotService(telegramApiService);

        fastify.decorate("telegramBotService", telegramBotService);

        fastify.addHook("onReady", async () => {
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
