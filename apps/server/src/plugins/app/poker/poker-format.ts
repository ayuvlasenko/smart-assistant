import { InlineKeyboardButton } from "@grammyjs/types";
import { ObjectId } from "mongodb";
import { Translate } from "../i18n-service.js";
import { escapeTelegramHtml } from "../telegram/telegram-html.js";
import { TelegramMessageContent } from "../telegram/telegram-responder.js";
import { UserEntity } from "../users/user-entity.js";
import { PokerDeckName } from "./poker-decks.js";
import { PokerRoomEntity } from "./poker-room-entity.js";
import {
    PokerAgreement,
    PokerCardVotes,
    PokerRoundSummary,
} from "./poker-round-summary.js";

const nameGraphemes = 20;
const agreementIcons: Record<PokerAgreement, string> = {
    none: "—",
    unanimous: "🎯",
    close: "👍",
    spread: "⚠️",
};
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function buildPokerMessage(
    lines: string[],
    keyboard: InlineKeyboardButton[][],
): TelegramMessageContent {
    return {
        kind: "text",
        parse_mode: "HTML",
        text: lines.join("\n"),
        keyboard: keyboard.filter((row) => row.length),
    };
}

export function formatBold(text: string): string {
    return `<b>${escapeTelegramHtml(text)}</b>`;
}

export function formatPokerHeader(
    room: PokerRoomEntity,
    timeZone: string,
    status: string,
): string {
    return `${formatBold(formatPokerRoomTitle(room, timeZone))} · ${escapeTelegramHtml(status)}`;
}

export function formatPokerDistribution(
    summary: PokerRoundSummary,
    labels: Map<string, string>,
): string[] {
    return summary.distribution.map(
        (votes) =>
            `${formatBold(votes.card)} — ${escapeTelegramHtml(formatPokerVoters(votes, labels))}`,
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

export function formatPokerDeckName(t: Translate, deck: PokerDeckName): string {
    switch (deck) {
        case "fibonacciShort":
            return t("poker:deckFibonacciShort");
        case "fibonacciModified":
            return t("poker:deckFibonacciModified");
        case "fibonacci":
            return t("poker:deckFibonacci");
        case "powersOfTwo":
            return t("poker:deckPowersOfTwo");
        case "tShirt":
            return t("poker:deckTShirt");
    }
}

export function describePokerParticipants(
    t: Translate,
    room: PokerRoomEntity,
    users: UserEntity[],
    viewerId: ObjectId,
): Map<string, string> {
    const named = room.participants.map((participant) => {
        const user = users.find(({ _id }) => _id.equals(participant.userId));

        return {
            participant,
            user,
            name: truncateName(
                user?.firstName ??
                    (user?.username ? `@${user.username}` : undefined) ??
                    t("poker:participant"),
            ),
        };
    });

    return new Map(
        named.map(({ participant, user, name }) => {
            const isNameShared =
                named.filter((other) => other.name === name).length > 1;
            const parts = [`${participant.emoji} ${name}`];

            if (isNameShared && user?.username && user.firstName) {
                parts.push(`(@${user.username})`);
            }

            if (participant.userId.equals(viewerId)) {
                parts.push(`(${t("poker:you")})`);
            }

            return [participant.userId.toHexString(), parts.join(" ")];
        }),
    );
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
    return votes.userIds
        .map((userId) => labels.get(userId) ?? userId)
        .join(", ");
}

export function validatePokerTitle(
    text: string,
    t: Translate,
    max: number,
): string | undefined {
    return [...graphemes.segment(text.trim())].length > max
        ? t("poker:titleTooLong", { max })
        : undefined;
}

export function inRowsOf<TItem>(size: number, items: TItem[]): TItem[][] {
    const rows: TItem[][] = [];

    for (let index = 0; index < items.length; index += size) {
        rows.push(items.slice(index, index + size));
    }

    return rows;
}

function truncateName(name: string): string {
    const parts = [...graphemes.segment(name)].map(({ segment }) => segment);

    return parts.length > nameGraphemes
        ? `${parts.slice(0, nameGraphemes).join("")}…`
        : name;
}

function formatVoters(
    votes: PokerCardVotes | undefined,
    labels: Map<string, string>,
): string {
    return votes ? `${formatPokerVoters(votes, labels)} (${votes.card})` : "";
}
