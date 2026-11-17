import { FastifyServerOptions } from "fastify";
import { hostname } from "node:os";
import { LogNormalizer } from "./log-normalizer.js";
import { requestLogSerializers } from "./request-logging.js";

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
            log: normalizeLogRecord,
        },
    };
}

export function buildPrettyLoggerOptions(level: string): LoggerOptions {
    return {
        level,
        formatters: { log: normalizeLogRecord },
        serializers: { ...requestLogSerializers, err: keepNormalizedError },
    };
}

function normalizeLogRecord(
    record: Record<string, unknown>,
): Record<string, unknown> {
    return new LogNormalizer(serializedKeys).normalize(record);
}

function keepNormalizedError(error: object): SerializedError {
    return error as SerializedError;
}
