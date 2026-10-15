import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    addDays,
    formatDate,
    isTimeZone,
    parseDate,
    parseNumber,
} from "./parsers.js";

const today = "2026-10-02";

void describe("parseNumber", () => {
    void it("parses integers, decimals, signs, spaces and decimal commas", () => {
        assert.equal(parseNumber("42"), 42);
        assert.equal(parseNumber("-12.5"), -12.5);
        assert.equal(parseNumber("+7"), 7);
        assert.equal(parseNumber("1 234,56"), 1234.56);
    });

    void it("rejects text, extra fraction digits and long integers", () => {
        assert.equal(parseNumber("abc"), undefined);
        assert.equal(parseNumber("1.234"), undefined);
        assert.equal(parseNumber("12e3"), undefined);
        assert.equal(parseNumber("1234567890123"), undefined);
        assert.equal(parseNumber("1.5", { maxFractionDigits: 0 }), undefined);
    });
});

void describe("parseDate", () => {
    void it("parses full, short and ISO dates", () => {
        assert.equal(parseDate("05.03.2026", today), "2026-03-05");
        assert.equal(parseDate("5/3/2026", today), "2026-03-05");
        assert.equal(parseDate("2026-03-05", today), "2026-03-05");
    });

    void it("fills the missing month and year from today", () => {
        assert.equal(parseDate("5.03", today), "2026-03-05");
        assert.equal(parseDate("7", today), "2026-10-07");
    });

    void it("rejects impossible dates and other text", () => {
        assert.equal(parseDate("31.02.2026", today), undefined);
        assert.equal(parseDate("tomorrow", today), undefined);
        assert.equal(parseDate("05.03.26", today), undefined);
    });
});

void describe("formatDate", () => {
    void it("formats the calendar date in the time zone", () => {
        const date = new Date(Date.UTC(2026, 9, 1, 22, 30));

        assert.equal(formatDate(date, "UTC"), "2026-10-01");
        assert.equal(formatDate(date, "Europe/Kyiv"), "2026-10-02");
    });
});

void describe("addDays", () => {
    void it("moves the date across month and year ends", () => {
        assert.equal(addDays("2026-10-01", -1), "2026-09-30");
        assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    });
});

void describe("isTimeZone", () => {
    void it("accepts IANA time zones and rejects other text", () => {
        assert.equal(isTimeZone("Europe/Kyiv"), true);
        assert.equal(isTimeZone("UTC"), true);
        assert.equal(isTimeZone("Mars/Base"), false);
    });
});
