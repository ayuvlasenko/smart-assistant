import Fastify from "fastify";
import { ObjectId } from "mongodb";
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { buildUserEntity } from "../../../test/user-fixtures.js";
import i18nPlugin, { I18nService, Translate } from "../i18n-service.js";
import {
    measureTelegramHtml,
    telegramMessageTextLimit,
} from "../telegram/telegram-html.js";
import { UserEntity } from "../users/user-entity.js";
import {
    buildPokerMessage,
    describePokerParticipants,
    formatPokerRoomTime,
    formatPokerVoters,
} from "./poker-format.js";
import { pokerLocales } from "./poker-locales.js";
import { PokerRoomEntity } from "./poker-room-entity.js";

let t!: Translate;

before(async () => {
    const app = Fastify();

    await app.register(i18nPlugin);
    await app.ready();

    const i18nService = app.getDecorator<I18nService>("i18nService");

    i18nService.addLocales("poker", pokerLocales);
    t = i18nService.getT("en");
    await app.close();
});

void describe("describePokerParticipants", () => {
    void it("labels each participant with the emoji and the first name, and marks the viewer", () => {
        const sasha = buildUserEntity({ firstName: "Sasha" });
        const masha = buildUserEntity({ firstName: "Masha" });
        const labels = describePokerParticipants(
            t,
            buildRoom([
                [sasha, "🦊"],
                [masha, "🐼"],
            ]),
            [sasha, masha],
            masha._id,
        );

        assert.deepEqual([...labels.values()], ["🦊 Sasha", "🐼 Masha (you)"]);
    });

    void it("adds the username to a first name that two participants share", () => {
        const first = buildUserEntity({
            firstName: "Sasha",
            username: "sasha_k",
        });
        const second = buildUserEntity({ firstName: "Sasha" });
        const labels = describePokerParticipants(
            t,
            buildRoom([
                [first, "🦊"],
                [second, "🐼"],
            ]),
            [first, second],
            new ObjectId(),
        );

        assert.deepEqual(
            [...labels.values()],
            ["🦊 Sasha (@sasha_k)", "🐼 Sasha"],
        );
    });

    void it("cuts a long name by graphemes and falls back to the username", () => {
        const long = buildUserEntity({
            firstName: "Sasha 👨‍👩‍👧 Konstantinovich",
        });
        const nameless = buildUserEntity({ username: "nameless" });
        const missing = buildUserEntity();
        const labels = describePokerParticipants(
            t,
            buildRoom([
                [long, "🦊"],
                [nameless, "🐼"],
                [missing, "🐙"],
            ]),
            [long, nameless],
            new ObjectId(),
        );

        assert.deepEqual(
            [...labels.values()],
            ["🦊 Sasha 👨‍👩‍👧 Konstantinov…", "🐼 @nameless", "🐙 Participant"],
        );
    });
});

void describe("formatPokerVoters", () => {
    void it("lists ten voters and counts the rest", () => {
        const userIds = Array.from({ length: 13 }, (_, index) => `u${index}`);
        const labels = new Map(userIds.map((userId) => [userId, userId]));

        assert.equal(
            formatPokerVoters({ card: "5", userIds }, labels),
            "u0, u1, u2, u3, u4, u5, u6, u7, u8, u9, +3",
        );
    });
});

void describe("buildPokerMessage", () => {
    void it("drops the last lines of a text over the Telegram limit and marks the cut", () => {
        const lines = Array.from(
            { length: 200 },
            (_, index) => `<b>${index}</b> ${"x".repeat(40)}`,
        );
        const message = buildPokerMessage(lines, []);

        assert.ok(message.kind === "text");
        assert.ok(
            measureTelegramHtml(message.text) <= telegramMessageTextLimit,
        );
        assert.ok(message.text.startsWith("<b>0</b>"));
        assert.ok(message.text.endsWith("\n…"));
    });

    void it("keeps a text within the limit as it is", () => {
        const message = buildPokerMessage(
            ["<b>Room</b>", "", "🦊 Sasha ✅"],
            [],
        );

        assert.ok(message.kind === "text");
        assert.equal(message.text, "<b>Room</b>\n\n🦊 Sasha ✅");
    });
});

void describe("formatPokerRoomTime", () => {
    void it("formats the day, month and 24-hour time in the time zone", () => {
        const date = new Date("2026-12-31T19:15:00Z");

        assert.equal(formatPokerRoomTime(date, "UTC"), "31.12 19:15");
        assert.equal(formatPokerRoomTime(date, "Asia/Tokyo"), "01.01 04:15");
        assert.equal(
            formatPokerRoomTime(new Date("2026-03-05T00:05:00Z"), "UTC"),
            "05.03 00:05",
        );
    });
});

function buildRoom(participants: [UserEntity, string][]): PokerRoomEntity {
    const now = new Date();

    return {
        _id: new ObjectId(),
        version: 0,
        createdAt: now,
        updatedAt: now,
        token: "token",
        createdBy: new ObjectId(),
        deck: "fibonacciModified",
        autoReveal: false,
        lastActivityAt: now,
        participants: participants.map(([user, emoji]) => ({
            userId: user._id,
            emoji,
            joinedAt: now,
        })),
        round: { number: 1, status: "voting", votes: {}, startedAt: now },
        rounds: [],
    };
}
