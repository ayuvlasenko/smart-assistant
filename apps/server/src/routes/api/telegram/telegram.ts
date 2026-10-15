import {
    FastifyPluginAsyncTypebox,
    Type,
} from "@fastify/type-provider-typebox";
import { Update } from "@grammyjs/types";
import { FastifyRequest } from "fastify";
import { TelegramBotService } from "../../../plugins/app/telegram/telegram-bot-service.js";
import { TelegramUpdateHandler } from "../../../plugins/app/telegram/telegram-update-handler.js";
import { unauthorizedErrorSchema } from "../../../schemas/common.js";
import { Env } from "../../../schemas/env.js";

export const TELEGRAM_SECRET_HEADER = "x-telegram-bot-api-secret-token";

const telegramWebhookHeadersSchema = Type.Object({
    [TELEGRAM_SECRET_HEADER]: Type.String(),
});

const telegramUpdateSchema = Type.Unsafe<Update>({ type: "object" });

const plugin: FastifyPluginAsyncTypebox = async (fastify) => {
    const telegramBotService =
        fastify.getDecorator<TelegramBotService>("telegramBotService");
    const telegramUpdateHandler = fastify.getDecorator<TelegramUpdateHandler>(
        "telegramUpdateHandler",
    );

    const config = fastify.getDecorator<Env>("config");
    const isValidSecret = (request: FastifyRequest) =>
        request.headers[TELEGRAM_SECRET_HEADER] ===
        config.TELEGRAM_WEBHOOK_SECRET_TOKEN;

    fastify.post(
        "/webhook",
        {
            config: {
                rateLimit: {
                    max: 5,
                    timeWindow: "1 minute",
                    allowList: isValidSecret,
                },
            },
            schema: {
                body: telegramUpdateSchema,
                headers: telegramWebhookHeadersSchema,
                response: {
                    200: Type.Null(),
                    401: unauthorizedErrorSchema,
                },
            },
        },
        async (request, reply) => {
            if (!isValidSecret(request)) {
                return reply.unauthorized();
            }

            try {
                await telegramUpdateHandler.handle(request.body);
            } catch (err) {
                request.log.error({ err }, "Failed to handle Telegram update");
            }
        },
    );

    if (config.ENVIRONMENT === "preview") {
        fastify.post(
            "/webhook/refresh",
            {
                config: {
                    rateLimit: {
                        max: 3,
                        timeWindow: "1 minute",
                    },
                },
                schema: {
                    tags: ["telegram"],
                    summary:
                        "Point the preview bot webhook at this environment",
                    response: {
                        200: Type.Object({
                            webhookUrl: Type.String(),
                            botUrl: Type.String(),
                        }),
                    },
                },
            },
            async () => {
                const botUrl = await telegramBotService.resolveBotUrl();
                const webhookUrl = await telegramBotService.refreshWebhook();

                return { webhookUrl, botUrl };
            },
        );
    }
};

export default plugin;
