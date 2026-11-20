import { WebhookInfo } from "@grammyjs/types";
import { type Static, Type } from "@sinclair/typebox";
import { FastifyBaseLogger, FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { createHash } from "node:crypto";
import { Env } from "../../../env.js";
import { AppLogger } from "../app-logger.js";
import { CacheService } from "../cache-service.js";
import { LockService } from "../lock-service.js";
import { TelegramBot, TelegramBots } from "./telegram-bots.js";
import { TelegramCommandMenus } from "./telegram-command-menus.js";
import {
    buildTelegramBotUrl,
    buildTelegramDeepLinkUrl,
    TelegramDeepLink,
} from "./telegram-deep-links.js";
import { TelegramApiError, unwrapTelegramResponse } from "./telegram-errors.js";
import { telegramWebhookSecret } from "./telegram-webhook-secret.js";

type TelegramBotConfig = Pick<
    Env,
    | "DOMAIN"
    | "ENVIRONMENT"
    | "RESOURCE_NAME"
    | "TELEGRAM_WEBHOOK_SECRET_TOKEN"
    | "TELEGRAM_WEBHOOK_URL"
>;

export const telegramBotWebhookSchema = Type.Union([
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

export type TelegramBotWebhook = Static<typeof telegramBotWebhookSchema>;

interface TelegramWebhook {
    url: string;
    secret_token: string;
}

const telegramWebhookTtlMilliseconds = 60 * 60 * 1000;
const telegramWebhookClaimTtlMilliseconds = 60 * 1000;
const telegramBotUsernameCacheTtlMilliseconds = 5 * 60 * 1000;

export function resolveTelegramWebhookUrl(
    config: Pick<Env, "DOMAIN" | "RESOURCE_NAME" | "TELEGRAM_WEBHOOK_URL">,
    telegramId: string,
): string {
    const baseUrl = config.TELEGRAM_WEBHOOK_URL;

    if (baseUrl) {
        return `${baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl}/${telegramId}`;
    }

    return new URL(
        `/api/telegram/webhook/${config.RESOURCE_NAME}/${telegramId}`,
        config.DOMAIN,
    ).toString();
}

export class TelegramBotService {
    private readonly log: FastifyBaseLogger;
    private readonly telegramBots: TelegramBots;
    private readonly telegramCommandMenus: TelegramCommandMenus;
    private readonly cache: CacheService;
    private readonly lockService: LockService;
    private readonly config: TelegramBotConfig;

    constructor(
        log: FastifyBaseLogger,
        telegramBots: TelegramBots,
        telegramCommandMenus: TelegramCommandMenus,
        cache: CacheService,
        lockService: LockService,
        config: TelegramBotConfig,
    ) {
        this.log = log;
        this.telegramBots = telegramBots;
        this.telegramCommandMenus = telegramCommandMenus;
        this.cache = cache;
        this.lockService = lockService;
        this.config = config;
    }

    async setUpOnStart(): Promise<void> {
        if (this.config.ENVIRONMENT === "preview") {
            this.log.info(
                "Telegram webhooks are not set on preview start, claim them with POST /api/telegram/webhook/refresh",
            );
            return;
        }

        for (const bot of await this.listBotsOnStart()) {
            await this.setWebhookOnStart(bot);
            await this.syncCommandMenusOnStart(bot);
        }
    }

    async setWebhook(bot: TelegramBot): Promise<string> {
        const webhook = this.webhookOf(bot);
        const { url } = webhook;

        unwrapTelegramResponse("setWebhook", await bot.api.setWebhook(webhook));
        await this.cache.set(webhookKeyOf(bot), digestOf(webhook), {
            ttlMilliseconds: telegramWebhookTtlMilliseconds,
        });

        this.log.info(
            { botId: bot.id, url },
            "Telegram webhook set successfully",
        );

        return url;
    }

    async deleteWebhook(bot: TelegramBot): Promise<void> {
        unwrapTelegramResponse("deleteWebhook", await bot.api.deleteWebhook());

        this.log.info({ botId: bot.id }, "Telegram webhook deleted");
    }

    async readWebhook(bot: TelegramBot): Promise<WebhookInfo> {
        return unwrapTelegramResponse(
            "getWebhookInfo",
            await bot.api.getWebhookInfo(),
        );
    }

    async refreshWebhooks(): Promise<TelegramBotWebhook[]> {
        const webhooks: TelegramBotWebhook[] = [];

        for (const bot of await this.telegramBots.list()) {
            try {
                webhooks.push(await this.refreshWebhook(bot));
            } catch (err) {
                this.log.error(
                    { err, botId: bot.id },
                    "Failed to refresh the webhook of a bot",
                );
                webhooks.push({
                    botId: bot.id,
                    status: "failed",
                    error:
                        err instanceof TelegramApiError
                            ? err.message
                            : "Telegram request failed",
                });
            }
        }

        return webhooks;
    }

    async resolveDeepLinkUrl(
        botId: string,
        link: TelegramDeepLink,
    ): Promise<string> {
        return buildTelegramDeepLinkUrl(
            await this.resolveUsername(await this.telegramBots.get(botId)),
            link,
        );
    }

    private async listBotsOnStart(): Promise<TelegramBot[]> {
        try {
            return await this.telegramBots.list();
        } catch (err) {
            this.log.error({ err }, "Failed to read the bots on start");
            return [];
        }
    }

    private async setWebhookOnStart(bot: TelegramBot): Promise<void> {
        try {
            await this.setClaimedWebhook(bot);
        } catch (err) {
            this.log.error(
                { err, botId: bot.id },
                "Failed to set the webhook of a bot on start",
            );
        }
    }

    private async setClaimedWebhook(bot: TelegramBot): Promise<void> {
        const isSet =
            (await this.cache.get(webhookKeyOf(bot), Type.String())) ===
            digestOf(this.webhookOf(bot));
        const claim = isSet
            ? undefined
            : await this.lockService.tryAcquire(
                  `${webhookKeyOf(bot)}:claim`,
                  telegramWebhookClaimTtlMilliseconds,
              );

        if (!claim) {
            this.log.info({ botId: bot.id }, "Telegram webhook setup skipped");
            return;
        }

        try {
            await this.setWebhook(bot);
        } finally {
            await this.lockService.release(claim);
        }
    }

    private webhookOf(bot: TelegramBot): TelegramWebhook {
        return {
            url: resolveTelegramWebhookUrl(this.config, bot.telegramId),
            secret_token: telegramWebhookSecret(
                this.config.TELEGRAM_WEBHOOK_SECRET_TOKEN,
                bot.telegramId,
            ),
        };
    }

    private async syncCommandMenusOnStart(bot: TelegramBot): Promise<void> {
        try {
            await this.telegramCommandMenus.syncBot(bot);
        } catch (err) {
            this.log.error(
                { err, botId: bot.id },
                "Failed to set the commands of a bot on start",
            );
        }
    }

    private async refreshWebhook(
        bot: TelegramBot,
    ): Promise<TelegramBotWebhook> {
        const botUrl = buildTelegramBotUrl(await this.resolveUsername(bot));
        const webhookUrl = await this.setWebhook(bot);

        await this.telegramCommandMenus.refresh(bot);

        return { botId: bot.id, status: "refreshed", webhookUrl, botUrl };
    }

    private resolveUsername(bot: TelegramBot): Promise<string> {
        return this.cache.remember(
            `telegram:${bot.telegramId}:username`,
            Type.String(),
            telegramBotUsernameCacheTtlMilliseconds,
            () => this.fetchUsername(bot),
        );
    }

    private async fetchUsername(bot: TelegramBot): Promise<string> {
        return unwrapTelegramResponse("getMe", await bot.api.getMe()).username;
    }
}

function webhookKeyOf(bot: TelegramBot): string {
    return `telegram:${bot.telegramId}:webhook`;
}

function digestOf({ url, secret_token }: TelegramWebhook): string {
    return createHash("sha256")
        .update(`${url}\n${secret_token}`)
        .digest("base64url");
}

export default fp(
    async function (fastify: FastifyInstance) {
        const appLogger = fastify.getDecorator<AppLogger>("appLogger");
        const telegramBotService = new TelegramBotService(
            appLogger.child({ module: "telegram" }),
            fastify.getDecorator<TelegramBots>("telegramBots"),
            fastify.getDecorator<TelegramCommandMenus>("telegramCommandMenus"),
            fastify.getDecorator<CacheService>("cache"),
            fastify.getDecorator<LockService>("lockService"),
            fastify.getDecorator<Env>("config"),
        );

        fastify.decorate("telegramBotService", telegramBotService);

        fastify.addHook("onListen", async () => {
            await telegramBotService.setUpOnStart();
        });
    },
    {
        name: "telegram-bot-service",
        dependencies: [
            "@fastify/env",
            "app-logger",
            "cache",
            "lock-service",
            "telegram-bots",
            "telegram-command-menus",
        ],
    },
);
