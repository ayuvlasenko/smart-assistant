import { RateLimitBucket } from "../rate-limiter.js";
import {
    type TelegramApiPriority,
    type TelegramMethod,
} from "./telegram-api-service.js";

interface TelegramRateLimit {
    ratePerSecond: number;
    burst: number;
    shares?: Record<TelegramApiPriority, number>;
    scopeOf: (params: unknown) => string | undefined;
}

const chatMessages: TelegramRateLimit = {
    ratePerSecond: 1,
    burst: 3,
    scopeOf: (params) => {
        const chatId = chatIdOf(params);

        return chatId === undefined ? undefined : `chat:${chatId}`;
    },
};

const chatDeletes: TelegramRateLimit = {
    ratePerSecond: 30,
    burst: 30,
    scopeOf: (params) => {
        const chatId = chatIdOf(params);

        return chatId === undefined ? undefined : `chat:${chatId}:deletes`;
    },
};

const botMessages: TelegramRateLimit = {
    ratePerSecond: 25,
    burst: 5,
    shares: { interactive: 0.8, background: 0.2 },
    scopeOf: () => "global",
};

const botCommands: TelegramRateLimit = {
    ratePerSecond: 5,
    burst: 5,
    scopeOf: () => "commands",
};

const telegramRateLimits: Partial<Record<TelegramMethod, TelegramRateLimit[]>> =
    {
        sendMessage: [chatMessages, botMessages],
        sendRichMessage: [chatMessages, botMessages],
        sendPhoto: [chatMessages, botMessages],
        sendVideo: [chatMessages, botMessages],
        sendDocument: [chatMessages, botMessages],
        sendAnimation: [chatMessages, botMessages],
        sendAudio: [chatMessages, botMessages],
        editMessageText: [chatMessages, botMessages],
        editMessageMedia: [chatMessages, botMessages],
        editMessageReplyMarkup: [chatMessages, botMessages],
        deleteMessage: [chatDeletes],
        deleteMessages: [chatDeletes],
        setMyCommands: [botCommands],
    };

export function telegramRateLimitBuckets(
    botId: string,
    method: TelegramMethod,
    params: unknown,
): RateLimitBucket[] {
    return (telegramRateLimits[method] ?? []).flatMap(
        ({ scopeOf, ...limit }) => {
            const scope = scopeOf(params);

            return scope === undefined
                ? []
                : [{ key: `rate-limit:telegram:${botId}:${scope}`, ...limit }];
        },
    );
}

function chatIdOf(params: unknown): number | string | undefined {
    if (
        typeof params !== "object" ||
        params === null ||
        !("chat_id" in params)
    ) {
        return;
    }

    const chatId = params.chat_id;

    return typeof chatId === "number" || typeof chatId === "string"
        ? chatId
        : undefined;
}
