import { ForbiddenError } from "@casl/ability";
import { Db, MongoClient } from "mongodb";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { buildTestMongo } from "../../../test/mongo.js";
import { buildTelegramBotServiceTestApp } from "../../../test/telegram-bot-service-helper.js";
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
    options: () => [
        { value: "red", title: () => "Red" },
        { value: "blue", title: () => "Blue" },
    ],
};
const admin = buildUserEntity({ grants: [adminGrant] });

void describe("SettingsService", () => {
    void it("reads the default value of a setting nobody changed", async (t) => {
        const settingsService = await buildSettings(t);

        assert.equal(settingsService.read(flag), true);
        assert.equal(settingsService.read(limit), 5);
        assert.deepEqual(settingsService.read(colours), []);
    });

    void it("stores a value of an admin and shows it to another pod after a refresh", async (t) => {
        const writer = await buildSettings(t);
        const reader = await buildSettings(t);

        await writer.write(admin, limit, 8);
        await writer.write(admin, colours, ["blue"]);

        assert.equal(writer.read(limit), 8);
        assert.equal(reader.read(limit), 5);

        await reader.refresh();

        assert.equal(reader.read(limit), 8);
        assert.deepEqual(reader.read(colours), ["blue"]);
    });

    void it("toggles against the stored value, also on a pod whose snapshot is stale", async (t) => {
        const first = await buildSettings(t);
        const stale = await buildSettings(t);

        await first.toggleChoice(admin, colours, "red");
        await stale.toggleChoice(admin, colours, "blue");
        await first.toggle(admin, flag);
        await stale.toggle(admin, flag);

        assert.deepEqual(stale.read(colours), ["red", "blue"]);
        assert.equal(stale.read(flag), true);

        await stale.toggleChoice(admin, colours, "red");
        await first.refresh();

        assert.deepEqual(first.read(colours), ["blue"]);
        assert.equal(first.read(flag), true);
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
        assert.equal(settingsService.read(flag), true);
    });

    void it("drops stored choices that are no longer offered and falls back from a broken value", async (t) => {
        const settingsService = await buildSettings(t);

        await mongo
            .collection<{ _id: string; value: unknown }>("settings")
            .insertMany([
                { _id: colours.name, value: ["red", "removed"] },
                { _id: limit.name, value: "many" },
            ]);
        await settingsService.refresh();

        assert.deepEqual(settingsService.read(colours), ["red"]);
        assert.equal(settingsService.read(limit), 5);
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
