import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    buildTelegramHtmlMessage,
    escapeTelegramHtml,
    formatTelegramHtmlMention,
    formatTelegramHtmlTime,
    measureTelegramHtml,
    telegramMessageTextLimit,
} from "./telegram-html.js";

void describe("Telegram HTML", () => {
    void it("escapes the characters that Telegram HTML reserves", () => {
        assert.equal(
            escapeTelegramHtml("<b>Tom & Jerry</b>"),
            "&lt;b&gt;Tom &amp; Jerry&lt;/b&gt;",
        );
    });

    void it("formats a date as a time entity with a fallback in the time zone", () => {
        assert.equal(
            formatTelegramHtmlTime(
                new Date("2026-10-15T22:30:00Z"),
                "Asia/Dubai",
            ),
            '<tg-time unix="1792103400" format="dt">2026-10-16</tg-time>',
        );
    });

    void it("mentions a user by id and escapes the name", () => {
        assert.equal(
            formatTelegramHtmlMention(42, "<Ann>"),
            '<a href="tg://user?id=42">&lt;Ann&gt;</a>',
        );
    });

    void it("measures the text that Telegram shows, without tags and with one character per entity", () => {
        assert.equal(
            measureTelegramHtml("<b>Tom &amp; Jerry</b> &lt;3"),
            "Tom & Jerry <3".length,
        );
    });
});

void describe("buildTelegramHtmlMessage", () => {
    void it("drops the last lines of a text over the Telegram limit and marks the cut", () => {
        const lines = Array.from(
            { length: 200 },
            (_, index) => `<b>${index}</b> ${"x".repeat(40)}`,
        );
        const message = buildTelegramHtmlMessage(lines, []);

        assert.ok(message.kind === "text");
        assert.ok(
            measureTelegramHtml(message.text) <= telegramMessageTextLimit,
        );
        assert.ok(message.text.startsWith("<b>0</b>"));
        assert.ok(message.text.endsWith("\n…"));
    });

    void it("keeps a text within the limit as it is", () => {
        const message = buildTelegramHtmlMessage(
            ["<b>Room</b>", "", "🦊 Sasha ✅"],
            [],
        );

        assert.ok(message.kind === "text");
        assert.equal(message.text, "<b>Room</b>\n\n🦊 Sasha ✅");
    });

    void it("drops the empty rows of the keyboard", () => {
        const button = { text: "Back", callback_data: "back" };
        const message = buildTelegramHtmlMessage(["Text"], [[], [button], []]);

        assert.deepEqual(message.keyboard, [[button]]);
    });
});
