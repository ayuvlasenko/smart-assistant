import { Type } from "@sinclair/typebox";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { useTestMongo } from "../../../test/mongo.js";
import {
    buildTelegramPrivateChat,
    testBotId,
} from "../../../test/telegram-fixtures.js";
import { buildShopBot } from "../../../test/telegram-scene-fixtures.js";
import { telegramLocales } from "./telegram-locales.js";

const shopSceneField = `scene:${createHash("sha256")
    .update("shop:shop")
    .digest("base64url")
    .slice(0, 12)}`;

const testMongo = useTestMongo();

void describe("Telegram scene screens", () => {
    void it("shows the root screen and edits its message when the params change", async (t) => {
        const { bot } = await buildShopBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654701 });

        await bot.sendText(chat, "/shop");
        await bot.pressButton(chat, "Next");

        assert.deepEqual(bot.readSentTexts(), ["List 0"]);
        assert.deepEqual(await bot.readMessageTexts(chat.id), ["List 1"]);
    });

    void it("returns to the previous screen with its params", async (t) => {
        const { bot } = await buildShopBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654702 });

        await bot.sendText(chat, "/shop");
        await bot.pressButton(chat, "Next");
        await bot.pressButton(chat, "Open a");

        assert.deepEqual(await bot.readMessageTexts(chat.id), [
            "Item a: 0",
            "Actions a",
        ]);

        await bot.pressButton(chat, "Back");

        assert.deepEqual(await bot.readMessageTexts(chat.id), ["List 1"]);
        assert.deepEqual(bot.readSentTexts(), ["List 0", "Actions a"]);
    });

    void it("sends the later messages again when an earlier one must be sent anew", async (t) => {
        const { bot } = await buildShopBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654703 });

        await bot.sendText(chat, "/shop");
        await bot.pressButton(chat, "Open a");
        bot.telegramApiService.editMessageText.mock.mockImplementationOnce(
            async () => ({
                ok: false,
                error_code: 400,
                description: "Bad Request: message to edit not found",
            }),
        );
        await bot.pressButton(chat, "Open b");

        assert.deepEqual(await bot.readMessageTexts(chat.id), [
            "Item b: 0",
            "Actions b",
        ]);
    });

    void it("replaces a screen, so going back skips it", async (t) => {
        const { bot } = await buildShopBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654704 });

        await bot.sendText(chat, "/shop");
        await bot.pressButton(chat, "Form");
        await bot.pressButton(chat, "Save");

        assert.deepEqual(await bot.readMessageTexts(chat.id), [
            "Item b: 0",
            "Actions b",
        ]);

        await bot.pressButton(chat, "Back");

        assert.deepEqual(await bot.readMessageTexts(chat.id), ["List 0"]);
    });

    void it("resets to the root screen and forgets the previous screens", async (t) => {
        const { bot } = await buildShopBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654705 });

        await bot.sendText(chat, "/shop");
        await bot.pressButton(chat, "Next");
        await bot.pressButton(chat, "Open a");
        await bot.pressButton(chat, "Form");
        await bot.pressButton(chat, "Home");
        await bot.pressButton(chat, "Up");

        assert.deepEqual(await bot.readMessageTexts(chat.id), ["List 0"]);
    });

    void it("refuses a screen that its guard hides", async (t) => {
        const { bot } = await buildShopBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654706 });

        await bot.sendText(chat, "/shop");
        await bot.pressButton(chat, "Secret");

        assert.deepEqual(await bot.readMessageTexts(chat.id), ["List 0"]);
        assert.deepEqual(
            bot.telegramApiService.answerCallbackQuery.mock.calls.at(-1)
                ?.arguments[0].text,
            undefined,
        );
    });

    void it("shows the root screen when the guard of the current screen stops letting the user in", async (t) => {
        const { bot, shop } = await buildShopBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654717 });

        shop.isVip = true;
        await bot.sendText(chat, "/shop");
        await bot.pressButton(chat, "VIP");

        assert.deepEqual(await bot.readMessageTexts(chat.id), ["VIP"]);

        shop.isVip = false;
        bot.telegramChats.publish(testBotId, ["shop.vip"]);
        await bot.telegramChats.idle();

        assert.deepEqual(await bot.readMessageTexts(chat.id), ["List 0"]);
    });

    void it("refuses a move of a handler into a screen that its guard hides", async (t) => {
        const { bot } = await buildShopBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654718 });

        await bot.sendText(chat, "/shop");
        await bot.pressButton(chat, "Next");
        await bot.pressButton(chat, "Force secret");

        assert.deepEqual(await bot.readMessageTexts(chat.id), ["List 1"]);
    });

    void it("cancels a waiting input when the screen changes", async (t) => {
        const { bot, shop } = await buildShopBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654709 });

        await bot.sendText(chat, "/shop");
        await bot.pressButton(chat, "Form");
        await bot.pressButton(chat, "Note");

        assert.deepEqual(await bot.readMessageTexts(chat.id), [
            "Form",
            "Note?",
        ]);

        await bot.pressButton(chat, "Back");
        await bot.sendText(chat, "hello");

        assert.deepEqual(await bot.readMessageTexts(chat.id), ["List 0"]);
        assert.deepEqual(shop.notes, []);
    });

    void it("redraws the screen that watches a published topic", async (t) => {
        const { bot, shop } = await buildShopBot(testMongo, t);
        const ada = buildTelegramPrivateChat({ id: 987654710 });
        const bob = buildTelegramPrivateChat({ id: 987654711 });

        await bot.sendText(ada, "/shop");
        await bot.pressButton(ada, "Open a");
        await bot.sendText(bob, "/shop");
        shop.stock.a = 1;
        bot.telegramChats.publish(testBotId, ["shop.item:a"]);
        await bot.telegramChats.idle();

        assert.deepEqual(await bot.readMessageTexts(ada.id), [
            "Item a: 1",
            "Actions a",
        ]);
        assert.deepEqual(await bot.readMessageTexts(bob.id), ["List 0"]);
    });

    void it("shows the running scene again on the same screen", async (t) => {
        const { bot } = await buildShopBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654712 });

        await bot.sendText(chat, "/shop");
        await bot.pressButton(chat, "Open a");
        await bot.sendText(chat, "/shop");

        assert.deepEqual(await bot.readMessageTexts(chat.id), [
            "Item a: 0",
            "Actions a",
        ]);
        assert.deepEqual(bot.readSentTexts(), [
            "List 0",
            "Actions a",
            "Item a: 0",
            "Actions a",
        ]);
    });

    void it("drops a scene whose stored screen is no longer defined", async (t) => {
        const { bot } = await buildShopBot(testMongo, t);
        const chat = buildTelegramPrivateChat({ id: 987654713 });

        await bot.sendText(chat, "/shop");

        const record = await bot.readSessionField(
            chat.id,
            shopSceneField,
            Type.Record(Type.String(), Type.Unknown()),
        );

        await bot.writeSessionField(chat.id, shopSceneField, {
            ...record,
            screen: { name: "gone", params: {} },
        });
        await bot.pressButton(chat, "Next");

        assert.equal(
            bot.telegramApiService.answerCallbackQuery.mock.calls.at(-1)
                ?.arguments[0].text,
            telegramLocales.en.buttonExpired,
        );
    });
});
