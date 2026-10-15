import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pageButtons, pageOf } from "./telegram-pagination.js";

void describe("pageOf", () => {
    void it("cuts one page out of the items and counts all of them", () => {
        assert.deepEqual(pageOf([1, 2, 3, 4, 5], 1, 2), {
            items: [3, 4],
            total: 5,
        });
        assert.deepEqual(pageOf([1, 2, 3, 4, 5], 2, 2), {
            items: [5],
            total: 5,
        });
    });
});

void describe("pageButtons", () => {
    const button = (text: string, page: number) => ({
        text,
        callback_data: `page:${page}`,
    });

    void it("shows no buttons for a single page", () => {
        assert.deepEqual(pageButtons(0, 5, 5, button), []);
        assert.deepEqual(pageButtons(0, 0, 5, button), []);
    });

    void it("shows only the next arrow on the first page", () => {
        assert.deepEqual(pageButtons(0, 11, 5, button), [
            { text: "1/3", disabled: {} },
            { text: "›", callback_data: "page:1" },
        ]);
    });

    void it("shows both arrows on a middle page", () => {
        assert.deepEqual(pageButtons(1, 11, 5, button), [
            { text: "‹", callback_data: "page:0" },
            { text: "2/3", disabled: {} },
            { text: "›", callback_data: "page:2" },
        ]);
    });

    void it("shows only the previous arrow on the last page", () => {
        assert.deepEqual(pageButtons(2, 11, 5, button), [
            { text: "‹", callback_data: "page:1" },
            { text: "3/3", disabled: {} },
        ]);
    });
});
