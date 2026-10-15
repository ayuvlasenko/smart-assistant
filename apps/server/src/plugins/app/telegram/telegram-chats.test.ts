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
import { requestLogSerializers } from "../../../constants/options.js";
import { createLogCollector } from "../../../test/log-collector.js";
import { buildTestMongo } from "../../../test/mongo.js";
import { buildTelegramBotServiceTestApp } from "../../../test/telegram-bot-service-helper.js";
import { buildTelegramPrivateChat } from "../../../test/telegram-fixtures.js";
import {
    buildTelegramSceneBot,
    TelegramSceneBot,
} from "../../../test/telegram-scene-bot.js";
import { defineScene } from "./telegram-scene.js";

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
});

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
