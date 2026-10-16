import { ApiMethods, ApiResponse } from "@grammyjs/types";
import {
    FastifyBaseLogger,
    FastifyInstance,
    FastifyPluginOptions,
} from "fastify";
import fp from "fastify-plugin";
import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { Env } from "../../../env.js";
import { AppLogger } from "../app-logger.js";
import { RateLimitBucket, RateLimiter } from "../rate-limiter.js";
import { TelegramMetrics } from "./telegram-metrics.js";
import { telegramRateLimitBuckets } from "./telegram-rate-limits.js";

export type TelegramMethod = keyof ApiMethods<never>;
export type TelegramMethodArgs<
    TMethod extends TelegramMethod,
    TUpload = never,
> = Parameters<ApiMethods<TUpload>[TMethod]>;
export type TelegramMethodResult<TMethod extends TelegramMethod> = ReturnType<
    ApiMethods<never>[TMethod]
>;
export type TelegramApiClient = Pick<
    TelegramApiService,
    | "getMe"
    | "setWebhook"
    | "sendMessage"
    | "answerCallbackQuery"
    | "setMyCommands"
    | "editMessageReplyMarkup"
    | "deleteMessages"
    | "sendRichMessage"
    | "sendPhoto"
    | "sendVideo"
    | "sendDocument"
    | "sendAnimation"
    | "sendAudio"
    | "editMessageText"
    | "editMessageMedia"
    | "deleteMessage"
>;

export interface TelegramApiPluginOptions extends FastifyPluginOptions {
    telegramApiService?: TelegramApiClient;
}

export type TelegramApiPriority = "interactive" | "background";

export interface TelegramApiScope {
    signal: AbortSignal;
    priority: TelegramApiPriority;
}

export const telegramApiScope = new AsyncLocalStorage<TelegramApiScope>();

const defaultRequestTimeoutMilliseconds = 10_000;
const unscopedCallTimeoutMilliseconds = 60_000;
const defaultRetryAfterSeconds = 1;

export class TelegramApiService {
    private readonly baseUrl: string;
    private readonly botId: string;
    private readonly log: FastifyBaseLogger;
    private readonly telegramMetrics: TelegramMetrics;
    private readonly rateLimiter: RateLimiter;
    private readonly requestTimeoutMilliseconds: number;

    constructor(
        botToken: string,
        log: FastifyBaseLogger,
        telegramMetrics: TelegramMetrics,
        rateLimiter: RateLimiter,
        requestTimeoutMilliseconds = defaultRequestTimeoutMilliseconds,
    ) {
        this.log = log;
        this.telegramMetrics = telegramMetrics;
        this.rateLimiter = rateLimiter;
        this.requestTimeoutMilliseconds = requestTimeoutMilliseconds;
        this.baseUrl = `https://api.telegram.org/bot${botToken}`;
        this.botId = botToken.split(":", 1).join("");
    }

    getMe() {
        return this.call("getMe");
    }

    setWebhook(...args: TelegramMethodArgs<"setWebhook">) {
        return this.call("setWebhook", ...args);
    }

    sendMessage(...args: TelegramMethodArgs<"sendMessage">) {
        return this.call("sendMessage", ...args);
    }

    answerCallbackQuery(...args: TelegramMethodArgs<"answerCallbackQuery">) {
        return this.call("answerCallbackQuery", ...args);
    }

    setMyCommands(...args: TelegramMethodArgs<"setMyCommands">) {
        return this.call("setMyCommands", ...args);
    }

    editMessageReplyMarkup(
        ...args: TelegramMethodArgs<"editMessageReplyMarkup">
    ) {
        return this.call("editMessageReplyMarkup", ...args);
    }

    deleteMessages(...args: TelegramMethodArgs<"deleteMessages">) {
        return this.call("deleteMessages", ...args);
    }

    sendRichMessage(...args: TelegramMethodArgs<"sendRichMessage">) {
        return this.call("sendRichMessage", ...args);
    }

    sendPhoto(...args: TelegramMethodArgs<"sendPhoto">) {
        return this.call("sendPhoto", ...args);
    }

    sendVideo(...args: TelegramMethodArgs<"sendVideo">) {
        return this.call("sendVideo", ...args);
    }

    sendDocument(...args: TelegramMethodArgs<"sendDocument">) {
        return this.call("sendDocument", ...args);
    }

    sendAnimation(...args: TelegramMethodArgs<"sendAnimation">) {
        return this.call("sendAnimation", ...args);
    }

    sendAudio(...args: TelegramMethodArgs<"sendAudio">) {
        return this.call("sendAudio", ...args);
    }

    editMessageText(...args: TelegramMethodArgs<"editMessageText">) {
        return this.call("editMessageText", ...args);
    }

    editMessageMedia(...args: TelegramMethodArgs<"editMessageMedia">) {
        return this.call("editMessageMedia", ...args);
    }

    deleteMessage(...args: TelegramMethodArgs<"deleteMessage">) {
        return this.call("deleteMessage", ...args);
    }

    private async call<
        TFile = never,
        TMethod extends TelegramMethod = TelegramMethod,
    >(
        method: TMethod,
        ...args: TelegramMethodArgs<TMethod, TFile>
    ): Promise<ApiResponse<TelegramMethodResult<TMethod>>> {
        const [params] = args;
        const scope = telegramApiScope.getStore() ?? {
            signal: AbortSignal.timeout(unscopedCallTimeoutMilliseconds),
            priority: "interactive",
        };
        const buckets = telegramRateLimitBuckets(this.botId, method, params);

        for (;;) {
            await this.waitForSlot(method, buckets, scope);

            const result = await this.send<TMethod>(
                method,
                params,
                scope.signal,
            );

            if (result.ok || result.error_code !== 429) {
                return result;
            }

            await this.pause(
                method,
                buckets,
                result.parameters?.retry_after ?? defaultRetryAfterSeconds,
                scope.signal,
            );
        }
    }

    private async waitForSlot(
        method: TelegramMethod,
        buckets: RateLimitBucket[],
        { signal, priority }: TelegramApiScope,
    ): Promise<void> {
        let waitMilliseconds = 0;

        for (const bucket of buckets) {
            waitMilliseconds += await this.rateLimiter.acquire(bucket, {
                className: priority,
                signal,
            });
        }

        if (buckets.length > 0) {
            this.telegramMetrics.recordRateLimitWait(
                method,
                priority,
                waitMilliseconds / 1000,
            );
        }
    }

    private async send<TMethod extends TelegramMethod>(
        method: TMethod,
        params: unknown,
        signal: AbortSignal,
    ): Promise<ApiResponse<TelegramMethodResult<TMethod>>> {
        const stopRequest = this.telegramMetrics.startApiRequest(method);
        let result: ApiResponse<TelegramMethodResult<TMethod>>;

        try {
            const response = await fetch(`${this.baseUrl}/${method}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal: AbortSignal.any([
                    signal,
                    AbortSignal.timeout(this.requestTimeoutMilliseconds),
                ]),
                body: params === undefined ? undefined : JSON.stringify(params),
            });

            result = (await response.json()) as ApiResponse<
                TelegramMethodResult<TMethod>
            >;
        } catch (err) {
            stopRequest(signal.aborted ? "aborted" : "network_error");
            throw err;
        }

        if (result.ok) {
            stopRequest("ok");
            return result;
        }

        stopRequest(result.error_code === 429 ? "rate_limited" : "error");
        this.log.warn(
            {
                method,
                errorCode: result.error_code,
                description: result.description,
                retryAfter: result.parameters?.retry_after,
            },
            "Telegram API request failed",
        );

        return result;
    }

    private async pause(
        method: TelegramMethod,
        buckets: RateLimitBucket[],
        retryAfterSeconds: number,
        signal: AbortSignal,
    ): Promise<void> {
        const [narrowestBucket] = buckets;
        const delayMilliseconds = retryAfterSeconds * 1000;

        this.telegramMetrics.recordRetryAfter(method, retryAfterSeconds);

        if (narrowestBucket) {
            await this.rateLimiter.pause(narrowestBucket, delayMilliseconds);
            return;
        }

        try {
            await delay(delayMilliseconds, undefined, { signal });
        } catch (err) {
            signal.throwIfAborted();
            throw err;
        }
    }
}

export default fp(
    async function (fastify: FastifyInstance, opts: TelegramApiPluginOptions) {
        const appLogger = fastify.getDecorator<AppLogger>("appLogger");

        fastify.decorate(
            "telegramApiService",
            opts.telegramApiService ??
                new TelegramApiService(
                    fastify.getDecorator<Env>("config").TELEGRAM_BOT_TOKEN,
                    appLogger.child({ module: "telegram-api" }),
                    fastify.getDecorator<TelegramMetrics>("telegramMetrics"),
                    fastify.getDecorator<RateLimiter>("rateLimiter"),
                ),
        );
    },
    {
        name: "telegram-api-service",
        dependencies: [
            "@fastify/env",
            "app-logger",
            "rate-limiter",
            "telegram-metrics",
        ],
    },
);
