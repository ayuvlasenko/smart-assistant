import { ApiMethods, ApiResponse } from "@grammyjs/types";
import { FastifyBaseLogger } from "fastify";
import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";
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
    keyof TelegramApiService
>;

export type TelegramApiPriority = "interactive" | "background";

export interface TelegramApiScope {
    signal: AbortSignal;
    priority: TelegramApiPriority;
}

export const telegramApiScope = new AsyncLocalStorage<TelegramApiScope>();

const defaultRequestTimeoutMilliseconds = 10_000;
const unscopedCallTimeoutMilliseconds = 60_000;
const defaultRetryAfterSeconds = 1;
const slowWaitMilliseconds = 1_000;
const networkErrorRetryDelaysMilliseconds = [200, 1_000];

export class TelegramApiService {
    private readonly baseUrl: string;
    private readonly telegramId: string;
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
        this.telegramId = botToken.split(":", 1).join("");
    }

    getMe() {
        return this.call("getMe");
    }

    setWebhook(...args: TelegramMethodArgs<"setWebhook">) {
        return this.call("setWebhook", ...args);
    }

    deleteWebhook(...args: TelegramMethodArgs<"deleteWebhook">) {
        return this.call("deleteWebhook", ...args);
    }

    getWebhookInfo() {
        return this.call("getWebhookInfo");
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

    deleteMyCommands(...args: TelegramMethodArgs<"deleteMyCommands">) {
        return this.call("deleteMyCommands", ...args);
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

    private async call<TMethod extends TelegramMethod>(
        method: TMethod,
        ...args: TelegramMethodArgs<TMethod>
    ): Promise<ApiResponse<TelegramMethodResult<TMethod>>> {
        const [params] = args;
        const scope = telegramApiScope.getStore() ?? {
            signal: AbortSignal.timeout(unscopedCallTimeoutMilliseconds),
            priority: "interactive",
        };
        const buckets = telegramRateLimitBuckets(
            this.telegramId,
            method,
            params,
        );

        let networkErrors = 0;

        for (;;) {
            await this.waitForSlot(method, buckets, scope);

            let result: ApiResponse<TelegramMethodResult<TMethod>>;

            try {
                result = await this.send<TMethod>(method, params, scope.signal);
            } catch (err) {
                const retryDelayMilliseconds =
                    networkErrorRetryDelaysMilliseconds[networkErrors];

                if (
                    retryDelayMilliseconds === undefined ||
                    !isNetworkError(err, scope.signal)
                ) {
                    throw err;
                }

                networkErrors += 1;
                await sleep(retryDelayMilliseconds, scope.signal);
                continue;
            }

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

        if (
            priority === "interactive" &&
            waitMilliseconds >= slowWaitMilliseconds
        ) {
            this.log.warn(
                { method, waitSeconds: waitMilliseconds / 1000 },
                "Telegram rate limit wait was slow",
            );
        }
    }

    private async send<TMethod extends TelegramMethod>(
        method: TMethod,
        params: unknown,
        signal: AbortSignal,
    ): Promise<ApiResponse<TelegramMethodResult<TMethod>>> {
        const stopRequest = this.telegramMetrics.startApiRequest(
            this.telegramId,
            method,
        );
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
            const failure = signal.aborted ? "aborted" : "network_error";

            stopRequest(failure);
            this.log.warn(
                { method, result: failure, err },
                "Telegram API request got no answer",
            );
            throw err;
        }

        if (result.ok) {
            stopRequest("ok");
            return result;
        }

        stopRequest(
            result.error_code === 429 ? "rate_limited" : "error",
            result.error_code,
        );
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
        const delayMilliseconds = retryAfterSeconds * 1000;

        this.telegramMetrics.recordRetryAfter(method, retryAfterSeconds);

        if (buckets.length > 0) {
            this.log.warn(
                {
                    method,
                    retryAfter: retryAfterSeconds,
                    buckets: buckets.map(({ key }) => key),
                },
                "Telegram rate limit buckets paused",
            );
            await Promise.all(
                buckets.map((bucket) =>
                    this.rateLimiter.pause(bucket, delayMilliseconds),
                ),
            );
            return;
        }

        await sleep(delayMilliseconds, signal);
    }
}

function isNetworkError(err: unknown, signal: AbortSignal): boolean {
    return (
        !signal.aborted &&
        !(err instanceof DOMException && err.name === "TimeoutError")
    );
}

async function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
    try {
        await delay(milliseconds, undefined, { signal });
    } catch (err) {
        signal.throwIfAborted();
        throw err;
    }
}
