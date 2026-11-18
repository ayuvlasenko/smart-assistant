export interface Page<TItem> {
    items: TItem[];
    total: number;
}

export interface PageRequest {
    skip: number;
    limit: number;
}
