import { Writable } from "node:stream";

export interface LogEntry {
    handler?: string;
    module?: string;
    msg?: string;
    reqId?: string;
    req?: {
        remoteAddress?: string;
        remotePort?: number;
    };
}

export function createLogCollector() {
    const lines: string[] = [];
    const listeners = new Set<() => void>();

    const readEntries = () =>
        lines
            .join("")
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line) as LogEntry);

    const waitForEntry = (
        predicate: (entry: LogEntry) => boolean,
        timeoutMs = 2000,
    ) =>
        new Promise<LogEntry>((resolve, reject) => {
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
