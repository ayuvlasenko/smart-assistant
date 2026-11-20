import { Translate } from "../i18n-service.js";
import {
    escapeTelegramHtml,
    formatTelegramHtmlBold,
} from "../telegram/telegram-html.js";
import { isPokerTitleTooLong, PokerRoomEntity } from "./poker-room-entity.js";
import {
    PokerAgreement,
    PokerCardVotes,
    PokerRoundSummary,
} from "./poker-round-summary.js";

const maxListedVoters = 10;
const agreementIcons: Record<PokerAgreement, string> = {
    none: "—",
    unanimous: "🎯",
    close: "👍",
    spread: "⚠️",
};

export function formatPokerHeader(
    room: PokerRoomEntity,
    timeZone: string,
    status: string,
): string {
    return `${formatTelegramHtmlBold(formatPokerRoomTitle(room, timeZone))} · ${escapeTelegramHtml(status)}`;
}

export function formatPokerDistribution(
    summary: PokerRoundSummary,
    labels: Map<string, string>,
): string[] {
    return summary.distribution.map(
        (votes) =>
            `${formatTelegramHtmlBold(votes.card)} — ${escapeTelegramHtml(formatPokerVoters(votes, labels))}`,
    );
}

export function formatPokerRoomTitle(
    room: PokerRoomEntity,
    timeZone: string,
): string {
    return room.title ?? formatPokerRoomTime(room.createdAt, timeZone);
}

export function formatPokerRoomTime(date: Date, timeZone: string): string {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone,
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(date);
    const readPart = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((part) => part.type === type)?.value ?? "";

    return `${readPart("day")}.${readPart("month")} ${readPart("hour")}:${readPart("minute")}`;
}

export function formatPokerAgreement(
    t: Translate,
    summary: PokerRoundSummary,
    labels: Map<string, string>,
): string {
    switch (summary.agreement) {
        case "none":
            return t("poker:agreementNone");
        case "unanimous":
            return t("poker:agreementUnanimous");
        case "close":
            return t("poker:agreementClose");
        case "spread":
            return t("poker:agreementSpread", {
                low: formatVoters(summary.outliers?.low, labels),
                high: formatVoters(summary.outliers?.high, labels),
            });
    }
}

export function formatPokerAgreementIcon(summary: PokerRoundSummary): string {
    return agreementIcons[summary.agreement];
}

export function formatPokerStats(
    t: Translate,
    summary: PokerRoundSummary,
): string | undefined {
    if (summary.median === undefined || !summary.range) {
        return;
    }

    const { min, max } = summary.range;

    return [
        t("poker:median", { value: summary.median }),
        ...(summary.mode.length
            ? [t("poker:mode", { value: summary.mode.join(", ") })]
            : []),
        t("poker:range", { value: min === max ? min : `${min}–${max}` }),
    ].join(" · ");
}

export function formatPokerVoters(
    votes: PokerCardVotes,
    labels: Map<string, string>,
): string {
    const listed = votes.userIds
        .slice(0, maxListedVoters)
        .map((userId) => labels.get(userId) ?? userId);
    const hidden = votes.userIds.length - listed.length;

    return [...listed, ...(hidden ? [`+${hidden}`] : [])].join(", ");
}

export function validatePokerTitle(
    text: string,
    t: Translate,
    max: number,
): string | undefined {
    return isPokerTitleTooLong(text, max)
        ? t("poker:titleTooLong", { max })
        : undefined;
}

function formatVoters(
    votes: PokerCardVotes | undefined,
    labels: Map<string, string>,
): string {
    return votes ? `${formatPokerVoters(votes, labels)} (${votes.card})` : "";
}
