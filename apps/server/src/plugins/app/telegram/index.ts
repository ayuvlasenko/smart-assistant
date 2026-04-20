import { FastifyInstance, FastifyPluginOptions } from "fastify";
import fp from "fastify-plugin";
import { Env } from "../../../schemas/env.js";
import {
    TelegramApiClient,
    TelegramApiService,
} from "./telegram-api-service.js";
import { TelegramBotService } from "./telegram-bot-service.js";

export interface TelegramPluginOptions extends FastifyPluginOptions {
    telegramApiService?: TelegramApiClient;
}

export function resolveTelegramWebhookUrl(
    config: Pick<Env, "DOMAIN" | "RESOURCE_NAME" | "TELEGRAM_WEBHOOK_URL">,
) {
    if (config.TELEGRAM_WEBHOOK_URL) {
        return config.TELEGRAM_WEBHOOK_URL;
    }

    return new URL(
        `/api/telegram/webhook/${config.RESOURCE_NAME}`,
        config.DOMAIN,
    ).toString();
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
                url: resolveTelegramWebhookUrl(fastify.config),
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
