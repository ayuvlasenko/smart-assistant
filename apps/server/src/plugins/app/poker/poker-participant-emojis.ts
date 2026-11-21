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

export function pickPokerParticipantEmoji(
    takenByPreference: string[][],
): string {
    const pool =
        takenByPreference
            .map((taken) =>
                pokerParticipantEmojis.filter(
                    (emoji) => !taken.includes(emoji),
                ),
            )
            .find((free) => free.length) ?? pokerParticipantEmojis;

    return pool[randomInt(pool.length)] ?? "🙂";
}
