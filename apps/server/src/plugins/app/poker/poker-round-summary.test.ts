import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PokerDeckName, readPokerDeck } from "./poker-decks.js";
import { PokerRound } from "./poker-room-entity.js";
import { summarizePokerRound } from "./poker-round-summary.js";

void describe("summarizePokerRound", () => {
    const cases: {
        name: string;
        deck: PokerDeckName;
        votes: string[];
        agreement: string;
        median?: string;
        mode: string[];
        range?: { min: string; max: string };
    }[] = [
        {
            name: "a round without votes",
            deck: "fibonacciModified",
            votes: [],
            agreement: "none",
            mode: [],
        },
        {
            name: "votes for cards that are not in the deck",
            deck: "fibonacciModified",
            votes: ["?", "☕"],
            agreement: "none",
            mode: [],
        },
        {
            name: "equal votes",
            deck: "fibonacciModified",
            votes: ["5", "5", "5"],
            agreement: "unanimous",
            median: "5",
            mode: ["5"],
            range: { min: "5", max: "5" },
        },
        {
            name: "votes on neighbouring cards",
            deck: "fibonacciModified",
            votes: ["5", "8", "8"],
            agreement: "close",
            median: "8",
            mode: ["8"],
            range: { min: "5", max: "8" },
        },
        {
            name: "a spread with an outlier that does not move the median",
            deck: "fibonacciModified",
            votes: ["3", "3", "3", "5", "100"],
            agreement: "spread",
            median: "3",
            mode: ["3"],
            range: { min: "3", max: "100" },
        },
        {
            name: "an even count between two cards",
            deck: "fibonacciModified",
            votes: ["3", "5"],
            agreement: "close",
            median: "4",
            mode: [],
            range: { min: "3", max: "5" },
        },
        {
            name: "an even count whose mean is a card",
            deck: "fibonacciModified",
            votes: ["0", "1"],
            agreement: "spread",
            median: "½",
            mode: [],
            range: { min: "0", max: "1" },
        },
        {
            name: "a tie of the most frequent cards",
            deck: "fibonacci",
            votes: ["2", "2", "8", "8", "?"],
            agreement: "spread",
            median: "5",
            mode: ["2", "8"],
            range: { min: "2", max: "8" },
        },
        {
            name: "t-shirt sizes by their order",
            deck: "tShirt",
            votes: ["S", "M", "L"],
            agreement: "spread",
            median: "M",
            mode: [],
            range: { min: "S", max: "L" },
        },
        {
            name: "t-shirt sizes with an even count",
            deck: "tShirt",
            votes: ["M", "L"],
            agreement: "close",
            median: "M–L",
            mode: [],
            range: { min: "M", max: "L" },
        },
        {
            name: "a single vote",
            deck: "powersOfTwo",
            votes: ["16"],
            agreement: "unanimous",
            median: "16",
            mode: ["16"],
            range: { min: "16", max: "16" },
        },
    ];

    for (const testCase of cases) {
        void it(`summarizes ${testCase.name}`, () => {
            const summary = summarizePokerRound(
                buildRound(testCase.votes),
                readPokerDeck(testCase.deck),
            );

            assert.equal(summary.agreement, testCase.agreement);
            assert.equal(summary.median, testCase.median);
            assert.deepEqual(summary.mode, testCase.mode);
            assert.deepEqual(summary.range, testCase.range);
        });
    }

    void it("lists the votes in the order of the deck and skips cards outside it", () => {
        const summary = summarizePokerRound(
            buildRound(["40", "13", "?", "2", "13"]),
            readPokerDeck("fibonacciModified"),
        );

        assert.deepEqual(summary.distribution, [
            { card: "2", userIds: ["user-3"] },
            { card: "13", userIds: ["user-1", "user-4"] },
            { card: "40", userIds: ["user-0"] },
        ]);
    });

    void it("names the lowest and the highest voters of a spread", () => {
        const summary = summarizePokerRound(
            buildRound(["2", "5", "13", "2"]),
            readPokerDeck("fibonacciModified"),
        );

        assert.deepEqual(summary.outliers, {
            low: { card: "2", userIds: ["user-0", "user-3"] },
            high: { card: "13", userIds: ["user-2"] },
        });
    });
});

function buildRound(votes: string[]): PokerRound {
    return {
        number: 1,
        status: "revealed",
        votes: Object.fromEntries(
            votes.map((card, index) => [`user-${index}`, card]),
        ),
        startedAt: new Date(),
    };
}
