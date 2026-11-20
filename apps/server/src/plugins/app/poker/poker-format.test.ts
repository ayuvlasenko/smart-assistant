import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPokerRoomTime, formatPokerVoters } from "./poker-format.js";

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
