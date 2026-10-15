import { ApiMethods, ApiResponse } from "@grammyjs/types";
import {
    FastifyBaseLogger,
    FastifyInstance,
    FastifyPluginOptions,
} from "fastify";
import fp from "fastify-plugin";
import { AppLogger } from "../app-logger.js";
import { TelegramMetrics } from "./telegram-metrics.js";

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

const defaultRequestTimeoutMilliseconds = 10_000;

export class TelegramApiService {
    private readonly baseUrl: string;
    private readonly log: FastifyBaseLogger;
    private readonly telegramMetrics: TelegramMetrics;
    private readonly requestTimeoutMilliseconds: number;

    constructor(
        botToken: string,
        log: FastifyBaseLogger,
        telegramMetrics: TelegramMetrics,
        requestTimeoutMilliseconds = defaultRequestTimeoutMilliseconds,
    ) {
        this.log = log;
        this.telegramMetrics = telegramMetrics;
        this.requestTimeoutMilliseconds = requestTimeoutMilliseconds;
        this.baseUrl = `https://api.telegram.org/bot${botToken}`;
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
        const stopRequest = this.telegramMetrics.startApiRequest(method);
        let result: ApiResponse<TelegramMethodResult<TMethod>>;

        try {
            const response = await fetch(`${this.baseUrl}/${method}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal: AbortSignal.timeout(this.requestTimeoutMilliseconds),
                body: params === undefined ? undefined : JSON.stringify(params),
            });

            result = (await response.json()) as ApiResponse<
                TelegramMethodResult<TMethod>
            >;
        } catch (err) {
            stopRequest("network_error");
            throw err;
        }

        stopRequest(result.ok ? "ok" : "error");

        if (!result.ok) {
            this.log.warn(
                {
                    method,
                    errorCode: result.error_code,
                    description: result.description,
                },
                "Telegram API request failed",
            );
        }

        return result;
    }
}

export default fp(
    async function (fastify: FastifyInstance, opts: TelegramApiPluginOptions) {
        const appLogger = fastify.getDecorator<AppLogger>("appLogger");

        fastify.decorate(
            "telegramApiService",
            opts.telegramApiService ??
                new TelegramApiService(
                    fastify.config.TELEGRAM_BOT_TOKEN,
                    appLogger.child({ module: "telegram-api" }),
                    fastify.getDecorator<TelegramMetrics>("telegramMetrics"),
                ),
        );
    },
    {
        name: "telegram-api-service",
        dependencies: ["@fastify/env", "app-logger", "telegram-metrics"],
    },
);
