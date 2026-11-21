import { ApiError, ApiResponse } from "@grammyjs/types";

export class BannedTelegramUserError extends Error {
    constructor() {
        super("Telegram user is banned");
        this.name = "BannedTelegramUserError";
    }
}

export class UnhandledTelegramUpdateError extends Error {
    readonly refusedRoute: string | undefined;

    constructor(refusedRoute?: string) {
        super("No Telegram route handled the update");
        this.name = "UnhandledTelegramUpdateError";
        this.refusedRoute = refusedRoute;
    }
}

export class TelegramApiError extends Error {
    readonly method: string;
    readonly errorCode: number;
    readonly description: string;

    constructor(method: string, response: ApiError) {
        super(`Telegram ${method} failed: ${response.description}`);
        this.name = "TelegramApiError";
        this.method = method;
        this.errorCode = response.error_code;
        this.description = response.description;
    }
}

export function isBlockedByUser(err: unknown): boolean {
    return err instanceof TelegramApiError && err.errorCode === 403;
}

export function unwrapTelegramResponse<TResult>(
    method: string,
    response: ApiResponse<TResult>,
): TResult {
    if (!response.ok) {
        throw new TelegramApiError(method, response);
    }

    return response.result;
}
