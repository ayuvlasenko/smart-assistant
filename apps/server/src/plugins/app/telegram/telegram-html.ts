import { InlineKeyboardButton } from "@grammyjs/types";
import { formatDate } from "./telegram-parsers.js";
import { TelegramMessageContent } from "./telegram-responder.js";

export const telegramMessageTextLimit = 4096;

const cutMarker = "…";

export function buildTelegramHtmlMessage(
    lines: string[],
    keyboard: InlineKeyboardButton[][],
): TelegramMessageContent {
    return {
        kind: "text",
        parse_mode: "HTML",
        text: fitTelegramHtmlLines(lines).join("\n"),
        keyboard: keyboard.filter((row) => row.length),
    };
}

export function escapeTelegramHtml(text: string): string {
    return text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

export function measureTelegramHtml(html: string): number {
    const [text = "", ...tagged] = html.split("<");

    return [text, ...tagged.map((part) => part.slice(part.indexOf(">") + 1))]
        .join("")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&amp;", "&").length;
}

export function formatTelegramHtmlBold(text: string): string {
    return `<b>${escapeTelegramHtml(text)}</b>`;
}

export function formatTelegramHtmlLabeled(
    label: string,
    value: string,
): string {
    return `${escapeTelegramHtml(label)}: ${escapeTelegramHtml(value)}`;
}

export function formatTelegramHtmlTime(date: Date, timeZone: string): string {
    const unixTime = Math.floor(date.getTime() / 1000);

    return `<tg-time unix="${unixTime}" format="dt">${formatDate(date, timeZone)}</tg-time>`;
}

export function formatTelegramHtmlMention(
    userId: number,
    name: string,
): string {
    return `<a href="tg://user?id=${userId}">${escapeTelegramHtml(name)}</a>`;
}

function fitTelegramHtmlLines(lines: string[]): string[] {
    if (measureTelegramHtml(lines.join("\n")) <= telegramMessageTextLimit) {
        return lines;
    }

    const fitted = [...lines];

    while (
        fitted.length &&
        measureTelegramHtml([...fitted, cutMarker].join("\n")) >
            telegramMessageTextLimit
    ) {
        fitted.pop();
    }

    return [...fitted, cutMarker];
}
