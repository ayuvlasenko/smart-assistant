export class BotTelegramIdTakenError extends Error {
    readonly telegramId: string;

    constructor(telegramId: string) {
        super(`Telegram bot ${telegramId} belongs to another bot`);
        this.name = "BotTelegramIdTakenError";
        this.telegramId = telegramId;
    }
}
