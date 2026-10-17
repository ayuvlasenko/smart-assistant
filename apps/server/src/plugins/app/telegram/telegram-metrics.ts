import { Update } from "@grammyjs/types";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Counter, Gauge, Histogram } from "prom-client";
import { MetricsService } from "../metrics-service.js";
import { type TelegramApiPriority } from "./telegram-api-service.js";
import { extractTelegramUpdateType } from "./telegram-extractors.js";

export type TelegramUpdateResult =
    | "duplicate"
    | "ignored"
    | "no_user"
    | "banned"
    | "handled"
    | "unhandled"
    | "blocked"
    | "lock_lost"
    | "lock_hold_timeout"
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

export type TelegramApiResult =
    "ok" | "error" | "rate_limited" | "network_error" | "aborted";

export type TelegramDeliveryKind = "publish" | "deliver";

export type TelegramCommandMenuSync = "unchanged" | "set" | "failed";

export class TelegramMetrics {
    private readonly updates: Counter<"type" | "result">;
    private readonly updateDuration: Histogram<"type">;
    private readonly sceneEvents: Counter<"scene" | "event">;
    private readonly buttonPresses: Counter<"action" | "result">;
    private readonly apiRequests: Counter<"method" | "result" | "error_code">;
    private readonly apiRequestDuration: Histogram<"method">;
    private readonly rateLimitWait: Histogram<"method" | "priority">;
    private readonly retryAfter: Histogram<"method">;
    private readonly recipientsInFlight: Gauge<"kind">;
    private readonly deliveryRecipients: Histogram<"kind">;
    private readonly deliveryDuration: Histogram<"kind">;
    private readonly commandMenuSyncs: Counter<"result">;
    private readonly usersCreated: Counter;

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
            help: "Telegram Bot API requests by method, result and Bot API error code",
            labelNames: ["method", "result", "error_code"],
        });
        this.apiRequestDuration = metrics.histogram({
            name: "telegram_api_request_duration_seconds",
            help: "Telegram Bot API request duration",
            labelNames: ["method"],
        });
        this.rateLimitWait = metrics.histogram({
            name: "telegram_rate_limit_wait_seconds",
            help: "Time a Telegram Bot API request waited for the rate limiter",
            labelNames: ["method", "priority"],
            buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 30, 60],
        });
        this.retryAfter = metrics.histogram({
            name: "telegram_api_retry_after_seconds",
            help: "retry_after of Telegram Bot API responses with error 429",
            labelNames: ["method"],
            buckets: [1, 2, 5, 10, 30, 60, 300, 3600],
        });
        this.recipientsInFlight = metrics.gauge({
            name: "telegram_delivery_recipients_in_flight",
            help: "Users whose background update has started and not finished",
            labelNames: ["kind"],
        });
        this.deliveryRecipients = metrics.histogram({
            name: "telegram_delivery_recipients",
            help: "Users that one publish or deliver run updates",
            labelNames: ["kind"],
            buckets: [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000],
        });
        this.deliveryDuration = metrics.histogram({
            name: "telegram_delivery_duration_seconds",
            help: "Time to update one user in a background run, with the wait for the session lock",
            labelNames: ["kind"],
            buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 30, 60],
        });
        this.commandMenuSyncs = metrics.counter({
            name: "telegram_command_menu_syncs_total",
            help: "Chat command menu syncs by result",
            labelNames: ["result"],
        });
        this.usersCreated = metrics.counter({
            name: "telegram_users_created_total",
            help: "Users created by their first Telegram update",
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

    startApiRequest(
        method: string,
    ): (result: TelegramApiResult, errorCode?: number) => void {
        const stopTimer = this.apiRequestDuration.startTimer({ method });

        return (result, errorCode) => {
            stopTimer();
            this.apiRequests.inc({
                method,
                result,
                error_code: errorCode === undefined ? "" : String(errorCode),
            });
        };
    }

    recordRateLimitWait(
        method: string,
        priority: TelegramApiPriority,
        seconds: number,
    ): void {
        this.rateLimitWait.observe({ method, priority }, seconds);
    }

    recordRetryAfter(method: string, seconds: number): void {
        this.retryAfter.observe({ method }, seconds);
    }

    recordDeliveryRecipients(
        kind: TelegramDeliveryKind,
        recipients: number,
    ): void {
        this.deliveryRecipients.observe({ kind }, recipients);
    }

    startRecipientDelivery(kind: TelegramDeliveryKind): () => void {
        const stopTimer = this.deliveryDuration.startTimer({ kind });

        this.recipientsInFlight.inc({ kind });

        return () => {
            stopTimer();
            this.recipientsInFlight.dec({ kind });
        };
    }

    recordCommandMenuSync(result: TelegramCommandMenuSync): void {
        this.commandMenuSyncs.inc({ result });
    }

    recordUserCreated(): void {
        this.usersCreated.inc();
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
