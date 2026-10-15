import { type StaticDecode, type TSchema } from "@sinclair/typebox";
import { CacheHashUpdate, CacheService } from "../cache-service.js";

interface StoredField {
    value: unknown;
    ttlMilliseconds?: number;
}

export class TelegramSession {
    readonly key: string;
    private readonly fields = new Map<string, StoredField | undefined>();
    private readonly changedFields = new Set<string>();
    private readonly cache: Pick<CacheService, "getHashField">;

    constructor(cache: Pick<CacheService, "getHashField">, key: string) {
        this.cache = cache;
        this.key = key;
    }

    get hasChanges(): boolean {
        return this.changedFields.size > 0;
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

    collectChanges(): CacheHashUpdate {
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
