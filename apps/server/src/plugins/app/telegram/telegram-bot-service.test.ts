import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTelegramApiServiceMock } from "../../../test/telegram-api-service-mock.js";
import {
    buildTelegramPrivateChat,
    buildTelegramTextMessageUpdate,
} from "../../../test/telegram-fixtures.js";
import { TelegramBotService } from "./telegram-bot-service.js";

void describe("TelegramBotService", () => {
    void it("sends pong on ping text message", async (t) => {
        const telegramApiService = buildTelegramApiServiceMock({ t });
        const telegramBotService = new TelegramBotService(telegramApiService);

        await telegramBotService.handleUpdate(
            buildTelegramTextMessageUpdate({
                message: {
                    text: "ping",
                    chat: buildTelegramPrivateChat({
                        id: 987654321,
                    }),
                },
            }),
        );

        assert.equal(telegramApiService.sendMessage.mock.callCount(), 1);
        const [call] = telegramApiService.sendMessage.mock.calls;
        assert.ok(call);
        assert.deepEqual(call.arguments[0], {
            chat_id: 987654321,
            text: "pong",
        });
    });

    void it("doesn't send pong on other text messages", async (t) => {
        const telegramApiService = buildTelegramApiServiceMock({ t });
        const telegramBotService = new TelegramBotService(telegramApiService);

        await telegramBotService.handleUpdate(
            buildTelegramTextMessageUpdate({
                message: {
                    text: "hello",
                },
            }),
        );

        assert.equal(telegramApiService.sendMessage.mock.callCount(), 0);
    });
});
