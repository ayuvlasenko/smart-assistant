import { ApiError } from "@grammyjs/types";

export class DuplicateTelegramUpdateError extends Error {
    constructor() {
        super("Telegram update was already received");
        this.name = "DuplicateTelegramUpdateError";
    }
}

export class TelegramUpdateWithoutUserError extends Error {
    constructor() {
        super("Telegram update has no user");
        this.name = "TelegramUpdateWithoutUserError";
    }
}

export class NonPrivateChatError extends Error {
    constructor() {
        super("Telegram update is not from a private chat");
        this.name = "NonPrivateChatError";
    }
}

export class BannedTelegramUserError extends Error {
    constructor() {
        super("Telegram user is banned");
        this.name = "BannedTelegramUserError";
    }
}

export class UnhandledTelegramUpdateError extends Error {
    constructor() {
        super("No Telegram route handled the update");
        this.name = "UnhandledTelegramUpdateError";
    }
}

export class TelegramApiError extends Error {
    readonly method: string;
    readonly errorCode: number;
    readonly description: string;
    readonly retryAfter: number | undefined;

    constructor(method: string, response: ApiError) {
        super(`Telegram ${method} failed: ${response.description}`);
        this.name = "TelegramApiError";
        this.method = method;
        this.errorCode = response.error_code;
        this.description = response.description;
        this.retryAfter = response.parameters?.retry_after;
    }
}
