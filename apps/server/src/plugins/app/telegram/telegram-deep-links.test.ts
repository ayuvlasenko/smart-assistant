import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    buildTelegramDeepLink,
    parseTelegramDeepLink,
} from "./telegram-deep-links.js";

void describe("Telegram deep links", () => {
    void it("splits the payload at the first underscore", () => {
        assert.deepEqual(parseTelegramDeepLink("invite_Ab_3-x"), {
            name: "invite",
            value: "Ab_3-x",
        });
    });

    void it("finds no deep link in a payload without a name or a value", () => {
        assert.equal(parseTelegramDeepLink("invite"), undefined);
        assert.equal(parseTelegramDeepLink("invite_"), undefined);
        assert.equal(parseTelegramDeepLink("Invite_abc"), undefined);
        assert.equal(parseTelegramDeepLink(""), undefined);
    });

    void it("builds the payload that it parses back", () => {
        const payload = buildTelegramDeepLink({
            name: "poker",
            value: "t_1-2",
        });

        assert.equal(payload, "poker_t_1-2");
        assert.deepEqual(parseTelegramDeepLink(payload), {
            name: "poker",
            value: "t_1-2",
        });
    });

    void it("refuses a payload that Telegram does not accept", () => {
        assert.throws(
            () =>
                buildTelegramDeepLink({
                    name: "invite",
                    value: "a".repeat(58),
                }),
            /within 64 characters/,
        );
        assert.equal(
            buildTelegramDeepLink({ name: "invite", value: "a".repeat(57) })
                .length,
            64,
        );
        assert.throws(
            () => buildTelegramDeepLink({ name: "invite", value: "a b" }),
            /\[A-Za-z0-9_-\]/,
        );
        assert.throws(
            () => buildTelegramDeepLink({ name: "join-poker", value: "1" }),
            /must match/,
        );
    });
});
