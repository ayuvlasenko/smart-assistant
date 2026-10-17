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
import {
    TelegramApiClient,
    TelegramMethodArgs,
} from "./telegram-api-service.js";
import {
    buildTelegramDeepLink,
    TelegramDeepLink,
} from "./telegram-deep-links.js";
import { TelegramApiError } from "./telegram-errors.js";
import { isAllowed } from "./telegram-guard.js";
import { telegramLocales } from "./telegram-locales.js";
import { TelegramCommandInfo, TelegramRouter } from "./telegram-router.js";

type TelegramBotConfig = Pick<
    Env,
    | "DOMAIN"
    | "ENVIRONMENT"
    | "RESOURCE_NAME"
    | "TELEGRAM_WEBHOOK_SECRET_TOKEN"
    | "TELEGRAM_WEBHOOK_URL"
>;

const telegramWebhookClaimKey = "telegram:webhook:set";
const telegramWebhookClaimTtlMilliseconds = 60 * 60 * 1000;
const telegramBotUsernameCacheKey = "telegram:bot:username";
const telegramBotUsernameCacheTtlMilliseconds = 5 * 60 * 1000;
const telegramChatCommandsCacheTtlMilliseconds = 24 * 60 * 60 * 1000;
const telegramCommandsGenerationKey = "telegram:commands:generation";
const telegramCommandsGenerationTtlMilliseconds = 30 * 24 * 60 * 60 * 1000;

export function resolveTelegramWebhookUrl(
    config: Pick<Env, "DOMAIN" | "RESOURCE_NAME" | "TELEGRAM_WEBHOOK_URL">,
): string {
    if (config.TELEGRAM_WEBHOOK_URL) {
        return config.TELEGRAM_WEBHOOK_URL;
    }

    return new URL(
        `/api/telegram/webhook/${config.RESOURCE_NAME}`,
        config.DOMAIN,
    ).toString();
}

export class TelegramBotService {
    private readonly log: FastifyBaseLogger;
    private readonly telegramApiService: TelegramApiClient;
    private readonly telegramRouter: TelegramRouter;
    private readonly cache: CacheService;
    private readonly lockService: LockService;
    private readonly i18nService: I18nService;
    private readonly config: TelegramBotConfig;

    constructor(
        log: FastifyBaseLogger,
        telegramApiService: TelegramApiClient,
        telegramRouter: TelegramRouter,
        cache: CacheService,
        lockService: LockService,
        i18nService: I18nService,
        config: TelegramBotConfig,
    ) {
        this.log = log;
        this.telegramApiService = telegramApiService;
        this.telegramRouter = telegramRouter;
        this.cache = cache;
        this.lockService = lockService;
        this.i18nService = i18nService;
        this.config = config;
    }

    async setWebhookOnStart(): Promise<void> {
        if (this.config.ENVIRONMENT === "preview") {
            this.log.info(
                "Telegram webhook is not set on preview start, claim it with POST /api/telegram/webhook/refresh",
            );
            return;
        }

        const claim = await this.lockService.tryAcquire(
            telegramWebhookClaimKey,
            telegramWebhookClaimTtlMilliseconds,
        );

        if (!claim) {
            this.log.info("Telegram webhook setup skipped");
            return;
        }

        try {
            await this.setWebhook();
        } catch (err) {
            await this.lockService.release(claim);
            throw err;
        }
    }

    async setWebhook(): Promise<string> {
        const url = resolveTelegramWebhookUrl(this.config);
        const result = await this.telegramApiService.setWebhook({
            url,
            secret_token: this.config.TELEGRAM_WEBHOOK_SECRET_TOKEN,
        });

        if (!result.ok) {
            throw new TelegramApiError("setWebhook", result);
        }

        this.log.info({ url }, "Telegram webhook set successfully");

        return url;
    }

    async refreshWebhook(): Promise<string> {
        const url = await this.setWebhook();

        await this.setDefaultCommands();
        await this.cache.set(telegramCommandsGenerationKey, randomUUID(), {
            ttlMilliseconds: telegramCommandsGenerationTtlMilliseconds,
        });

        return url;
    }

    async resolveBotUrl(): Promise<string> {
        return `https://t.me/${await this.resolveUsername()}`;
    }

    async resolveDeepLinkUrl(link: TelegramDeepLink): Promise<string> {
        const payload = buildTelegramDeepLink(link);

        return `${await this.resolveBotUrl()}?start=${payload}`;
    }

    async setCommandsOnStart(): Promise<void> {
        if (this.config.ENVIRONMENT === "preview") {
            return;
        }

        await this.setDefaultCommands();
    }

    async syncCommands(user: UserEntity): Promise<void> {
        if (user.isBanned) {
            return;
        }

        const commands = describeCommands(
            this.telegramRouter
                .listCommands()
                .filter(({ guard }) => isAllowed(guard, user)),
            this.i18nService.getT(user.languageCode),
        );
        const key = `telegram:commands:${user.telegramId}`;

        try {
            const generation = await this.cache.get(
                telegramCommandsGenerationKey,
                Type.String(),
            );
            const hash = createHash("sha256")
                .update(JSON.stringify({ generation, commands }))
                .digest("base64url");

            if ((await this.cache.get(key, Type.String())) === hash) {
                return;
            }

            await this.setCommands({
                commands,
                scope: { type: "chat", chat_id: Number(user.telegramId) },
            });
            await this.cache.set(key, hash, {
                ttlMilliseconds: telegramChatCommandsCacheTtlMilliseconds,
            });

            this.log.info(
                {
                    userId: user._id,
                    commands: commands.map(({ command }) => command),
                },
                "Telegram chat commands set successfully",
            );
        } catch (err) {
            this.log.error(
                { err, userId: user._id },
                "Failed to set telegram chat commands",
            );
        }
    }

    private async setDefaultCommands(): Promise<void> {
        const commands = this.telegramRouter
            .listCommands()
            .filter(({ guard }) => !guard);

        for (const languageCode of [undefined, ...languages]) {
            await this.setCommands({
                commands: describeCommands(
                    commands,
                    this.i18nService.getT(languageCode ?? defaultLanguage),
                ),
                ...(languageCode ? { language_code: languageCode } : {}),
            });
        }

        this.log.info(
            { commands: commands.map(({ name }) => name) },
            "Telegram commands set successfully",
        );
    }

    private resolveUsername(): Promise<string> {
        return this.cache.remember(
            telegramBotUsernameCacheKey,
            Type.String(),
            telegramBotUsernameCacheTtlMilliseconds,
            () => this.fetchUsername(),
        );
    }

    private async fetchUsername(): Promise<string> {
        const result = await this.telegramApiService.getMe();

        if (!result.ok) {
            throw new TelegramApiError("getMe", result);
        }

        return result.result.username;
    }

    private async setCommands(
        ...args: TelegramMethodArgs<"setMyCommands">
    ): Promise<void> {
        const result = await this.telegramApiService.setMyCommands(...args);

        if (!result.ok) {
            throw new TelegramApiError("setMyCommands", result);
        }
    }
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
            fastify.getDecorator<TelegramApiClient>("telegramApiService"),
            fastify.getDecorator<TelegramRouter>("telegramRouter"),
            fastify.getDecorator<CacheService>("cache"),
            fastify.getDecorator<LockService>("lockService"),
            i18nService,
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
            await telegramBotService.setWebhookOnStart();
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
            "telegram-api-service",
            "telegram-router",
        ],
    },
);
