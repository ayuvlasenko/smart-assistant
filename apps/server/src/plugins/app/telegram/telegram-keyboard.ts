export function inRowsOf<TItem>(size: number, items: TItem[]): TItem[][] {
    const rows: TItem[][] = [];

    for (let index = 0; index < items.length; index += size) {
        rows.push(items.slice(index, index + size));
    }

    return rows;
}
