import { Update } from "@grammyjs/types";
import { FastifyBaseLogger } from "fastify";
import { Env } from "../../../schemas/env.js";
import { CacheService } from "../cache.js";
import { UsersRepository } from "../users-repository.js";
import { TelegramApiClient } from "./telegram-api-service.js";
import { createTelegramContext } from "./telegram-context.js";
import { extractTelegramUser } from "./telegram-extractors.js";
import { message } from "./telegram-filters.js";

type TelegramWebhookConfig = Pick<
    Env,
    | "DOMAIN"
    | "RESOURCE_NAME"
    | "TELEGRAM_WEBHOOK_SECRET_TOKEN"
    | "TELEGRAM_WEBHOOK_URL"
>;

const telegramWebhookCacheKey = "telegram:webhook:set";
const telegramWebhookCacheTtlSeconds = 60 * 60;

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
    constructor(
        private readonly log: FastifyBaseLogger,
        private readonly telegramApiService: TelegramApiClient,
        private readonly usersRepository: UsersRepository,
        private readonly cache: CacheService,
        private readonly config: TelegramWebhookConfig,
    ) {}

    async setWebhook(): Promise<void> {
        const shouldSetWebhook = await this.cache.setJsonIfMissing(
            telegramWebhookCacheKey,
            true,
            telegramWebhookCacheTtlSeconds,
        );

        if (!shouldSetWebhook) {
            this.log.info("Telegram webhook setup skipped");
            return;
        }

        try {
            const result = await this.telegramApiService.setWebhook({
                url: resolveTelegramWebhookUrl(this.config),
                secret_token: this.config.TELEGRAM_WEBHOOK_SECRET_TOKEN,
            });

            if (!result.ok) {
                throw new Error(
                    `Failed to set telegram webhook: ${result.description}`,
                );
            }

            this.log.info("Telegram webhook set successfully");
        } catch (err) {
            await this.cache.delete(telegramWebhookCacheKey);
            throw err;
        }
    }

    async handleUpdate(update: Update): Promise<void> {
        this.log.info(update, "Received update");

        const context = createTelegramContext(update);
        const telegramUser = extractTelegramUser(update);

        if (!telegramUser) {
            this.log.warn("No user in update, skipping");
            return;
        }

        const user = await this.usersRepository.findOneByTelegramIdOrCreate({
            telegramId: String(telegramUser.id),
            isBanned: true,
        });

        this.log.info({ user }, "User for update");

        if (user.isBanned) {
            this.log.info("User is banned, skipping update");
            return;
        }

        if (
            context.has(message("text")) &&
            context.update.message.text === "ping"
        ) {
            await this.telegramApiService.sendMessage({
                chat_id: context.update.message.chat.id,
                text: "pong",
            });
        }
    }
}
