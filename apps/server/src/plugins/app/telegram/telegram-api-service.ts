import { ApiResponse, Opts } from "@grammyjs/types";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

export class TelegramApiService {
    private readonly baseUrl: string;

    constructor(botToken: string) {
        this.baseUrl = `https://api.telegram.org/bot${botToken}`;
    }

    setWebhook(params: Opts<never>["setWebhook"]): Promise<ApiResponse<true>> {
        return this.call("setWebhook", params);
    }

    sendMessage(
        params: Opts<never>["sendMessage"],
    ): Promise<ApiResponse<unknown>> {
        return this.call("sendMessage", params);
    }

    private async call<T>(
        method: string,
        params: object,
    ): Promise<ApiResponse<T>> {
        const response = await fetch(`${this.baseUrl}/${method}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
        });

        return response.json() as Promise<ApiResponse<T>>;
    }
}

export default fp(
    async function (fastify: FastifyInstance) {
        fastify.decorate(
            "telegramApiService",
            new TelegramApiService(fastify.config.TELEGRAM_BOT_TOKEN),
        );
    },
    {
        name: "telegram-api-service",
        dependencies: ["@fastify/env"],
    },
);
