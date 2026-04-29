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

    return {
        logger: {
            level: "info" as const,
            stream: new Writable({
                write(chunk: Buffer | string, _encoding, callback) {
                    lines.push(chunk.toString());
                    callback();
                },
            }),
        },
        readEntries: () =>
            lines
                .join("")
                .split("\n")
                .filter(Boolean)
                .map((line) => JSON.parse(line) as LogEntry),
    };
}
