import { Db, MongoClient } from "mongodb";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { buildTestMongo } from "../../../test/mongo.js";
import { buildTelegramBotServiceTestApp } from "../../../test/telegram-bot-service-helper.js";
import { UsersService } from "./users-service.js";

let databaseName!: string;
let mongoClient!: MongoClient;
let mongo!: Db;

before(async () => {
    const testMongo = await buildTestMongo();

    databaseName = testMongo.databaseName;
    mongoClient = testMongo.client;
    mongo = testMongo.mongo;
});

beforeEach(async () => {
    await mongo.collection("users").deleteMany({});
});

after(async () => {
    await mongo.dropDatabase();
    await mongoClient.close();
});

void describe("UsersService", () => {
    void it("unbans a user, adds the grants and sets the chat menu again", async (t) => {
        const { app, telegramApiService, usersRepository } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
                registerRoutes: (router) => {
                    router.command("secret", async () => undefined, {
                        guard: (user) => user.grants.includes("vip"),
                        description: (translate) =>
                            translate("telegram:unknown"),
                    });
                },
            });
        const usersService = app.getDecorator<UsersService>("usersService");
        const { user: banned } =
            await usersRepository.findOneByTelegramIdOrCreate({
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
});
