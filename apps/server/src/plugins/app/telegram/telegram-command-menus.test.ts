import { Db, MongoClient } from "mongodb";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createLoggerCollector } from "../../../test/logger-collector.js";
import { buildTestMongo } from "../../../test/mongo.js";
import { buildTelegramApiServiceMock } from "../../../test/telegram-api-service-mock.js";
import {
    buildTelegramBotServiceTestApp,
    BuildTelegramBotServiceTestAppOptions,
    buildTwoBotsTestApp,
} from "../../../test/telegram-bot-service-helper.js";
import { buildUserEntity } from "../../../test/user-fixtures.js";
import { Language } from "../i18n-service.js";
import { UserEntity } from "../users/user-entity.js";
import { telegramLocales } from "./telegram-locales.js";

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
    await mongo.collection("bots").deleteMany({});
});

after(async () => {
    await mongo.dropDatabase();
    await mongoClient.close();
});

void describe("TelegramCommandMenus on start", () => {
    void it("sets localized commands for every language on production", async (t) => {
        const { telegramApiService, telegramCommandMenus } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
                registerRoutes: (router) => {
                    router.command("help", async () => undefined, {
                        description: (translate) =>
                            translate("telegram:nothingToCancel"),
                    });
                },
            });

        await telegramCommandMenus.setOnStart();

        assert.deepEqual(
            telegramApiService.setMyCommands.mock.calls.map(
                (call) => call.arguments,
            ),
            [
                [{ commands: buildExpectedCommands("en") }],
                ...(["en", "uk", "ru"] as const).map((language) => [
                    {
                        commands: buildExpectedCommands(language),
                        language_code: language,
                    },
                ]),
            ],
        );
    });

    void it("sets the menus of the other bots when one bot fails", async (t) => {
        const logs = createLoggerCollector();
        const failing = buildTelegramApiServiceMock({ t });

        failing.setMyCommands.mock.mockImplementation(async () => ({
            ok: false,
            error_code: 401,
            description: "Unauthorized",
        }));

        const { botsRegistry, child, telegramCommandMenus } =
            await buildTwoBotsTestApp({
                databaseName,
                mongoClient,
                t,
                telegramApiService: failing,
                logger: logs.logger,
            });

        await telegramCommandMenus.setOnStart();

        assert.equal(failing.setMyCommands.mock.callCount(), 1);
        assert.equal(child.setMyCommands.mock.callCount(), 4);
        assert.ok(
            logs
                .readEntries()
                .some(
                    (entry) =>
                        entry.msg ===
                            "Failed to set the commands of a bot on start" &&
                        entry.botId === botsRegistry.rootId,
                ),
        );
    });

    void it("doesn't touch commands on preview", async (t) => {
        const { telegramApiService, telegramCommandMenus } =
            await buildTelegramBotServiceTestApp({
                databaseName,
                mongoClient,
                t,
                environment: "preview",
            });

        await telegramCommandMenus.setOnStart();

        assert.equal(telegramApiService.setMyCommands.mock.callCount(), 0);
    });
});

void describe("TelegramCommandMenus chat menus", () => {
    void it("keeps guarded commands out of the menu on start", async (t) => {
        const { telegramApiService, telegramCommandMenus } =
            await buildTelegramBotServiceTestApp(buildMenuAppOptions(t));

        await telegramCommandMenus.setOnStart();

        assert.deepEqual(
            telegramApiService.setMyCommands.mock.calls[0]?.arguments[0]
                .commands,
            buildExpectedCommands("en"),
        );
    });

    void it("sets the menu of the bot on start only when it changed", async (t) => {
        const { telegramApiService, telegramCommandMenus } =
            await buildTelegramBotServiceTestApp(buildMenuAppOptions(t));

        await telegramCommandMenus.setOnStart();
        await telegramCommandMenus.setOnStart();

        assert.equal(telegramApiService.setMyCommands.mock.callCount(), 4);
    });

    void it("sets every menu of the bot again after a refresh that failed in the middle", async (t) => {
        const { telegramApiService, telegramBots, telegramCommandMenus } =
            await buildTelegramBotServiceTestApp(buildMenuAppOptions(t));

        await telegramCommandMenus.setOnStart();
        telegramApiService.setMyCommands.mock.mockImplementationOnce(
            async () => ({
                ok: false,
                error_code: 500,
                description: "Internal Server Error",
            }),
            5,
        );

        await assert.rejects(
            telegramCommandMenus.refresh(await telegramBots.root()),
        );
        await telegramCommandMenus.setOnStart();

        assert.equal(telegramApiService.setMyCommands.mock.callCount(), 10);
    });

    void it("leaves a user whose commands are the menu of the bot without a chat menu", async (t) => {
        const { telegramApiService, telegramCommandMenus } =
            await buildTelegramBotServiceTestApp(buildMenuAppOptions(t));
        const user = await insertUser({ telegramId: "987654602" });

        await telegramCommandMenus.syncUser(user);

        assert.equal(telegramApiService.setMyCommands.mock.callCount(), 0);
        assert.equal(telegramApiService.deleteMyCommands.mock.callCount(), 0);
        assert.equal((await readUser(user)).commandMenu, undefined);
    });

    void it("counts a set menu, an unchanged one and a removed one", async (t) => {
        const { metrics, telegramCommandMenus } =
            await buildTelegramBotServiceTestApp(buildMenuAppOptions(t));
        const user = await insertUser({
            telegramId: "987654609",
            grants: ["vip"],
        });

        await telegramCommandMenus.syncUser(user);
        await telegramCommandMenus.syncUser(await readUser(user));
        await telegramCommandMenus.syncUser({
            ...(await readUser(user)),
            grants: [],
        });

        const output = await metrics.metrics();

        for (const result of ["set", "unchanged", "removed"]) {
            assert.match(
                output,
                new RegExp(
                    `^telegram_command_menu_syncs_total\\{result="${result}"\\} 1$`,
                    "m",
                ),
            );
        }
    });

    void it("sets the commands that the user's grants allow in the user's language for the chat", async (t) => {
        const { telegramApiService, telegramCommandMenus } =
            await buildTelegramBotServiceTestApp(buildMenuAppOptions(t));

        await telegramCommandMenus.syncUser(
            await insertUser({
                telegramId: "987654601",
                languageCode: "uk",
                grants: ["vip"],
            }),
        );

        assert.deepEqual(
            telegramApiService.setMyCommands.mock.calls.map(
                (call) => call.arguments,
            ),
            [
                [
                    {
                        commands: [
                            ...buildExpectedCommands("uk"),
                            {
                                command: "secret",
                                description: telegramLocales.uk.error,
                            },
                        ],
                        scope: { type: "chat", chat_id: 987654601 },
                    },
                ],
            ],
        );
    });

    void it("sets the chat commands again only when they change", async (t) => {
        const { telegramApiService, telegramCommandMenus } =
            await buildTelegramBotServiceTestApp(buildMenuAppOptions(t));
        const user = await insertUser({
            telegramId: "987654603",
            grants: ["vip"],
        });

        await telegramCommandMenus.syncUser(user);
        await telegramCommandMenus.syncUser(await readUser(user));
        await telegramCommandMenus.syncUser({
            ...(await readUser(user)),
            languageCode: "ru",
        });

        assert.deepEqual(
            telegramApiService.setMyCommands.mock.calls.map(
                (call) => call.arguments[0].commands[0]?.description,
            ),
            [
                telegramLocales.en.cancelCommand,
                telegramLocales.ru.cancelCommand,
            ],
        );
    });

    void it("removes the chat menu when the commands of the user become the menu of the bot", async (t) => {
        const { telegramApiService, telegramCommandMenus } =
            await buildTelegramBotServiceTestApp(buildMenuAppOptions(t));
        const user = await insertUser({
            telegramId: "987654607",
            grants: ["vip"],
        });

        await telegramCommandMenus.syncUser(user);
        await telegramCommandMenus.syncUser({
            ...(await readUser(user)),
            grants: [],
        });

        assert.deepEqual(
            telegramApiService.deleteMyCommands.mock.calls.map(
                (call) => call.arguments,
            ),
            [[{ scope: { type: "chat", chat_id: 987654607 } }]],
        );
        assert.equal((await readUser(user)).commandMenu, undefined);
    });

    void it("removes the chat menu that a user got before the bot had a menu of its own", async (t) => {
        const { telegramApiService, telegramCommandMenus } =
            await buildTelegramBotServiceTestApp(buildMenuAppOptions(t));
        const user = await insertUser({
            telegramId: "987654608",
            commandMenu: "unknown",
        });

        await telegramCommandMenus.syncUser(user);

        assert.equal(telegramApiService.deleteMyCommands.mock.callCount(), 1);
        assert.equal((await readUser(user)).commandMenu, undefined);
    });

    void it("doesn't set chat commands for banned users", async (t) => {
        const { telegramApiService, telegramCommandMenus } =
            await buildTelegramBotServiceTestApp(buildMenuAppOptions(t));

        await telegramCommandMenus.syncUser(
            await insertUser({
                telegramId: "987654604",
                isBanned: true,
                grants: ["vip"],
            }),
        );

        assert.equal(telegramApiService.setMyCommands.mock.callCount(), 0);
    });

    void it("sets the menu of the bot on preview when the webhook is refreshed and keeps a chat menu that did not change", async (t) => {
        const { telegramApiService, telegramBotService, telegramCommandMenus } =
            await buildTelegramBotServiceTestApp({
                ...buildMenuAppOptions(t),
                environment: "preview",
            });
        const user = await insertUser({
            telegramId: "987654605",
            grants: ["vip"],
        });
        const readScopes = () =>
            telegramApiService.setMyCommands.mock.calls.map(
                (call) => call.arguments[0].scope?.type ?? "default",
            );

        await telegramCommandMenus.syncUser(user);
        await telegramBotService.refreshWebhooks();
        await telegramBotService.refreshWebhooks();
        await telegramCommandMenus.syncUser(await readUser(user));

        assert.deepEqual(readScopes(), [
            "chat",
            ...Array.from({ length: 8 }, () => "default"),
        ]);
    });

    void it("logs a rejected chat menu, keeps going and tries again next time", async (t) => {
        const logs = createLoggerCollector();
        const telegramApiService = buildTelegramApiServiceMock({ t });
        const { telegramCommandMenus } = await buildTelegramBotServiceTestApp({
            ...buildMenuAppOptions(t),
            telegramApiService,
            logger: logs.logger,
        });
        const user = await insertUser({
            telegramId: "987654606",
            grants: ["vip"],
        });

        telegramApiService.setMyCommands.mock.mockImplementationOnce(
            async () => ({
                ok: false,
                error_code: 400,
                description: "Bad Request",
            }),
        );

        await telegramCommandMenus.syncUser(user);
        await telegramCommandMenus.syncUser(await readUser(user));

        assert.equal(telegramApiService.setMyCommands.mock.callCount(), 2);
        assert.ok(
            logs
                .readEntries()
                .some(
                    (entry) =>
                        entry.msg === "Failed to set telegram chat commands",
                ),
        );
    });
});

async function insertUser(overrides: Partial<UserEntity>): Promise<UserEntity> {
    const user = buildUserEntity(overrides);

    await mongo.collection<UserEntity>("users").insertOne(user);

    return user;
}

async function readUser({ _id }: UserEntity): Promise<UserEntity> {
    const user = await mongo.collection<UserEntity>("users").findOne({ _id });

    assert.ok(user);

    return user;
}

function buildMenuAppOptions(
    t: BuildTelegramBotServiceTestAppOptions["t"],
): BuildTelegramBotServiceTestAppOptions {
    return {
        databaseName,
        mongoClient,
        t,
        registerRoutes: (router) => {
            router.command("help", async () => undefined, {
                description: (translate) =>
                    translate("telegram:nothingToCancel"),
            });
            router.command("secret", async () => undefined, {
                description: (translate) => translate("telegram:error"),
                guard: (user) => user.grants.includes("vip"),
            });
        },
    };
}

function buildExpectedCommands(language: Language) {
    return [
        {
            command: "cancel",
            description: telegramLocales[language].cancelCommand,
        },
        {
            command: "help",
            description: telegramLocales[language].nothingToCancel,
        },
    ];
}
