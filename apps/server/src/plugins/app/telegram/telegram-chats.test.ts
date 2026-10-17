import { Type } from "@sinclair/typebox";
import Emittery from "emittery";
import { Db, MongoClient } from "mongodb";
import assert from "node:assert/strict";
import {
    after,
    before,
    beforeEach,
    describe,
    it,
    TestContext,
} from "node:test";
import { setTimeout } from "node:timers/promises";
import { requestLogSerializers } from "../../../request-logging.js";
import { createLogCollector } from "../../../test/log-collector.js";
import { buildTestMongo } from "../../../test/mongo.js";
import { buildTelegramBotServiceTestApp } from "../../../test/telegram-bot-service-helper.js";
import { buildTelegramPrivateChat } from "../../../test/telegram-fixtures.js";
import {
    buildTelegramSceneBot,
    TelegramSceneBot,
} from "../../../test/telegram-scene-bot.js";
import { telegramSceneTopicIndex } from "./telegram-scene-storage.js";
import { defineScene } from "./telegram-scene.js";
import { TelegramSessionStore } from "./telegram-session-store.js";

interface RoomEvents {
    "test.roomChanged": TestRoom;
    "test.roomRevealed": TestRoom;
}

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

void describe("TelegramChats", () => {
    void it("refuses to start with an invalid time zone", async (t) => {
        await assert.rejects(
            () =>
                buildTelegramBotServiceTestApp({
                    databaseName,
                    mongoClient,
                    t,
                    env: { TIME_ZONE: "Mars/Base" },
                }),
            { message: 'TIME_ZONE "Mars/Base" is not a valid time zone' },
        );
    });

    void it("redraws the scene of every participant when an event arrives", async (t) => {
        const room = buildRoom([987654450, 987654451]);
        const bot = await buildRoomBot(t, room);
        const [ada, bob] = room.participantIds.map((id) =>
            buildTelegramPrivateChat({ id }),
        );

        assert.ok(ada && bob);

        await bot.sendText(ada, "/room");
        await bot.sendText(bob, "/room");
        await bot.pressButton(ada, "Vote");
        await bot.telegramChats.idle();

        assert.deepEqual(readEditedTexts(bot), [
            { chat: ada.id, text: "Votes 1" },
            { chat: bob.id, text: "Votes 1" },
        ]);
    });

    void it("measures the recipients of a delivery and the time to update each of them", async (t) => {
        const room = buildRoom([987654454, 987654455]);
        const bot = await buildRoomBot(t, room);
        const [ada, bob] = room.participantIds.map((id) =>
            buildTelegramPrivateChat({ id }),
        );

        assert.ok(ada && bob);

        await bot.sendText(ada, "/room");
        await bot.sendText(bob, "/room");
        await bot.pressButton(ada, "Vote");
        await bot.telegramChats.idle();

        const output = await bot.metrics.metrics();

        assert.match(
            output,
            /^telegram_delivery_recipients_sum\{kind="deliver"\} 2$/m,
        );
        assert.match(
            output,
            /^telegram_delivery_duration_seconds_count\{kind="deliver"\} 2$/m,
        );
        assert.match(
            output,
            /^telegram_delivery_recipients_in_flight\{kind="deliver"\} 0$/m,
        );
    });

    void it("skips a participant without the scene", async (t) => {
        const room = buildRoom([987654452, 987654453]);
        const bot = await buildRoomBot(t, room);
        const [ada, bob] = room.participantIds.map((id) =>
            buildTelegramPrivateChat({ id }),
        );

        assert.ok(ada && bob);

        await bot.allowUser(bob.id);
        await bot.sendText(ada, "/room");
        await bot.pressButton(ada, "Vote");
        await bot.telegramChats.idle();

        assert.deepEqual(readEditedTexts(bot), [
            { chat: ada.id, text: "Votes 1" },
        ]);
    });

    void it("sends a message to a participant from an event handler", async (t) => {
        const room = buildRoom([987654454, 987654455]);
        const bot = await buildRoomBot(t, room);
        const [ada, bob] = room.participantIds.map((id) =>
            buildTelegramPrivateChat({ id }),
        );

        assert.ok(ada && bob);

        await bot.sendText(ada, "/room");
        await bot.sendText(bob, "/room");
        await bot.pressButton(ada, "Reveal");
        await bot.telegramChats.idle();

        assert.deepEqual(
            bot.telegramApiService.sendMessage.mock.calls
                .map((call) => call.arguments[0])
                .filter(({ text }) => text === "Results are open")
                .map(({ chat_id: chatId }) => Number(chatId))
                .sort((left, right) => left - right),
            [ada.id, bob.id],
        );
    });

    void it("delivers to the other participants when one of them fails", async (t) => {
        const logs = createLogCollector();
        const room = buildRoom([987654456, 987654457, 987654458]);
        const bot = await buildRoomBot(t, room, logs.logger);
        const [ada, bob, carl] = room.participantIds.map((id) =>
            buildTelegramPrivateChat({ id }),
        );

        assert.ok(ada && bob && carl);

        await bot.sendText(ada, "/room");
        await bot.sendText(bob, "/room");
        await bot.sendText(carl, "/room");
        room.failingUserId = ada.id;
        await bot.pressButton(bob, "Vote");
        await bot.telegramChats.idle();

        assert.deepEqual(readEditedTexts(bot), [
            { chat: bob.id, text: "Votes 1" },
            { chat: carl.id, text: "Votes 1" },
        ]);
        assert.ok(
            logs
                .readEntries()
                .some(
                    (entry) => entry.msg === "Failed to deliver a scene update",
                ),
        );
    });

    void it("redraws only the scenes that watch a published topic", async (t) => {
        const boards = { a: 0, b: 0 };
        const bot = await buildBoardBot(t, boards);
        const ada = buildTelegramPrivateChat({ id: 987654460 });
        const bob = buildTelegramPrivateChat({ id: 987654461 });

        await bot.sendText(ada, "/board");
        await bot.sendText(bob, "/board");
        await bot.pressButton(bob, "Open b");
        bot.telegramApiService.editMessageText.mock.resetCalls();
        boards.a = 1;
        boards.b = 1;
        bot.telegramChats.publish(["board:a"]);
        await bot.telegramChats.idle();

        assert.deepEqual(readEditedTexts(bot), [
            { chat: ada.id, text: "Board a: 1" },
        ]);
    });

    void it("stops redrawing a scene that switched away or ended", async (t) => {
        const boards = { a: 0, b: 0 };
        const bot = await buildBoardBot(t, boards);
        const ada = buildTelegramPrivateChat({ id: 987654462 });
        const bob = buildTelegramPrivateChat({ id: 987654463 });

        await bot.sendText(ada, "/board");
        await bot.sendText(bob, "/board");
        await bot.pressButton(ada, "Open b");
        await bot.pressButton(bob, "Close");
        bot.telegramApiService.editMessageText.mock.resetCalls();
        boards.a = 1;
        bot.telegramChats.publish(["board:a"]);
        await bot.telegramChats.idle();

        assert.deepEqual(readEditedTexts(bot), []);
        assert.deepEqual(await readWatchers(bot, "board:a"), []);
        assert.deepEqual(await readWatchers(bot, "board:b"), [ada.id]);
    });

    void it("forgets a watching scene after its TTL", async (t) => {
        const boards = { a: 0, b: 0 };
        const bot = await buildBoardBot(t, boards, { ttl: 300 });
        const ada = buildTelegramPrivateChat({ id: 987654464 });

        await bot.sendText(ada, "/board");

        assert.deepEqual(await readWatchers(bot, "board:a"), [ada.id]);

        await setTimeout(500);

        assert.deepEqual(await readWatchers(bot, "board:a"), []);

        bot.telegramApiService.editMessageText.mock.resetCalls();
        boards.a = 1;
        bot.telegramChats.publish(["board:a"]);
        await bot.telegramChats.idle();

        assert.deepEqual(readEditedTexts(bot), []);
    });

    void it("redraws a scene once when it watches several published topics", async (t) => {
        const boards = { a: 0, b: 0 };
        const bot = await buildBoardBot(t, boards);
        const ada = buildTelegramPrivateChat({ id: 987654465 });

        await bot.sendText(ada, "/board");
        await bot.pressButton(ada, "Open both");
        bot.telegramApiService.editMessageText.mock.resetCalls();
        boards.a = 1;
        boards.b = 1;
        bot.telegramChats.publish(["board:a", "board:b"]);
        await bot.telegramChats.idle();

        assert.deepEqual(readEditedTexts(bot), [
            { chat: ada.id, text: "Board a: 1, b: 1" },
        ]);
    });

    void it("waits for the running update of a watcher and keeps its state", async (t) => {
        const boards: TestBoards = { a: 0, b: 0 };
        const bot = await buildBoardBot(t, boards);
        const ada = buildTelegramPrivateChat({ id: 987654471 });
        const entered = Promise.withResolvers<void>();
        const gate = Promise.withResolvers<void>();

        await bot.sendText(ada, "/board");
        boards.slowSwitch = { entered, gate: gate.promise };
        bot.telegramApiService.editMessageText.mock.resetCalls();

        const press = bot.pressButton(ada, "Slow b");

        await entered.promise;
        boards.a = 1;
        boards.b = 1;
        bot.telegramChats.publish(["board:a"]);

        try {
            await setTimeout(200);

            assert.deepEqual(readEditedTexts(bot), []);
        } finally {
            gate.resolve();
            await press;
        }

        await bot.telegramChats.idle();

        assert.deepEqual(readEditedTexts(bot), [
            { chat: ada.id, text: "Board b: 1" },
        ]);
        assert.deepEqual(await readWatchers(bot, "board:a"), []);
        assert.deepEqual(await readWatchers(bot, "board:b"), [ada.id]);
    });

    void it("skips a watcher who fails the guard of the scene or is banned", async (t) => {
        const boards: TestBoards = { a: 0, b: 0 };
        const bot = await buildBoardBot(t, boards);
        const ada = buildTelegramPrivateChat({ id: 987654466 });
        const bob = buildTelegramPrivateChat({ id: 987654467 });
        const carl = buildTelegramPrivateChat({ id: 987654468 });

        await bot.sendText(ada, "/board");
        await bot.sendText(bob, "/board");
        await bot.sendText(carl, "/board");
        boards.blockedUserId = bob.id;
        await mongo
            .collection("users")
            .updateOne(
                { telegramId: String(carl.id) },
                { $set: { isBanned: true } },
            );
        bot.telegramApiService.editMessageText.mock.resetCalls();
        boards.a = 1;
        bot.telegramChats.publish(["board:a"]);
        await bot.telegramChats.idle();

        assert.deepEqual(readEditedTexts(bot), [
            { chat: ada.id, text: "Board a: 1" },
        ]);
    });

    void it("publishes to the other watchers when one of them fails", async (t) => {
        const logs = createLogCollector();
        const boards: TestBoards = { a: 0, b: 0 };
        const bot = await buildBoardBot(t, boards, { logger: logs.logger });
        const ada = buildTelegramPrivateChat({ id: 987654469 });
        const bob = buildTelegramPrivateChat({ id: 987654470 });

        await bot.sendText(ada, "/board");
        await bot.sendText(bob, "/board");
        boards.failingUserId = ada.id;
        bot.telegramApiService.editMessageText.mock.resetCalls();
        boards.a = 1;
        bot.telegramChats.publish(["board:a"]);
        await bot.telegramChats.idle();

        assert.deepEqual(readEditedTexts(bot), [
            { chat: bob.id, text: "Board a: 1" },
        ]);
        assert.ok(
            logs
                .readEntries()
                .some(
                    (entry) => entry.msg === "Failed to publish a scene update",
                ),
        );
        assert.match(
            await bot.metrics.metrics(),
            /^telegram_scene_events_total\{scene="board",event="delivery_failed"\} 1$/m,
        );
    });
});

interface TestBoards {
    a: number;
    b: number;
    blockedUserId?: number;
    failingUserId?: number;
    slowSwitch?: {
        entered: PromiseWithResolvers<void>;
        gate: Promise<void>;
    };
}

async function buildBoardBot(
    t: TestContext,
    boards: TestBoards,
    {
        ttl = 60_000,
        logger,
    }: {
        ttl?: number;
        logger?: ReturnType<typeof createLogCollector>["logger"];
    } = {},
): Promise<TelegramSceneBot> {
    const boardView = Type.Union([
        Type.Literal("a"),
        Type.Literal("b"),
        Type.Literal("both"),
    ]);
    const boardScene = defineScene({
        name: "board",
        state: Type.Object({ view: boardView }),
        key: () => "board",
        ttl,
        guard: (user) => user.telegramId !== String(boards.blockedUserId),
        watch: ({ view }) =>
            (view === "both" ? ["a", "b"] : [view]).map(
                (name) => `board:${name}`,
            ),
        slots: {
            board: async (ctx, scene) => {
                if (ctx.user.telegramId === String(boards.failingUserId)) {
                    throw new Error("Render failed");
                }

                return {
                    kind: "text",
                    text:
                        scene.state.view === "both"
                            ? `Board a: ${boards.a}, b: ${boards.b}`
                            : `Board ${scene.state.view}: ${boards[scene.state.view]}`,
                    keyboard: [
                        [
                            scene.button("Open b", "open", "b"),
                            scene.button("Open both", "open", "both"),
                            scene.button("Close", "close", null),
                            scene.button("Slow b", "slowSwitch", null),
                        ],
                    ],
                };
            },
        },
        buttons: {
            open: {
                value: boardView,
                handle: async (ctx, scene, view) => {
                    scene.state.view = view;
                },
            },
            close: {
                value: Type.Null(),
                handle: (ctx, scene) => scene.end(),
            },
            slowSwitch: {
                value: Type.Null(),
                handle: async (ctx, scene) => {
                    boards.slowSwitch?.entered.resolve();
                    await boards.slowSwitch?.gate;
                    scene.state.view = "b";
                },
            },
        },
    });

    return buildTelegramSceneBot({
        databaseName,
        mongoClient,
        t,
        logger: logger
            ? { ...logger, serializers: requestLogSerializers }
            : false,
        registerRoutes: (router, sceneEngine) => {
            router.scene(boardScene);
            router.command("board", (ctx) =>
                sceneEngine.start(ctx, boardScene, { view: "a" }),
            );
        },
    });
}

interface TestRoom {
    id: string;
    participantIds: number[];
    votes: number;
    failingUserId?: number;
}

function buildRoom(participantIds: number[]): TestRoom {
    return { id: `room-${participantIds[0]}`, participantIds, votes: 0 };
}

async function buildRoomBot(
    t: TestContext,
    room: TestRoom,
    logger?: ReturnType<typeof createLogCollector>["logger"],
): Promise<TelegramSceneBot> {
    const roomEvents = new Emittery<RoomEvents>();
    const roomTargets = ({ id, participantIds }: TestRoom) =>
        participantIds.map((userId) => ({ userId, key: id }));
    const roomScene = defineScene({
        name: "room",
        state: Type.Object({ roomId: Type.String() }),
        key: (state) => state.roomId,
        ttl: 60_000,
        slots: {
            card: async (ctx, scene) => ({
                kind: "text",
                text: `Votes ${room.votes}`,
                keyboard: [
                    [
                        scene.button("Vote", "vote", null),
                        scene.button("Reveal", "reveal", null),
                    ],
                ],
            }),
        },
        buttons: {
            vote: {
                value: Type.Null(),
                handle: async () => {
                    room.votes += 1;
                    await roomEvents.emit("test.roomChanged", room);
                },
            },
            reveal: {
                value: Type.Null(),
                handle: async () => {
                    await roomEvents.emit("test.roomRevealed", room);
                },
            },
        },
    });
    const bot = await buildTelegramSceneBot({
        databaseName,
        mongoClient,
        t,
        logger: logger
            ? { ...logger, serializers: requestLogSerializers }
            : false,
        registerRoutes: (router, sceneEngine) => {
            router.scene(roomScene);
            router.command("room", (ctx) =>
                sceneEngine.start(ctx, roomScene, { roomId: room.id }),
            );
        },
    });

    roomEvents.on("test.roomChanged", ({ data }) => {
        bot.telegramChats.deliver(roomScene, roomTargets(data), async (ctx) => {
            if (ctx.user.telegramId === String(data.failingUserId)) {
                throw new Error("Delivery failed");
            }
        });
    });
    roomEvents.on("test.roomRevealed", ({ data }) => {
        bot.telegramChats.deliver(roomScene, roomTargets(data), (ctx) =>
            ctx.reply("Results are open"),
        );
    });

    return bot;
}

async function readWatchers(
    bot: TelegramSceneBot,
    topic: string,
): Promise<number[]> {
    const matches = await bot.app
        .getDecorator<TelegramSessionStore>("telegramSessionStore")
        .findIndexed(telegramSceneTopicIndex(topic));

    return matches.map(({ userId }) => userId);
}

function readEditedTexts(
    bot: TelegramSceneBot,
): { chat: number | string | undefined; text: string | undefined }[] {
    return bot.telegramApiService.editMessageText.mock.calls
        .map((call) => ({
            chat: call.arguments[0].chat_id,
            text: call.arguments[0].text,
        }))
        .sort((left, right) => Number(left.chat) - Number(right.chat));
}
