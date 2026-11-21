import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PageRequest } from "../page.js";
import { loadPage, pageButtons, pageOf } from "./telegram-pagination.js";

void describe("pageOf", () => {
    void it("cuts one page out of the items and counts all of them", () => {
        assert.deepEqual(pageOf([1, 2, 3, 4, 5], 1, 2), {
            items: [3, 4],
            total: 5,
            index: 1,
            size: 2,
        });
        assert.deepEqual(pageOf([1, 2, 3, 4, 5], 2, 2), {
            items: [5],
            total: 5,
            index: 2,
            size: 2,
        });
    });

    void it("shows the last page when the items shrank below the page", () => {
        assert.deepEqual(pageOf([1, 2, 3], 4, 2), {
            items: [3],
            total: 3,
            index: 1,
            size: 2,
        });
        assert.deepEqual(pageOf([], 1, 2), {
            items: [],
            total: 0,
            index: 0,
            size: 2,
        });
    });
});

void describe("loadPage", () => {
    const items = [1, 2, 3, 4, 5];

    function loadFrom(source: number[], requests: PageRequest[]) {
        return async (request: PageRequest) => {
            requests.push(request);

            return {
                items: source.slice(request.skip, request.skip + request.limit),
                total: source.length,
            };
        };
    }

    void it("loads the requested page once", async () => {
        const requests: PageRequest[] = [];

        assert.deepEqual(await loadPage(1, 2, loadFrom(items, requests)), {
            items: [3, 4],
            total: 5,
            index: 1,
            size: 2,
        });
        assert.deepEqual(requests, [{ skip: 2, limit: 2 }]);
    });

    void it("loads the last page when the items shrank below the page", async () => {
        const requests: PageRequest[] = [];

        assert.deepEqual(await loadPage(3, 2, loadFrom(items, requests)), {
            items: [5],
            total: 5,
            index: 2,
            size: 2,
        });
        assert.deepEqual(requests, [
            { skip: 6, limit: 2 },
            { skip: 4, limit: 2 },
        ]);
    });

    void it("shows the first page of an empty list", async () => {
        assert.deepEqual(await loadPage(2, 2, loadFrom([], [])), {
            items: [],
            total: 0,
            index: 0,
            size: 2,
        });
    });
});

void describe("pageButtons", () => {
    const button = (text: string, page: number) => ({
        text,
        callback_data: `page:${page}`,
    });
    const page = (index: number, total: number) => ({
        items: [],
        total,
        index,
        size: 5,
    });

    void it("shows no buttons for a single page", () => {
        assert.deepEqual(pageButtons(page(0, 5), button), []);
        assert.deepEqual(pageButtons(page(0, 0), button), []);
    });

    void it("shows only the next arrow on the first page", () => {
        assert.deepEqual(pageButtons(page(0, 11), button), [
            { text: "1/3", disabled: {} },
            { text: "›", callback_data: "page:1" },
        ]);
    });

    void it("shows both arrows on a middle page", () => {
        assert.deepEqual(pageButtons(page(1, 11), button), [
            { text: "‹", callback_data: "page:0" },
            { text: "2/3", disabled: {} },
            { text: "›", callback_data: "page:2" },
        ]);
    });

    void it("shows only the previous arrow on the last page", () => {
        assert.deepEqual(pageButtons(page(2, 11), button), [
            { text: "‹", callback_data: "page:1" },
            { text: "3/3", disabled: {} },
        ]);
    });
});
