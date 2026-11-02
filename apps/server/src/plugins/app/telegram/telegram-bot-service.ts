import { BotCommand } from "@grammyjs/types";
import { Type } from "@sinclair/typebox";
import Emittery from "emittery";
import { FastifyBaseLogger, FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { createHash, randomUUID } from "node:crypto";
import { Env } from "../../../env.js";
import { AppLogger } from "../app-logger.js";
import { CacheService } from "../cache-service.js";
import {
    defaultLanguage,
    I18nService,
    languages,
    Translate,
} from "../i18n-service.js";
import { LockService } from "../lock-service.js";
import { UserEntity } from "../users/user-entity.js";
import { UsersEvents } from "../users/users-events.js";
import { TelegramMethodArgs } from "./telegram-api-service.js";
import { TelegramBot, TelegramBots } from "./telegram-bots.js";
import {
    buildTelegramDeepLink,
    TelegramDeepLink,
} from "./telegram-deep-links.js";
import { TelegramApiError } from "./telegram-errors.js";
import { isAllowed } from "./telegram-guard.js";
import { telegramLocales } from "./telegram-locales.js";
import { TelegramMetrics } from "./telegram-metrics.js";
import { TelegramCommandInfo, TelegramRouter } from "./telegram-router.js";
import { telegramWebhookSecret } from "./telegram-webhook-secret.js";

type TelegramBotConfig = Pick<
    Env,
    | "DOMAIN"
    | "ENVIRONMENT"
    | "RESOURCE_NAME"
    | "TELEGRAM_WEBHOOK_SECRET_TOKEN"
    | "TELEGRAM_WEBHOOK_URL"
>;

export interface TelegramBotWebhook {
    botId: string;
    webhookUrl: string;
    botUrl: string;
}

const telegramWebhookClaimTtlMilliseconds = 60 * 60 * 1000;
const telegramBotUsernameCacheTtlMilliseconds = 5 * 60 * 1000;
const telegramChatCommandsCacheTtlMilliseconds = 24 * 60 * 60 * 1000;
const telegramCommandsGenerationTtlMilliseconds = 30 * 24 * 60 * 60 * 1000;

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
    private readonly telegramRouter: TelegramRouter;
    private readonly cache: CacheService;
    private readonly lockService: LockService;
    private readonly i18nService: I18nService;
    private readonly telegramMetrics: TelegramMetrics;
    private readonly config: TelegramBotConfig;

    constructor(
        log: FastifyBaseLogger,
        telegramBots: TelegramBots,
        telegramRouter: TelegramRouter,
        cache: CacheService,
        lockService: LockService,
        i18nService: I18nService,
        telegramMetrics: TelegramMetrics,
        config: TelegramBotConfig,
    ) {
        this.log = log;
        this.telegramBots = telegramBots;
        this.telegramRouter = telegramRouter;
        this.cache = cache;
        this.lockService = lockService;
        this.i18nService = i18nService;
        this.telegramMetrics = telegramMetrics;
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
            await this.setWebhookOnStart(bot);
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

    async refreshWebhooks(): Promise<TelegramBotWebhook[]> {
        const webhooks: TelegramBotWebhook[] = [];

        for (const bot of this.telegramBots.list()) {
            webhooks.push(await this.refreshWebhook(bot));
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
        const payload = buildTelegramDeepLink(link);

        return `${await this.resolveBotUrl(botId)}?start=${payload}`;
    }

    async setCommandsOnStart(): Promise<void> {
        if (this.config.ENVIRONMENT === "preview") {
            return;
        }

        for (const bot of this.telegramBots.list()) {
            await this.setDefaultCommands(bot);
        }
    }

    async syncCommands(user: UserEntity): Promise<void> {
        if (user.isBanned) {
            return;
        }

        const bot = this.telegramBots.get(user.botId);
        const commands = describeCommands(
            this.telegramRouter
                .listCommands()
                .filter(({ guard }) => isAllowed(guard, user)),
            this.i18nService.getT(user.languageCode),
        );
        const key = `telegram:${bot.id}:commands:${user.telegramId}`;

        try {
            const generation = await this.cache.get(
                commandsGenerationKeyOf(bot),
                Type.String(),
            );
            const hash = createHash("sha256")
                .update(JSON.stringify({ generation, commands }))
                .digest("base64url");

            if ((await this.cache.get(key, Type.String())) === hash) {
                this.telegramMetrics.recordCommandMenuSync("unchanged");
                return;
            }

            await this.setCommands(bot, {
                commands,
                scope: { type: "chat", chat_id: Number(user.telegramId) },
            });
            await this.cache.set(key, hash, {
                ttlMilliseconds: telegramChatCommandsCacheTtlMilliseconds,
            });
            this.telegramMetrics.recordCommandMenuSync("set");

            this.log.info(
                {
                    botId: bot.id,
                    userId: user._id,
                    commands: commands.map(({ command }) => command),
                },
                "Telegram chat commands set successfully",
            );
        } catch (err) {
            this.telegramMetrics.recordCommandMenuSync("failed");
            this.log.error(
                { err, botId: bot.id, userId: user._id },
                "Failed to set telegram chat commands",
            );
        }
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

        await this.setDefaultCommands(bot);
        await this.cache.set(commandsGenerationKeyOf(bot), randomUUID(), {
            ttlMilliseconds: telegramCommandsGenerationTtlMilliseconds,
        });

        return { botId: bot.id, webhookUrl, botUrl };
    }

    private async setDefaultCommands(bot: TelegramBot): Promise<void> {
        const commands = this.telegramRouter
            .listCommands()
            .filter(({ guard }) => !guard);

        for (const languageCode of [undefined, ...languages]) {
            await this.setCommands(bot, {
                commands: describeCommands(
                    commands,
                    this.i18nService.getT(languageCode ?? defaultLanguage),
                ),
                ...(languageCode ? { language_code: languageCode } : {}),
            });
        }

        this.log.info(
            { botId: bot.id, commands: commands.map(({ name }) => name) },
            "Telegram commands set successfully",
        );
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

    private async setCommands(
        bot: TelegramBot,
        ...args: TelegramMethodArgs<"setMyCommands">
    ): Promise<void> {
        const result = await bot.api.setMyCommands(...args);

        if (!result.ok) {
            throw new TelegramApiError("setMyCommands", result);
        }
    }
}

function commandsGenerationKeyOf(bot: TelegramBot): string {
    return `telegram:${bot.id}:commands:generation`;
}

function describeCommands(
    commands: TelegramCommandInfo[],
    t: Translate,
): BotCommand[] {
    return commands.map(({ name, description }) => ({
        command: name,
        description: description(t),
    }));
}

export default fp(
    async function (fastify: FastifyInstance) {
        const appLogger = fastify.getDecorator<AppLogger>("appLogger");
        const i18nService = fastify.getDecorator<I18nService>("i18nService");
        const telegramBotService = new TelegramBotService(
            appLogger.child({ module: "telegram" }),
            fastify.getDecorator<TelegramBots>("telegramBots"),
            fastify.getDecorator<TelegramRouter>("telegramRouter"),
            fastify.getDecorator<CacheService>("cache"),
            fastify.getDecorator<LockService>("lockService"),
            i18nService,
            fastify.getDecorator<TelegramMetrics>("telegramMetrics"),
            fastify.getDecorator<Env>("config"),
        );

        i18nService.addLocales("telegram", telegramLocales);

        fastify.decorate("telegramBotService", telegramBotService);

        fastify
            .getDecorator<Emittery<UsersEvents>>("eventEmitter")
            .on("users.accessChanged", ({ data }) =>
                telegramBotService.syncCommands(data.user),
            );

        fastify.addHook("onListen", async () => {
            await telegramBotService.setWebhooksOnStart();
            await telegramBotService.setCommandsOnStart();
        });
    },
    {
        name: "telegram-bot-service",
        dependencies: [
            "@fastify/env",
            "app-logger",
            "cache",
            "emittery",
            "i18n-service",
            "lock-service",
            "telegram-bots",
            "telegram-metrics",
            "telegram-router",
        ],
    },
);
