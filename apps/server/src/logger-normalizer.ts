import {
    LoggerValueLimits,
    LoggerValueWalk,
    truncatedKey,
} from "./logger-value-walk.js";

type LoggerRecord = Record<string, unknown>;

const failedValue = "[log record could not be normalized]";
const maxRecordSize = 65_536;

const limitTiers: LoggerValueLimits[] = [
    {
        maxDepth: 10,
        maxEntries: 100,
        maxNodes: 20_000,
        maxStringLength: 10_000,
    },
    { maxDepth: 5, maxEntries: 20, maxNodes: 2_000, maxStringLength: 1_000 },
    { maxDepth: 3, maxEntries: 5, maxNodes: 200, maxStringLength: 200 },
];

export class LoggerNormalizer {
    private readonly rawKeys: ReadonlySet<string>;

    constructor(rawKeys: readonly string[] = []) {
        this.rawKeys = new Set(rawKeys);
    }

    normalize(record: LoggerRecord): LoggerRecord {
        try {
            return this.shrink(record);
        } catch {
            return { [truncatedKey]: failedValue };
        }
    }

    private shrink(record: LoggerRecord): LoggerRecord {
        let normalized: LoggerRecord = {};

        for (const limits of limitTiers) {
            const walk = new LoggerValueWalk(limits);

            normalized = this.normalizeWith(walk, record);

            if (walk.size <= maxRecordSize) {
                break;
            }
        }

        return normalized;
    }

    private normalizeWith(
        walk: LoggerValueWalk,
        record: LoggerRecord,
    ): LoggerRecord {
        const normalized: LoggerRecord = {};

        for (const [key, value] of Object.entries(record)) {
            if (this.rawKeys.has(key)) {
                normalized[key] = value;
            } else if (value !== undefined) {
                normalized[key] = walk.visitEntry(key, value, 0);
            }
        }

        return normalized;
    }
}
