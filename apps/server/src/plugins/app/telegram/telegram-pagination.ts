import { InlineKeyboardButton } from "@grammyjs/types";
import { Page, PageRequest } from "../page.js";

export interface TelegramPage<TItem> extends Page<TItem> {
    index: number;
    size: number;
}

export type TelegramPageButton = (
    text: string,
    page: number,
) => InlineKeyboardButton.CallbackButton;

export function pageOf<TItem>(
    items: readonly TItem[],
    page: number,
    size: number,
): TelegramPage<TItem> {
    const index = Math.min(page, lastPageIndex(items.length, size));

    return {
        items: items.slice(index * size, (index + 1) * size),
        total: items.length,
        index,
        size,
    };
}

export async function loadPage<TItem>(
    page: number,
    size: number,
    load: (request: PageRequest) => Promise<Page<TItem>>,
): Promise<TelegramPage<TItem>> {
    const loaded = await load({ skip: page * size, limit: size });
    const last = lastPageIndex(loaded.total, size);

    if (page <= last) {
        return { ...loaded, index: page, size };
    }

    return {
        ...(await load({ skip: last * size, limit: size })),
        index: last,
        size,
    };
}

export function pageButtons(
    { index, total, size }: TelegramPage<unknown>,
    button: TelegramPageButton,
): InlineKeyboardButton[] {
    const pages = Math.ceil(total / size);

    if (pages <= 1) {
        return [];
    }

    return [
        ...(index > 0 ? [button("‹", index - 1)] : []),
        { text: `${index + 1}/${pages}`, disabled: {} },
        ...(index + 1 < pages ? [button("›", index + 1)] : []),
    ];
}

function lastPageIndex(total: number, size: number): number {
    return Math.max(0, Math.ceil(total / size) - 1);
}
