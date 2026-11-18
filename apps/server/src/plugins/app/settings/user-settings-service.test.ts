import assert from "node:assert/strict";
import { describe, it, TestContext } from "node:test";
import { useTestMongo } from "../../../test/mongo.js";
import { buildTelegramBotServiceTestApp } from "../../../test/telegram-bot-service-helper.js";
import { buildUserEntity } from "../../../test/user-fixtures.js";
import { UserEntity } from "../users/user-entity.js";
import { languageOf, languageSetting } from "../users/user-language.js";
import {
    readUserChoice,
    UserChoiceSetting,
    UserSettingsService,
} from "./user-settings-service.js";

const testMongo = useTestMongo();

const theme: UserChoiceSetting = {
    kind: "choice",
    name: "test.theme",
    title: () => "Theme",
    emoji: "🎨",
    defaultValue: "light",
    options: () => [
        { value: "light", title: () => "Light" },
        { value: "dark", title: () => "Dark" },
    ],
};
const pace: UserChoiceSetting = {
    kind: "choice",
    name: "other.pace",
    title: () => "Pace",
    emoji: "⏱",
    defaultValue: "slow",
    options: () => [
        { value: "slow", title: () => "Slow" },
        { value: "fast", title: () => "Fast" },
    ],
};

void describe("UserSettingsService", () => {
    void it("reads the default of a setting the user did not change, and of a stored value that is no option", async (t) => {
        await buildUserSettings(t);

        const user = buildUserEntity({ settings: { test: { theme: "neon" } } });

        assert.equal(readUserChoice(theme, buildUserEntity()), "light");
        assert.equal(readUserChoice(theme, user), "light");
    });

    void it("writes every setting to its own field, so two writes at once keep both values", async (t) => {
        const userSettings = await buildUserSettings(t);
        const user = await insertUser();

        await Promise.all([
            userSettings.write(user, theme, "dark"),
            userSettings.write(user, pace, "fast"),
        ]);

        const stored = await readUser(user);

        assert.deepEqual(stored.settings, {
            test: { theme: "dark" },
            other: { pace: "fast" },
        });
        assert.equal(readUserChoice(theme, stored), "dark");
        assert.equal(readUserChoice(pace, stored), "fast");
    });

    void it("removes the field when the user returns to the default", async (t) => {
        const userSettings = await buildUserSettings(t);
        const user = await insertUser();

        await userSettings.write(user, pace, "fast");
        await userSettings.write(user, theme, "dark");

        const updated = await userSettings.write(user, theme, "light");

        assert.deepEqual(updated.settings, {
            test: {},
            other: { pace: "fast" },
        });
        assert.equal(updated.version, user.version + 3);
    });

    void it("refuses a value that is not an option and a name that is not <domain>.<name>", async (t) => {
        const userSettings = await buildUserSettings(t);
        const user = await insertUser();

        await assert.rejects(
            userSettings.write(user, theme, "neon"),
            /is not valid/,
        );
        assert.throws(() => {
            userSettings.register({
                name: "broken",
                title: () => "Broken",
                settings: [{ ...theme, name: "theme" }],
            });
        }, /must be named <domain>\.<name>/);
        assert.equal((await readUser(user)).settings, undefined);
    });

    void it("keeps the setting of a user away from the user of another bot with the same Telegram id", async (t) => {
        const userSettings = await buildUserSettings(t);
        const user = await insertUser();
        const twin = await insertUser({ botId: "second-bot" });

        await userSettings.write(user, languageSetting, "ru");

        assert.equal(languageOf(await readUser(user)), "ru");
        assert.equal(languageOf(await readUser(twin)), "en");
    });
});

async function buildUserSettings(t: TestContext): Promise<UserSettingsService> {
    const { app } = await buildTelegramBotServiceTestApp({
        testMongo,
        t,
    });

    return app.getDecorator<UserSettingsService>("userSettingsService");
}

async function insertUser(
    overrides: Partial<UserEntity> = {},
): Promise<UserEntity> {
    const user = buildUserEntity({ telegramId: "987655401", ...overrides });

    await testMongo.mongo.collection<UserEntity>("users").insertOne(user);

    return user;
}

async function readUser(user: UserEntity): Promise<UserEntity> {
    const stored = await testMongo.mongo
        .collection<UserEntity>("users")
        .findOne({ _id: user._id });

    assert.ok(stored);

    return stored;
}
