import { ForbiddenError } from "@casl/ability";
import { Db, MongoClient } from "mongodb";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { buildTestMongo } from "../../../test/mongo.js";
import { buildTelegramBotServiceTestApp } from "../../../test/telegram-bot-service-helper.js";
import { testBotId } from "../../../test/telegram-fixtures.js";
import { buildUserEntity } from "../../../test/user-fixtures.js";
import { adminGrant } from "../access/access-service.js";
import {
    ChoicesSetting,
    FlagSetting,
    NumberSetting,
    SettingsService,
} from "./settings-service.js";

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
    await mongo.collection("settings").deleteMany({});
});

after(async () => {
    await mongo.dropDatabase();
    await mongoClient.close();
});

const flag: FlagSetting = {
    kind: "flag",
    name: "test.flag",
    title: () => "Flag",
    emoji: "🚩",
    defaultValue: true,
};
const limit: NumberSetting = {
    kind: "number",
    name: "test.limit",
    title: () => "Limit",
    emoji: "🔢",
    defaultValue: 5,
    min: 1,
    max: 10,
};
const colours: ChoicesSetting = {
    kind: "choices",
    name: "test.colours",
    title: () => "Colours",
    emoji: "🎨",
    defaultValue: [],
    options: () =>
        Promise.resolve([
            { value: "red", title: () => "Red" },
            { value: "blue", title: () => "Blue" },
        ]),
};
const admin = buildUserEntity({ grants: [adminGrant] });

void describe("SettingsService", () => {
    void it("reads the default value of a setting nobody changed", async (t) => {
        const settingsService = await buildSettings(t);

        assert.equal(await settingsService.read(flag, testBotId), true);
        assert.equal(await settingsService.read(limit, testBotId), 5);
        assert.deepEqual(await settingsService.read(colours, testBotId), []);
    });

    void it("stores a value of an admin and shows it to another pod at once", async (t) => {
        const writer = await buildSettings(t);
        const reader = await buildSettings(t);

        await writer.write(admin, limit, 8);
        await writer.write(admin, colours, ["blue"]);

        assert.equal(await writer.read(limit, testBotId), 8);
        assert.equal(await reader.read(limit, testBotId), 8);
        assert.deepEqual(await reader.read(colours, testBotId), ["blue"]);
    });

    void it("toggles against the stored value, whichever pod takes the press", async (t) => {
        const first = await buildSettings(t);
        const stale = await buildSettings(t);

        await first.toggleChoice(admin, colours, "red");
        await stale.toggleChoice(admin, colours, "blue");
        await first.toggle(admin, flag);
        await stale.toggle(admin, flag);

        assert.deepEqual(await stale.read(colours, testBotId), ["red", "blue"]);
        assert.equal(await stale.read(flag, testBotId), true);

        await stale.toggleChoice(admin, colours, "red");

        assert.deepEqual(await first.read(colours, testBotId), ["blue"]);
        assert.equal(await first.read(flag, testBotId), true);
        await assert.rejects(
            first.toggleChoice(admin, colours, "green"),
            /not an option/,
        );
        await assert.rejects(
            first.toggle(buildUserEntity(), flag),
            ForbiddenError,
        );
    });

    void it("refuses a user without the admin grant and a value out of the setting", async (t) => {
        const settingsService = await buildSettings(t);

        await assert.rejects(
            settingsService.write(buildUserEntity(), flag, false),
            ForbiddenError,
        );
        await assert.rejects(
            settingsService.write(admin, limit, 11),
            /not valid/,
        );
        await assert.rejects(
            settingsService.write(admin, colours, ["green"]),
            /not valid/,
        );
        assert.equal(await settingsService.read(flag, testBotId), true);
    });

    void it("keeps the values of every bot apart", async (t) => {
        const settingsService = await buildSettings(t);
        const otherAdmin = buildUserEntity({
            botId: "42",
            grants: [adminGrant],
        });

        await settingsService.write(admin, limit, 8);
        await settingsService.write(otherAdmin, limit, 3);
        await settingsService.toggle(otherAdmin, flag);

        assert.equal(await settingsService.read(limit, testBotId), 8);
        assert.equal(await settingsService.read(flag, testBotId), true);
        assert.equal(await settingsService.read(limit, "42"), 3);
        assert.equal(await settingsService.read(flag, "42"), false);

        assert.equal(await settingsService.read(limit, testBotId), 8);
        assert.equal(await settingsService.read(limit, "42"), 3);
    });

    void it("drops stored choices that are no longer offered and falls back from a broken value", async (t) => {
        const settingsService = await buildSettings(t);

        await mongo.collection("settings").insertMany([
            {
                botId: testBotId,
                name: colours.name,
                value: ["red", "removed"],
            },
            { botId: testBotId, name: limit.name, value: "many" },
        ]);

        assert.deepEqual(await settingsService.read(colours, testBotId), [
            "red",
        ]);
        assert.equal(await settingsService.read(limit, testBotId), 5);
    });
});

async function buildSettings(
    t: Parameters<typeof buildTelegramBotServiceTestApp>[0]["t"],
): Promise<SettingsService> {
    const { settingsService } = await buildTelegramBotServiceTestApp({
        databaseName,
        mongoClient,
        t,
    });

    settingsService.register({
        name: "test",
        title: () => "Test",
        settings: [flag, limit, colours],
    });

    return settingsService;
}
