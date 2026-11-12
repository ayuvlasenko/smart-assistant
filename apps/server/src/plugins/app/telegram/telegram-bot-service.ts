import { WebhookInfo } from "@grammyjs/types";
import { Type } from "@sinclair/typebox";
import { FastifyBaseLogger, FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Env } from "../../../env.js";
import { AppLogger } from "../app-logger.js";
import { CacheService } from "../cache-service.js";
import { I18nService } from "../i18n-service.js";
import { LockService } from "../lock-service.js";
import { TelegramBot, TelegramBots } from "./telegram-bots.js";
import { TelegramCommandMenus } from "./telegram-command-menus.js";
import {
    buildTelegramDeepLinkUrl,
    TelegramDeepLink,
} from "./telegram-deep-links.js";
import { TelegramApiError } from "./telegram-errors.js";
import { telegramLocales } from "./telegram-locales.js";
import { telegramWebhookSecret } from "./telegram-webhook-secret.js";

type TelegramBotConfig = Pick<
    Env,
    | "DOMAIN"
    | "ENVIRONMENT"
    | "RESOURCE_NAME"
    | "TELEGRAM_WEBHOOK_SECRET_TOKEN"
    | "TELEGRAM_WEBHOOK_URL"
>;

export type TelegramBotWebhook =
    | { botId: string; status: "refreshed"; webhookUrl: string; botUrl: string }
    | { botId: string; status: "failed"; error: string };

const telegramWebhookClaimTtlMilliseconds = 60 * 60 * 1000;
const telegramBotUsernameCacheTtlMilliseconds = 5 * 60 * 1000;

export function resolveTelegramWebhookUrl(
    config: Pick<Env, "DOMAIN" | "RESOURCE_NAME" | "TELEGRAM_WEBHOOK_URL">,
    botId: string,
): string {
    const baseUrl = config.TELEGRAM_WEBHOOK_URL;

    if (baseUrl) {
        return `${baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl}/${botId}`;
    }

    return new URL(
        `/api/telegram/webhook/${config.RESOURCE_NAME}/${botId}`,
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

    async setWebhooksOnStart(): Promise<void> {
        if (this.config.ENVIRONMENT === "preview") {
            this.log.info(
                "Telegram webhooks are not set on preview start, claim them with POST /api/telegram/webhook/refresh",
            );
            return;
        }

        for (const bot of this.telegramBots.list()) {
            try {
                await this.setWebhookOnStart(bot);
            } catch (err) {
                this.log.error(
                    { err, botId: bot.id },
                    "Failed to set the webhook of a bot on start",
                );
            }
        }
    }

    async setWebhook(bot: TelegramBot): Promise<string> {
        const url = resolveTelegramWebhookUrl(this.config, bot.id);
        const result = await bot.api.setWebhook({
            url,
            secret_token: telegramWebhookSecret(
                this.config.TELEGRAM_WEBHOOK_SECRET_TOKEN,
                bot.id,
            ),
        });

        if (!result.ok) {
            throw new TelegramApiError("setWebhook", result);
        }

        this.log.info(
            { botId: bot.id, url },
            "Telegram webhook set successfully",
        );

        return url;
    }

    async deleteWebhook(bot: TelegramBot): Promise<void> {
        const result = await bot.api.deleteWebhook();

        if (!result.ok) {
            throw new TelegramApiError("deleteWebhook", result);
        }

        this.log.info({ botId: bot.id }, "Telegram webhook deleted");
    }

    async readWebhook(bot: TelegramBot): Promise<WebhookInfo> {
        const result = await bot.api.getWebhookInfo();

        if (!result.ok) {
            throw new TelegramApiError("getWebhookInfo", result);
        }

        return result.result;
    }

    async refreshWebhooks(): Promise<TelegramBotWebhook[]> {
        const webhooks: TelegramBotWebhook[] = [];

        for (const bot of this.telegramBots.list()) {
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

    async resolveBotUrl(botId: string): Promise<string> {
        return `https://t.me/${await this.resolveUsername(this.telegramBots.get(botId))}`;
    }

    async resolveDeepLinkUrl(
        botId: string,
        link: TelegramDeepLink,
    ): Promise<string> {
        return buildTelegramDeepLinkUrl(
            await this.resolveUsername(this.telegramBots.get(botId)),
            link,
        );
    }

    private async setWebhookOnStart(bot: TelegramBot): Promise<void> {
        const claim = await this.lockService.tryAcquire(
            `telegram:${bot.id}:webhook:set`,
            telegramWebhookClaimTtlMilliseconds,
        );

        if (!claim) {
            this.log.info({ botId: bot.id }, "Telegram webhook setup skipped");
            return;
        }

        try {
            await this.setWebhook(bot);
        } catch (err) {
            await this.lockService.release(claim);
            throw err;
        }
    }

    private async refreshWebhook(
        bot: TelegramBot,
    ): Promise<TelegramBotWebhook> {
        const botUrl = await this.resolveBotUrl(bot.id);
        const webhookUrl = await this.setWebhook(bot);

        await this.telegramCommandMenus.refresh(bot);

        return { botId: bot.id, status: "refreshed", webhookUrl, botUrl };
    }

    private resolveUsername(bot: TelegramBot): Promise<string> {
        return this.cache.remember(
            `telegram:${bot.id}:username`,
            Type.String(),
            telegramBotUsernameCacheTtlMilliseconds,
            () => this.fetchUsername(bot),
        );
    }

    private async fetchUsername(bot: TelegramBot): Promise<string> {
        const result = await bot.api.getMe();

        if (!result.ok) {
            throw new TelegramApiError("getMe", result);
        }

        return result.result.username;
    }
}

export default fp(
    async function (fastify: FastifyInstance) {
        const appLogger = fastify.getDecorator<AppLogger>("appLogger");
        const i18nService = fastify.getDecorator<I18nService>("i18nService");
        const telegramBotService = new TelegramBotService(
            appLogger.child({ module: "telegram" }),
            fastify.getDecorator<TelegramBots>("telegramBots"),
            fastify.getDecorator<TelegramCommandMenus>("telegramCommandMenus"),
            fastify.getDecorator<CacheService>("cache"),
            fastify.getDecorator<LockService>("lockService"),
            fastify.getDecorator<Env>("config"),
        );

        i18nService.addLocales("telegram", telegramLocales);

        fastify.decorate("telegramBotService", telegramBotService);

        fastify.addHook("onListen", async () => {
            await telegramBotService.setWebhooksOnStart();
        });
    },
    {
        name: "telegram-bot-service",
        dependencies: [
            "@fastify/env",
            "app-logger",
            "cache",
            "i18n-service",
            "lock-service",
            "telegram-bots",
            "telegram-command-menus",
        ],
    },
);
