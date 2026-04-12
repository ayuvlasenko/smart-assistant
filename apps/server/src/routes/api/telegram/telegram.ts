import { Update } from "@grammyjs/types";
import {
    FastifyPluginAsyncTypebox,
    Type,
} from "@fastify/type-provider-typebox";
import { FastifyRequest } from "fastify";
import { TELEGRAM_SECRET_HEADER } from "../../../constants/headers.js";
import { TelegramBotService } from "../../../plugins/app/telegram/telegram-bot-service.js";
import { unauthorizedErrorSchema } from "../../../schemas/common.js";
import {
    telegramUpdateSchema,
    telegramWebhookHeadersSchema,
} from "../../../schemas/telegram.js";

const plugin: FastifyPluginAsyncTypebox = async (fastify) => {
    const telegramBotService =
        fastify.getDecorator<TelegramBotService>("telegramBotService");

    const isValidSecret = (request: FastifyRequest) =>
        request.headers[TELEGRAM_SECRET_HEADER] ===
        fastify.config.TELEGRAM_WEBHOOK_SECRET_TOKEN;

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

            await telegramBotService.handleUpdate(request.body as Update);
        },
    );
};

export default plugin;
