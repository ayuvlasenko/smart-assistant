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
    telegramId: Type.String(),
});

const telegramBotWebhookSchema = Type.Union([
    Type.Object({
        botId: Type.String(),
        status: Type.Literal("refreshed"),
        webhookUrl: Type.String(),
        botUrl: Type.String(),
    }),
    Type.Object({
        botId: Type.String(),
        status: Type.Literal("failed"),
        error: Type.String(),
    }),
]);

const telegramBotWebhooksSchema = Type.Object({
    bots: Type.Array(telegramBotWebhookSchema),
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
        const telegramId = readTelegramId(request.params);
        const secret = request.headers[TELEGRAM_SECRET_HEADER];

        return (
            telegramId !== undefined &&
            typeof secret === "string" &&
            isTelegramWebhookSecret(
                config.TELEGRAM_WEBHOOK_SECRET_TOKEN,
                telegramId,
                secret,
            )
        );
    };

    fastify.post(
        "/webhook/:telegramId(^\\d+$)",
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

            const bot = await telegramBots.findByTelegramId(
                request.params.telegramId,
            );

            if (!bot) {
                request.log.warn(
                    { botTelegramId: request.params.telegramId },
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
                        200: telegramBotWebhooksSchema,
                        502: telegramBotWebhooksSchema,
                    },
                },
            },
            async (request, reply) => {
                const bots = await telegramBotService.refreshWebhooks();

                return reply
                    .code(
                        bots.some(({ status }) => status === "failed")
                            ? 502
                            : 200,
                    )
                    .send({ bots });
            },
        );
    }
};

export default plugin;

function readTelegramId(params: unknown): string | undefined {
    if (
        typeof params !== "object" ||
        params === null ||
        !("telegramId" in params)
    ) {
        return undefined;
    }

    return typeof params.telegramId === "string"
        ? params.telegramId
        : undefined;
}
