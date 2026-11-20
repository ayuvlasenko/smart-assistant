import { Translate } from "../i18n-service.js";

export const pokerDeckNames = [
    "fibonacciShort",
    "fibonacciModified",
    "fibonacci",
    "powersOfTwo",
    "tShirt",
] as const;

export type PokerDeckName = (typeof pokerDeckNames)[number];

export interface PokerDeck {
    name: PokerDeckName;
    cards: readonly string[];
    values?: readonly number[];
}

export const defaultPokerDeckName: PokerDeckName = "fibonacciShort";

const decks: Record<
    PokerDeckName,
    { cards: readonly string[]; values?: readonly number[] }
> = {
    fibonacciShort: {
        cards: ["1", "2", "3", "5", "8", "13"],
        values: [1, 2, 3, 5, 8, 13],
    },
    fibonacciModified: {
        cards: ["0", "½", "1", "2", "3", "5", "8", "13", "20", "40", "100"],
        values: [0, 0.5, 1, 2, 3, 5, 8, 13, 20, 40, 100],
    },
    fibonacci: {
        cards: ["0", "1", "2", "3", "5", "8", "13", "21", "34", "55", "89"],
        values: [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89],
    },
    powersOfTwo: {
        cards: ["0", "1", "2", "4", "8", "16", "32", "64"],
        values: [0, 1, 2, 4, 8, 16, 32, 64],
    },
    tShirt: {
        cards: ["XS", "S", "M", "L", "XL", "XXL"],
    },
};

export function readPokerDeck(name: PokerDeckName): PokerDeck {
    return { name, ...decks[name] };
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
