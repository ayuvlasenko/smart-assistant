import Fastify from "fastify";
import { ObjectId } from "mongodb";
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { buildUserEntity } from "../../../test/user-fixtures.js";
import i18nPlugin, { I18nService, Translate } from "../i18n-service.js";
import { UserEntity } from "../users/user-entity.js";
import { pokerLocales } from "./poker-locales.js";
import { describePokerParticipants } from "./poker-participant-labels.js";
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

function buildRoom(participants: [UserEntity, string][]): PokerRoomEntity {
    const now = new Date();

    return {
        _id: new ObjectId(),
        version: 0,
        createdAt: now,
        updatedAt: now,
        botId: "1",
        token: "token",
        createdBy: new ObjectId(),
        deck: "fibonacciModified",
        autoReveal: null,
        lastActivityAt: now,
        participants: participants.map(([user, emoji]) => ({
            userId: user._id,
            emoji,
            role: "voter" as const,
            joinedAt: now,
        })),
        round: { number: 1, status: "voting", votes: {}, startedAt: now },
        rounds: [],
    };
}
