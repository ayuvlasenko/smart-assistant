import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    buildTelegramCallbackQueryUpdate,
    buildTelegramTextMessageUpdate,
} from "../../../test/telegram-fixtures.js";
import { callbackQuery, command, message } from "./telegram-filters.js";

void describe("telegram filters", () => {
    void describe("message", () => {
        void it("matches text messages", () => {
            const update = buildTelegramTextMessageUpdate({
                message: {
                    text: "hello",
                },
            });

            assert.equal(message("text")(update), true);
        });

        void it("rejects text messages that start with a bot command", () => {
            const update = buildTelegramTextMessageUpdate({
                message: {
                    entities: [{ length: 7, offset: 0, type: "bot_command" }],
                    text: "/cancel",
                },
            });

            assert.equal(message("text")(update), false);
        });
    });

    void describe("command", () => {
        void it("matches any bot command", () => {
            const update = buildTelegramTextMessageUpdate({
                message: {
                    entities: [{ length: 5, offset: 0, type: "bot_command" }],
                    text: "/ping",
                },
            });

            assert.equal(command()(update), true);
        });

        void it("matches a command by name", () => {
            const update = buildTelegramTextMessageUpdate({
                message: {
                    entities: [{ length: 5, offset: 0, type: "bot_command" }],
                    text: "/ping",
                },
            });

            assert.equal(command("ping")(update), true);
        });

        void it("matches a command by name when the command has a bot username suffix", () => {
            const update = buildTelegramTextMessageUpdate({
                message: {
                    entities: [{ length: 13, offset: 0, type: "bot_command" }],
                    text: "/ping@SomeBot",
                },
            });

            assert.equal(command("ping")(update), true);
        });

        void it("rejects a different command name", () => {
            const update = buildTelegramTextMessageUpdate({
                message: {
                    entities: [{ length: 6, offset: 0, type: "bot_command" }],
                    text: "/start",
                },
            });

            assert.equal(command("ping")(update), false);
        });

        void it("rejects bot command entities that are not at offset zero", () => {
            const update = buildTelegramTextMessageUpdate({
                message: {
                    entities: [{ length: 5, offset: 4, type: "bot_command" }],
                    text: "run /ping",
                },
            });

            assert.equal(command()(update), false);
        });

        void it("rejects malformed bot command entities with a negative offset", () => {
            const update = buildTelegramTextMessageUpdate({
                message: {
                    entities: [{ length: 5, offset: -1, type: "bot_command" }],
                    text: "/ping",
                },
            });

            assert.equal(command()(update), false);
        });
    });

    void describe("callbackQuery", () => {
        void it("matches callback queries", () => {
            const update = buildTelegramCallbackQueryUpdate();

            assert.equal(callbackQuery()(update), true);
        });

        void it("matches callback queries with data", () => {
            const update = buildTelegramCallbackQueryUpdate({
                data: "choose:today",
            });

            assert.equal(callbackQuery("data")(update), true);
        });

        void it("rejects callback queries without data when data is required", () => {
            const update = buildTelegramCallbackQueryUpdate({
                data: undefined,
            });

            assert.equal(callbackQuery("data")(update), false);
        });
    });
});
