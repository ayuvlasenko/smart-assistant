import { Type } from "@sinclair/typebox";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { useTestMongo } from "../../../test/mongo.js";
import { buildTelegramSceneBot } from "../../../test/telegram-scene-bot.js";
import { registerGreetScene } from "../../../test/telegram-scene-fixtures.js";
import { defineScene } from "./telegram-scene.js";

const testMongo = useTestMongo();

void describe("TelegramSceneEngine", () => {
    void it("rejects a scene registered twice", async (t) => {
        await assert.rejects(
            () =>
                buildTelegramSceneBot({
                    testMongo,
                    t,
                    registerRoutes: (router, sceneEngine) => {
                        registerGreetScene(router, sceneEngine);
                        router.scene(
                            defineScene({
                                name: "greet",
                                state: Type.Object({}),
                                ttl: 60_000,
                            }),
                        );
                    },
                }),
            { message: 'Telegram scene "greet" is already registered' },
        );
    });
});
