import { formatDate } from "../../../utils/parsers.js";

export function escapeTelegramHtml(text: string): string {
    return text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
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
