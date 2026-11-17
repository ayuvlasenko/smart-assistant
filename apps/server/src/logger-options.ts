import { FastifyServerOptions } from "fastify";
import { hostname } from "node:os";
import { LoggerNormalizer } from "./logger-normalizer.js";
import { loggerRequestSerializers } from "./logger-request.js";

type LoggerOptions = Exclude<
    FastifyServerOptions["logger"],
    boolean | undefined
>;

interface SerializedError {
    [key: string]: unknown;
    type: string;
    message: string;
    stack: string;
}

const serializedKeys = ["req", "res"];

export function buildLoggerOptions(level: string): LoggerOptions {
    return {
        ...buildPrettyLoggerOptions(level),
        base: { hostname: hostname() },
        formatters: {
            level: (label) => ({ level: label }),
            log: normalizeRecord,
        },
    };
}

export function buildPrettyLoggerOptions(level: string): LoggerOptions {
    return {
        level,
        formatters: { log: normalizeRecord },
        serializers: { ...loggerRequestSerializers, err: keepNormalizedError },
    };
}

function normalizeRecord(
    record: Record<string, unknown>,
): Record<string, unknown> {
    return new LoggerNormalizer(serializedKeys).normalize(record);
}

function keepNormalizedError(error: object): SerializedError {
    return error as SerializedError;
}
