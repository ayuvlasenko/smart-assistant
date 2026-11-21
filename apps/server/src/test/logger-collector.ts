import { Writable } from "node:stream";

export interface LoggerEntry {
    botId?: string;
    botTelegramId?: string;
    failed?: number;
    handler?: string;
    level?: number | string;
    method?: string;
    module?: string;
    msg?: string;
    pid?: number;
    recipients?: number;
    refusedRoute?: string;
    reqId?: string;
    responseTime?: number;
    result?: string;
    revoked?: number;
    route?: string;
    statusCode?: number;
    updateId?: number;
    userId?: string;
    err?: {
        message?: string;
    };
    req?: {
        remoteAddress?: string;
        remotePort?: number;
        url?: string;
    };
    res?: {
        statusCode?: number;
    };
}

export function createLoggerCollector() {
    const lines: string[] = [];
    const listeners = new Set<() => void>();

    const readEntries = () =>
        lines
            .join("")
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line) as LoggerEntry);

    const waitForEntry = (
        predicate: (entry: LoggerEntry) => boolean,
        timeoutMs = 2000,
    ) =>
        new Promise<LoggerEntry>((resolve, reject) => {
            const check = () => {
                const entry = readEntries().find(predicate);

                if (entry) {
                    listeners.delete(check);
                    clearTimeout(timer);
                    resolve(entry);
                }
            };
            const timer = setTimeout(() => {
                listeners.delete(check);
                reject(new Error("Timed out waiting for a log entry"));
            }, timeoutMs);

            listeners.add(check);
            check();
        });

    return {
        logger: {
            level: "info" as const,
            stream: new Writable({
                write(chunk: Buffer | string, _encoding, callback) {
                    lines.push(chunk.toString());
                    listeners.forEach((listener) => {
                        listener();
                    });
                    callback();
                },
            }),
        },
        readEntries,
        waitForEntry,
    };
}
