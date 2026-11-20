import { FastifyServerOptions } from "fastify";
import { hostname } from "node:os";
import { LoggerNormalizer } from "./logger-normalizer.js";
import { loggerRequestSerializers } from "./logger-request.js";

type LoggerOptions = Exclude<
    FastifyServerOptions["logger"],
    boolean | undefined
>;

type LogMethodHook = NonNullable<
    NonNullable<LoggerOptions["hooks"]>["logMethod"]
>;

interface SerializedError {
    [key: string]: unknown;
    type: string;
    message: string;
    stack: string;
}

const normalizer = new LoggerNormalizer(["req", "res"]);

export function buildLoggerOptions(
    level: string,
    { pretty = false }: { pretty?: boolean } = {},
): LoggerOptions {
    const options: LoggerOptions = {
        level,
        formatters: { log: normalizeRecord },
        serializers: { ...loggerRequestSerializers, err: keepNormalizedError },
        hooks: { logMethod: logWithNormalizedMessage },
    };

    if (pretty) {
        return {
            ...options,
            transport: {
                target: "pino-pretty",
                options: {
                    translateTime: "HH:MM:ss Z",
                    ignore: "pid,hostname",
                },
            },
        };
    }

    return {
        ...options,
        base: { hostname: hostname() },
        formatters: {
            level: (label) => ({ level: label }),
            log: normalizeRecord,
        },
    };
}

function logWithNormalizedMessage(
    this: ThisParameterType<LogMethodHook>,
    ...[args, method]: Parameters<LogMethodHook>
): void {
    normalizeMessageOf(args);
    method.apply(this, args);
}

function normalizeMessageOf(args: unknown[]): void {
    const [first, second] = args;

    if (typeof first === "string") {
        args[0] = normalizer.normalizeMessage(first);
    } else if (typeof second === "string") {
        args[1] = normalizer.normalizeMessage(second);
    } else if (second === undefined) {
        const message = errorMessageOf(first);

        if (message !== undefined) {
            args[1] = normalizer.normalizeMessage(message);
        }
    }
}

function errorMessageOf(record: unknown): string | undefined {
    const error = record instanceof Error ? record : errorFieldOf(record);
    const message = isObject(error) ? error.message : undefined;

    return typeof message === "string" ? message : undefined;
}

function errorFieldOf(record: unknown): unknown {
    return isObject(record) && record.msg === undefined
        ? record.err
        : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function normalizeRecord(
    record: Record<string, unknown>,
): Record<string, unknown> {
    return normalizer.normalize(record);
}

function keepNormalizedError(error: object): SerializedError {
    return error as SerializedError;
}
