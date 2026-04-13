import { Update } from "@grammyjs/types";
import { TelegramApiClient } from "./telegram-api-service.js";

export class TelegramBotService {
    constructor(private readonly telegramApiService: TelegramApiClient) {}

    async handleUpdate(update: Update): Promise<void> {
        if (update.message?.text === "ping") {
            await this.telegramApiService.sendMessage({
                chat_id: update.message.chat.id,
                text: "pong",
            });
        }
    }
}
