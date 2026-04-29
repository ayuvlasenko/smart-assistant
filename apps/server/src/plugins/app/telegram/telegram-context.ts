import { Update } from "@grammyjs/types";
import { MaybeArray } from "../../../types/utility.js";

export type TelegramUpdateFilter<TUpdate extends Update> = (
    update: Update,
) => update is TUpdate;

export type GuardedTelegramUpdate<TFilter> =
    TFilter extends TelegramUpdateFilter<infer TUpdate> ? TUpdate : never;

export type GuardedTelegramUpdates<
    TFilters extends readonly TelegramUpdateFilter<Update>[],
> = GuardedTelegramUpdate<TFilters[number]>;

export interface TelegramContext<TUpdate extends Update = Update> {
    readonly update: TUpdate;
    has<TFilter extends TelegramUpdateFilter<Update>>(
        filter: TFilter,
    ): this is TelegramContext<TUpdate & GuardedTelegramUpdate<TFilter>>;
    has<const TFilters extends readonly TelegramUpdateFilter<Update>[]>(
        filters: TFilters,
    ): this is TelegramContext<TUpdate & GuardedTelegramUpdates<TFilters>>;
}

class DefaultTelegramContext<TUpdate extends Update>
    implements TelegramContext<TUpdate>
{
    constructor(readonly update: TUpdate) {}

    has<TFilter extends TelegramUpdateFilter<Update>>(
        filter: TFilter,
    ): this is TelegramContext<TUpdate & GuardedTelegramUpdate<TFilter>>;
    has<const TFilters extends readonly TelegramUpdateFilter<Update>[]>(
        filters: TFilters,
    ): this is TelegramContext<TUpdate & GuardedTelegramUpdates<TFilters>>;
    has(filters: MaybeArray<TelegramUpdateFilter<Update>>): boolean {
        const filterList: readonly TelegramUpdateFilter<Update>[] =
            Array.isArray(filters) ? filters : [filters];

        return filterList.some((filter) => filter(this.update));
    }
}

export function createTelegramContext<TUpdate extends Update>(
    update: TUpdate,
): TelegramContext<TUpdate> {
    return new DefaultTelegramContext(update);
}
