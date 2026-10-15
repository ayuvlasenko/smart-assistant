import { Update } from "@grammyjs/types";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Counter, Histogram } from "prom-client";
import { MetricsService } from "../metrics-service.js";
import { extractTelegramUpdateType } from "./telegram-extractors.js";

export type TelegramUpdateResult =
    | "duplicate"
    | "ignored"
    | "no_user"
    | "banned"
    | "handled"
    | "unhandled"
    | "error";

export type TelegramSceneEvent =
    | "start"
    | "end"
    | "ask"
    | "delivered"
    | "delivery_failed"
    | "next"
    | "stay"
    | "goto"
    | "back"
    | "complete"
    | "cancel"
    | "error"
    | "unexpected_input"
    | "blocked"
    | "forbidden";

export type TelegramButtonResult = "handled" | "expired" | "forbidden";

export type TelegramApiResult = "ok" | "error" | "network_error";

export class TelegramMetrics {
    private readonly updates: Counter<"type" | "result">;
    private readonly updateDuration: Histogram<"type">;
    private readonly sceneEvents: Counter<"scene" | "event">;
    private readonly buttonPresses: Counter<"action" | "result">;
    private readonly apiRequests: Counter<"method" | "result">;
    private readonly apiRequestDuration: Histogram<"method">;

    constructor(metrics: MetricsService) {
        this.updates = metrics.counter({
            name: "telegram_updates_total",
            help: "Telegram updates by update type and handling result",
            labelNames: ["type", "result"],
        });
        this.updateDuration = metrics.histogram({
            name: "telegram_update_duration_seconds",
            help: "Time to handle a Telegram update",
            labelNames: ["type"],
        });
        this.sceneEvents = metrics.counter({
            name: "telegram_scene_events_total",
            help: "Telegram scene lifecycle events",
            labelNames: ["scene", "event"],
        });
        this.buttonPresses = metrics.counter({
            name: "telegram_button_presses_total",
            help: "Telegram button presses by action and result",
            labelNames: ["action", "result"],
        });
        this.apiRequests = metrics.counter({
            name: "telegram_api_requests_total",
            help: "Telegram Bot API requests by method and result",
            labelNames: ["method", "result"],
        });
        this.apiRequestDuration = metrics.histogram({
            name: "telegram_api_request_duration_seconds",
            help: "Telegram Bot API request duration",
            labelNames: ["method"],
        });
    }

    startUpdate(update: Update): (result: TelegramUpdateResult) => void {
        const type = extractTelegramUpdateType(update);
        const stopTimer = this.updateDuration.startTimer({ type });

        return (result) => {
            stopTimer();
            this.updates.inc({ type, result });
        };
    }

    recordSceneEvent(scene: string, event: TelegramSceneEvent): void {
        this.sceneEvents.inc({ scene, event });
    }

    recordButtonPress(action: string, result: TelegramButtonResult): void {
        this.buttonPresses.inc({ action, result });
    }

    startApiRequest(method: string): (result: TelegramApiResult) => void {
        const stopTimer = this.apiRequestDuration.startTimer({ method });

        return (result) => {
            stopTimer();
            this.apiRequests.inc({ method, result });
        };
    }
}

export default fp(
    async function (fastify: FastifyInstance) {
        fastify.decorate(
            "telegramMetrics",
            new TelegramMetrics(
                fastify.getDecorator<MetricsService>("metrics"),
            ),
        );
    },
    {
        name: "telegram-metrics",
        dependencies: ["metrics"],
    },
);
