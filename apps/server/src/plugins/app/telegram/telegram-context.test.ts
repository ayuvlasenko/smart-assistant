import { CallbackQuery, Message, Update } from "@grammyjs/types";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    buildTelegramCallbackQueryUpdate,
    buildTelegramTextMessageUpdate,
} from "../../../test/telegram-fixtures.js";
import {
    createTelegramContext,
    TelegramUpdateFilter,
} from "./telegram-context.js";

type TestTextMessageUpdate = Omit<Update, "callback_query" | "message"> & {
    callback_query?: never;
    message: Message.TextMessage & Update.NonChannel;
};

type TestCallbackDataUpdate = Omit<Update, "callback_query" | "message"> & {
    callback_query: CallbackQuery & { data: string };
    message?: never;
};

const textMessageFilter: TelegramUpdateFilter<TestTextMessageUpdate> = (
    update,
): update is TestTextMessageUpdate => {
    return !!(update.message && "text" in update.message);
};

const callbackDataFilter: TelegramUpdateFilter<TestCallbackDataUpdate> = (
    update,
): update is TestCallbackDataUpdate => {
    return typeof update.callback_query?.data === "string";
};

function expectGuardedUpdateUnion(
    update: TestTextMessageUpdate | TestCallbackDataUpdate,
): TestTextMessageUpdate | TestCallbackDataUpdate {
    return update;
}

void describe("createTelegramContext", () => {
    void it("stores the update", () => {
        const update = buildTelegramTextMessageUpdate();
        const context = createTelegramContext(update);

        assert.equal(context.update, update);
    });

    void it("narrows update with a single filter", () => {
        const context = createTelegramContext(
            buildTelegramTextMessageUpdate({
                message: {
                    text: "hello",
                },
            }) as Update,
        );

        if (!context.has(textMessageFilter)) {
            assert.fail("Expected text message filter to match");
        }

        assert.equal(context.update.message.text, "hello");
    });

    void it("narrows update with any matching filter from an array", () => {
        const context = createTelegramContext(
            buildTelegramCallbackQueryUpdate({
                data: "choose:today",
            }) as Update,
        );

        if (!context.has([textMessageFilter, callbackDataFilter])) {
            assert.fail("Expected one of the filters to match");
        }

        expectGuardedUpdateUnion(context.update);
        assert.equal(context.update.message?.text, undefined);
        assert.equal(context.update.callback_query?.data, "choose:today");
    });

    void it("returns false when no array filter matches", () => {
        const context = createTelegramContext(
            buildTelegramCallbackQueryUpdate({
                data: undefined,
            }) as Update,
        );

        assert.equal(
            context.has([textMessageFilter, callbackDataFilter]),
            false,
        );
    });
});
