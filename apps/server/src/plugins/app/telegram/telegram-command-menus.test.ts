import { Db, MongoClient } from "mongodb";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createLogCollector } from "../../../test/log-collector.js";
import { buildTestMongo } from "../../../test/mongo.js";
import { buildTelegramApiServiceMock } from "../../../test/telegram-api-service-mock.js";
import {
    buildTelegramBotServiceTestApp,
    BuildTelegramBotServiceTestAppOptions,
    buildTwoBotsTestApp,
} from "../../../test/telegram-bot-service-helper.js";
import { buildUserEntity } from "../../../test/user-fixtures.js";
import { Language } from "../i18n-service.js";
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
        const logs = createLogCollector();
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

    void it("counts a set menu and an unchanged one", async (t) => {
        const { metrics, telegramCommandMenus } =
            await buildTelegramBotServiceTestApp(buildMenuAppOptions(t));
        const user = buildUserEntity({ telegramId: "987654609" });

        await telegramCommandMenus.sync(user);
        await telegramCommandMenus.sync(user);

        const output = await metrics.metrics();

        assert.match(
            output,
            /^telegram_command_menu_syncs_total\{result="set"\} 1$/m,
        );
        assert.match(
            output,
            /^telegram_command_menu_syncs_total\{result="unchanged"\} 1$/m,
        );
    });

    void it("sets the commands that the user's grants allow in the user's language for the chat", async (t) => {
        const { telegramApiService, telegramCommandMenus } =
            await buildTelegramBotServiceTestApp(buildMenuAppOptions(t));

        await telegramCommandMenus.sync(
            buildUserEntity({
                telegramId: "987654601",
                languageCode: "uk",
                grants: ["vip"],
            }),
        );
        await telegramCommandMenus.sync(
            buildUserEntity({ telegramId: "987654602" }),
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
                [
                    {
                        commands: buildExpectedCommands("en"),
                        scope: { type: "chat", chat_id: 987654602 },
                    },
                ],
            ],
        );
    });

    void it("sets the chat commands again only when they change", async (t) => {
        const { telegramApiService, telegramCommandMenus } =
            await buildTelegramBotServiceTestApp(buildMenuAppOptions(t));
        const user = buildUserEntity({ telegramId: "987654603" });

        await telegramCommandMenus.sync(user);
        await telegramCommandMenus.sync(user);
        await telegramCommandMenus.sync({ ...user, grants: ["vip"] });
        await telegramCommandMenus.sync({ ...user, languageCode: "ru" });

        assert.deepEqual(
            telegramApiService.setMyCommands.mock.calls.map(
                (call) => call.arguments[0].commands.length,
            ),
            [2, 3, 2],
        );
    });

    void it("doesn't set chat commands for banned users", async (t) => {
        const { telegramApiService, telegramCommandMenus } =
            await buildTelegramBotServiceTestApp(buildMenuAppOptions(t));

        await telegramCommandMenus.sync(
            buildUserEntity({ telegramId: "987654604", isBanned: true }),
        );

        assert.equal(telegramApiService.setMyCommands.mock.callCount(), 0);
    });

    void it("sets the chat commands on preview again after the webhook is refreshed", async (t) => {
        const { telegramApiService, telegramBotService, telegramCommandMenus } =
            await buildTelegramBotServiceTestApp({
                ...buildMenuAppOptions(t),
                environment: "preview",
            });
        const user = buildUserEntity({ telegramId: "987654605" });
        const readScopes = () =>
            telegramApiService.setMyCommands.mock.calls.map(
                (call) => call.arguments[0].scope?.type ?? "default",
            );

        await telegramCommandMenus.sync(user);
        await telegramCommandMenus.sync(user);

        assert.deepEqual(readScopes(), ["chat"]);

        await telegramBotService.refreshWebhooks();
        await telegramCommandMenus.sync(user);
        await telegramCommandMenus.sync(user);

        assert.deepEqual(readScopes(), [
            "chat",
            "default",
            "default",
            "default",
            "default",
            "chat",
        ]);
    });

    void it("logs a rejected chat menu, keeps going and tries again next time", async (t) => {
        const logs = createLogCollector();
        const telegramApiService = buildTelegramApiServiceMock({ t });
        const { telegramCommandMenus } = await buildTelegramBotServiceTestApp({
            ...buildMenuAppOptions(t),
            telegramApiService,
            logger: logs.logger,
        });
        const user = buildUserEntity({ telegramId: "987654606" });

        telegramApiService.setMyCommands.mock.mockImplementationOnce(
            async () => ({
                ok: false,
                error_code: 400,
                description: "Bad Request",
            }),
        );

        await telegramCommandMenus.sync(user);
        await telegramCommandMenus.sync(user);

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
