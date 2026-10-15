import { type StaticDecode, type TSchema } from "@sinclair/typebox";
import { CacheHashUpdate, CacheService } from "../cache-service.js";

interface StoredField {
    value: unknown;
    ttlMilliseconds?: number;
}

export interface TelegramSessionChanges {
    fields: CacheHashUpdate;
    indexes: TelegramSessionIndexUpdate[];
}

export interface TelegramSessionIndexUpdate {
    name: string;
    adds: TelegramSessionIndexEntry[];
    removals: string[];
}

export interface TelegramSessionIndexEntry {
    entry: string;
    expiresAt: number;
}

export class TelegramSession {
    readonly key: string;
    private readonly fields = new Map<string, StoredField | undefined>();
    private readonly changedFields = new Set<string>();
    private readonly indexChanges = new Map<
        string,
        Map<string, number | undefined>
    >();
    private readonly cache: Pick<CacheService, "getHashField">;

    constructor(cache: Pick<CacheService, "getHashField">, key: string) {
        this.cache = cache;
        this.key = key;
    }

    get hasChanges(): boolean {
        return this.changedFields.size > 0 || this.indexChanges.size > 0;
    }

    async read<Schema extends TSchema>(
        field: string,
        schema: Schema,
    ): Promise<StaticDecode<Schema> | undefined> {
        if (!this.fields.has(field)) {
            const value = await this.cache.getHashField(
                this.key,
                field,
                schema,
            );

            this.fields.set(field, value === undefined ? undefined : { value });
        }

        return this.fields.get(field)?.value;
    }

    write(field: string, value: unknown, ttlMilliseconds: number): void {
        this.fields.set(field, { value, ttlMilliseconds });
        this.changedFields.add(field);
    }

    remove(field: string): void {
        if (this.fields.has(field) && !this.fields.get(field)) {
            return;
        }

        this.fields.set(field, undefined);
        this.changedFields.add(field);
    }

    index(name: string, entry: string, expiresAt: number): void {
        this.indexChangesOf(name).set(entry, expiresAt);
    }

    unindex(name: string, entry: string): void {
        this.indexChangesOf(name).set(entry, undefined);
    }

    collectChanges(): TelegramSessionChanges {
        return {
            fields: this.collectFieldChanges(),
            indexes: [...this.indexChanges].map(([name, entries]) =>
                collectIndexUpdate(name, entries),
            ),
        };
    }

    private indexChangesOf(name: string): Map<string, number | undefined> {
        let entries = this.indexChanges.get(name);

        if (!entries) {
            entries = new Map();
            this.indexChanges.set(name, entries);
        }

        return entries;
    }

    private collectFieldChanges(): CacheHashUpdate {
        const update: CacheHashUpdate = { writes: [], removals: [] };

        for (const field of this.changedFields) {
            const stored = this.fields.get(field);

            if (stored?.ttlMilliseconds === undefined) {
                update.removals.push(field);
            } else {
                update.writes.push({
                    field,
                    value: stored.value,
                    ttlMilliseconds: stored.ttlMilliseconds,
                });
            }
        }

        return update;
    }
}

function collectIndexUpdate(
    name: string,
    entries: Map<string, number | undefined>,
): TelegramSessionIndexUpdate {
    const update: TelegramSessionIndexUpdate = {
        name,
        adds: [],
        removals: [],
    };

    for (const [entry, expiresAt] of entries) {
        if (expiresAt === undefined) {
            update.removals.push(entry);
        } else {
            update.adds.push({ entry, expiresAt });
        }
    }

    return update;
}
