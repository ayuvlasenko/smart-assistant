import { PokerDeck } from "./poker-decks.js";
import { PokerRound } from "./poker-room-entity.js";

export interface PokerCardVotes {
    card: string;
    userIds: string[];
}

export type PokerAgreement = "none" | "unanimous" | "close" | "spread";

export interface PokerRoundSummary {
    distribution: PokerCardVotes[];
    agreement: PokerAgreement;
    median?: string;
    mode: string[];
    range?: { min: string; max: string };
    outliers?: { low: PokerCardVotes; high: PokerCardVotes };
}

export function summarizePokerRound(
    round: PokerRound,
    deck: PokerDeck,
): PokerRoundSummary {
    const distribution = distributeVotes(round, deck);
    const low = distribution.at(0);
    const high = distribution.at(-1);

    if (!low || !high) {
        return { distribution, agreement: "none", mode: [] };
    }

    const agreement = readAgreement(
        deck.cards.indexOf(low.card),
        deck.cards.indexOf(high.card),
    );

    return {
        distribution,
        agreement,
        median: readMedian(distribution, deck),
        mode: readMode(distribution),
        range: { min: low.card, max: high.card },
        ...(agreement === "spread" ? { outliers: { low, high } } : {}),
    };
}

function distributeVotes(round: PokerRound, deck: PokerDeck): PokerCardVotes[] {
    const votes = Object.entries(round.votes);

    return deck.cards.flatMap((card) => {
        const userIds = votes
            .filter(([, vote]) => vote === card)
            .map(([userId]) => userId);

        return userIds.length ? [{ card, userIds }] : [];
    });
}

function readAgreement(lowIndex: number, highIndex: number): PokerAgreement {
    if (lowIndex === highIndex) {
        return "unanimous";
    }

    return highIndex - lowIndex === 1 ? "close" : "spread";
}

function readMedian(distribution: PokerCardVotes[], deck: PokerDeck): string {
    const cards = distribution.flatMap(({ card, userIds }) =>
        userIds.map(() => card),
    );
    const middle = Math.floor(cards.length / 2);
    const upper = cards[middle] ?? "";

    if (cards.length % 2) {
        return upper;
    }

    const lower = cards[middle - 1] ?? "";

    if (lower === upper) {
        return upper;
    }

    if (!deck.values) {
        return `${lower}–${upper}`;
    }

    const value = (readCardValue(deck, lower) + readCardValue(deck, upper)) / 2;
    const card = deck.cards[deck.values.indexOf(value)];

    return card ?? String(Math.round(value * 100) / 100);
}

function readMode(distribution: PokerCardVotes[]): string[] {
    const counts = distribution.map(({ userIds }) => userIds.length);
    const top = Math.max(...counts);
    const voteCount = counts.reduce((sum, count) => sum + count, 0);

    if (top < 2 && voteCount > 1) {
        return [];
    }

    return distribution
        .filter(({ userIds }) => userIds.length === top)
        .map(({ card }) => card);
}

function readCardValue(deck: PokerDeck, card: string): number {
    return deck.values?.[deck.cards.indexOf(card)] ?? 0;
}
