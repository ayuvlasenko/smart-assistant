import {
    FastifyPluginAsyncTypebox,
    Type,
} from "@fastify/type-provider-typebox";
import { Update } from "@grammyjs/types";
import { FastifyRequest } from "fastify";
import { Env } from "../../../env.js";
import { TelegramBotService } from "../../../plugins/app/telegram/telegram-bot-service.js";
import { TelegramBots } from "../../../plugins/app/telegram/telegram-bots.js";
import { TelegramUpdateHandler } from "../../../plugins/app/telegram/telegram-update-handler.js";
import { isTelegramWebhookSecret } from "../../../plugins/app/telegram/telegram-webhook-secret.js";

export const TELEGRAM_SECRET_HEADER = "x-telegram-bot-api-secret-token";

const unauthorizedErrorSchema = Type.Object({
    message: Type.Literal("Unauthorized"),
    error: Type.Literal("Unauthorized"),
    statusCode: Type.Literal(401),
});

const telegramWebhookHeadersSchema = Type.Object({
    [TELEGRAM_SECRET_HEADER]: Type.String(),
});

const telegramWebhookParamsSchema = Type.Object({
    botId: Type.String(),
});

const telegramBotWebhookSchema = Type.Object({
    botId: Type.String(),
    webhookUrl: Type.String(),
    botUrl: Type.String(),
});

const telegramUpdateSchema = Type.Unsafe<Update>({ type: "object" });

const plugin: FastifyPluginAsyncTypebox = async (fastify) => {
    const telegramBotService =
        fastify.getDecorator<TelegramBotService>("telegramBotService");
    const telegramUpdateHandler = fastify.getDecorator<TelegramUpdateHandler>(
        "telegramUpdateHandler",
    );
    const telegramBots = fastify.getDecorator<TelegramBots>("telegramBots");

    const config = fastify.getDecorator<Env>("config");
    const isValidSecret = (request: FastifyRequest) => {
        const botId = readBotId(request.params);
        const secret = request.headers[TELEGRAM_SECRET_HEADER];

        return (
            botId !== undefined &&
            typeof secret === "string" &&
            isTelegramWebhookSecret(
                config.TELEGRAM_WEBHOOK_SECRET_TOKEN,
                botId,
                secret,
            )
        );
    };

    fastify.post(
        "/webhook/:botId(^\\d+$)",
        {
            config: {
                rateLimit: {
                    max: 5,
                    timeWindow: "1 minute",
                    allowList: isValidSecret,
                },
            },
            schema: {
                params: telegramWebhookParamsSchema,
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

            const bot = telegramBots.find(request.params.botId);

            if (!bot) {
                request.log.warn(
                    { botId: request.params.botId },
                    "Telegram update for an unknown bot, skipping",
                );
                return;
            }

            try {
                await telegramUpdateHandler.handle(bot, request.body);
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
                        "Point the webhooks of the preview bots at this environment",
                    response: {
                        200: Type.Object({
                            bots: Type.Array(telegramBotWebhookSchema),
                        }),
                    },
                },
            },
            async () => ({ bots: await telegramBotService.refreshWebhooks() }),
        );
    }
};

export default plugin;

function readBotId(params: unknown): string | undefined {
    if (typeof params !== "object" || params === null || !("botId" in params)) {
        return undefined;
    }

    return typeof params.botId === "string" ? params.botId : undefined;
}
