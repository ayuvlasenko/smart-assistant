import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { useTestMongo } from "../../../test/mongo.js";
import { buildTelegramBotServiceTestApp } from "../../../test/telegram-bot-service-helper.js";
import { testBotId } from "../../../test/telegram-fixtures.js";
import { UsersService } from "./users-service.js";

const testMongo = useTestMongo();

void describe("UsersService", () => {
    void it("unbans a user, adds the grants and sets the chat menu again", async (t) => {
        const { app, telegramApiService, usersRepository } =
            await buildTelegramBotServiceTestApp({
                testMongo,
                t,
                registerRoutes: (router) => {
                    router.command("secret", async () => undefined, {
                        guard: (user) => user.grants.includes("vip"),
                        description: (translate) =>
                            translate("telegram:nothingToCancel"),
                    });
                },
            });
        const usersService = app.getDecorator<UsersService>("usersService");
        const { user: banned } =
            await usersRepository.findOneByTelegramIdOrCreate({
                botId: testBotId,
                telegramId: "987654901",
                isBanned: true,
                languageCode: "en",
            });

        const user = await usersService.grantAccess(banned._id, ["vip"]);

        assert.equal(user.isBanned, false);
        assert.deepEqual(user.grants, ["vip"]);
        assert.deepEqual(
            telegramApiService.setMyCommands.mock.calls.map(
                ({ arguments: [args] }) => ({
                    scope: args.scope,
                    commands: args.commands.map(({ command }) => command),
                }),
            ),
            [
                {
                    scope: { type: "chat", chat_id: 987654901 },
                    commands: ["cancel", "secret"],
                },
            ],
        );
    });

    void it("keeps a separate user for every bot of one Telegram account", async (t) => {
        const { app } = await buildTelegramBotServiceTestApp({
            testMongo,
            t,
        });
        const usersService = app.getDecorator<UsersService>("usersService");
        const profile = {
            telegramId: "987654902",
            languageCode: "en" as const,
        };

        const first = await usersService.findOrCreateByTelegramId({
            botId: testBotId,
            ...profile,
        });
        const other = await usersService.findOrCreateByTelegramId({
            botId: "42",
            ...profile,
        });
        const again = await usersService.findOrCreateByTelegramId({
            botId: testBotId,
            ...profile,
        });

        assert.equal(first.isCreated, true);
        assert.equal(other.isCreated, true);
        assert.notDeepEqual(other.user._id, first.user._id);
        assert.equal(again.isCreated, false);
        assert.deepEqual(again.user._id, first.user._id);
    });
});
