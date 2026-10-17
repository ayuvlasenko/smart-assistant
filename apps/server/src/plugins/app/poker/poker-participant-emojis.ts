import { randomInt } from "node:crypto";

export const pokerParticipantEmojis = [
    "🦊",
    "🐼",
    "🐙",
    "🐻",
    "🐸",
    "🦉",
    "🐨",
    "🐧",
    "🐯",
    "🦁",
    "🐮",
    "🐷",
    "🐵",
    "🐰",
    "🐹",
    "🐶",
    "🐱",
    "🐭",
    "🦄",
    "🐝",
    "🦋",
    "🐢",
    "🦖",
    "🐳",
    "🐬",
    "🦀",
    "🦔",
    "🦦",
    "🦥",
    "🦩",
    "🦜",
    "🐿️",
    "🦘",
    "🦒",
    "🦓",
    "🐘",
    "🦛",
    "🐊",
    "🦭",
    "🐌",
];

export function pickPokerParticipantEmoji(taken: string[]): string {
    const free = pokerParticipantEmojis.filter(
        (emoji) => !taken.includes(emoji),
    );
    const pool = free.length ? free : pokerParticipantEmojis;

    return pool[randomInt(pool.length)] ?? "🙂";
}
