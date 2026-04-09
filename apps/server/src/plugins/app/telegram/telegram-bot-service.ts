import { Update } from "@grammyjs/types";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { TelegramApiService } from "./telegram-api-service.js";

export class TelegramBotService {
    constructor(private readonly telegramApiService: TelegramApiService) {}

    async handleUpdate(update: Update): Promise<void> {
        if (update.message?.text === "ping") {
            await this.telegramApiService.sendMessage({
                chat_id: update.message.chat.id,
                text: "pong",
            });
        }
    }
}

export default fp(
    async function (fastify: FastifyInstance) {
        const telegramApiService =
            fastify.getDecorator<TelegramApiService>("telegramApiService");

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
        dependencies: ["telegram-api-service", "@fastify/env"],
    },
);
