import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    escapeTelegramHtml,
    formatTelegramHtmlMention,
    formatTelegramHtmlTime,
    measureTelegramHtml,
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
