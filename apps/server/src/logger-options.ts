import { FastifyServerOptions } from "fastify";
import { hostname } from "node:os";
import { requestLogSerializers } from "./request-logging.js";

type LoggerOptions = Exclude<
    FastifyServerOptions["logger"],
    boolean | undefined
>;

export function buildLoggerOptions(level: string): LoggerOptions {
    return {
        level,
        base: { hostname: hostname() },
        formatters: {
            level: (label) => ({ level: label }),
        },
        serializers: requestLogSerializers,
    };
}
