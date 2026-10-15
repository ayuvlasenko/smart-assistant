import { InlineKeyboardButton } from "@grammyjs/types";

export interface TelegramPage<TItem> {
    items: TItem[];
    total: number;
}

export type TelegramPageButton = (
    text: string,
    page: number,
) => InlineKeyboardButton.CallbackButton;

export function pageOf<TItem>(
    items: readonly TItem[],
    page: number,
    pageSize: number,
): TelegramPage<TItem> {
    return {
        items: items.slice(page * pageSize, (page + 1) * pageSize),
        total: items.length,
    };
}

export function pageButtons(
    page: number,
    total: number,
    pageSize: number,
    button: TelegramPageButton,
): InlineKeyboardButton[] {
    const pages = Math.ceil(total / pageSize);

    if (pages <= 1) {
        return [];
    }

    return [
        ...(page > 0 ? [button("‹", page - 1)] : []),
        { text: `${page + 1}/${pages}`, disabled: {} },
        ...(page + 1 < pages ? [button("›", page + 1)] : []),
    ];
}
