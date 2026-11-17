import { Agent } from "node:http";
import { Stream } from "node:stream";

export interface LoggerValueLimits {
    maxDepth: number;
    maxEntries: number;
    maxNodes: number;
    maxStringLength: number;
}

export const truncatedKey = "[truncated]";

const redactedValue = "[REDACTED]";
const circularValue = "[Circular]";
const truncatedValue = "[Truncated]";

const secretKeyEndings = [
    "token",
    "secret",
    "password",
    "passphrase",
    "authorization",
    "cookie",
    "apikey",
    "privatekey",
    "encryptionkey",
    "accesskey",
    "credentials",
    "jwt",
];

const botTokenPattern = /\d{6,12}:[\w-]{30,128}/g;

export class LoggerValueWalk {
    size = 0;
    private visitedNodes = 0;
    private readonly ancestors = new Set<object>();
    private readonly limits: LoggerValueLimits;

    constructor(limits: LoggerValueLimits) {
        this.limits = limits;
    }

    visitEntry(key: string, value: unknown, depth: number): unknown {
        this.size += key.length;

        if (isSecretKey(key)) {
            this.size += redactedValue.length;
            return redactedValue;
        }

        return this.visit(value, depth);
    }

    private visit(value: unknown, depth: number): unknown {
        if (typeof value === "string") {
            return this.visitString(value);
        }

        if (typeof value === "bigint") {
            return this.visitString(value.toString());
        }

        if (typeof value === "function" || typeof value === "symbol") {
            return undefined;
        }

        if (value === null || typeof value !== "object") {
            this.size += 8;
            return value;
        }

        this.visitedNodes++;
        this.size += 2;

        if (this.visitedNodes > this.limits.maxNodes) {
            return truncatedValue;
        }

        if (this.ancestors.has(value)) {
            return circularValue;
        }

        const opaque = describeOpaqueValue(value);

        if (opaque) {
            return this.visitString(opaque);
        }

        if (depth >= this.limits.maxDepth) {
            return this.visitString(describeValue(value));
        }

        this.ancestors.add(value);

        try {
            return this.visitObject(value, depth);
        } finally {
            this.ancestors.delete(value);
        }
    }

    private visitObject(value: object, depth: number): unknown {
        if (value instanceof Error) {
            return this.visitEntries(entriesOfError(value), depth);
        }

        if (value instanceof Date) {
            return this.visitString(
                Number.isNaN(value.getTime())
                    ? String(value)
                    : value.toISOString(),
            );
        }

        if (hasToJson(value)) {
            return this.visit(value.toJSON(), depth);
        }

        if (value instanceof Map) {
            return this.visitItems([...value.entries()], depth);
        }

        if (value instanceof Set) {
            return this.visitItems([...value], depth);
        }

        if (Array.isArray(value)) {
            return this.visitItems(value, depth);
        }

        return this.visitEntries(Object.entries(value), depth);
    }

    private visitItems(items: unknown[], depth: number): unknown[] {
        const visited = items
            .slice(0, this.limits.maxEntries)
            .map((item) => this.visit(item, depth + 1) ?? null);

        if (items.length > this.limits.maxEntries) {
            visited.push(
                `[truncated ${items.length - this.limits.maxEntries} more items]`,
            );
        }

        return visited;
    }

    private visitEntries(
        entries: [string, unknown][],
        depth: number,
    ): Record<string, unknown> {
        const present = entries.filter(([, item]) => item !== undefined);
        const visited: Record<string, unknown> = {};

        for (const [key, item] of present.slice(0, this.limits.maxEntries)) {
            visited[key] = this.visitEntry(key, item, depth + 1);
        }

        if (present.length > this.limits.maxEntries) {
            visited[truncatedKey] =
                `${present.length - this.limits.maxEntries} more keys`;
        }

        return visited;
    }

    private visitString(value: string): string {
        const masked = value.replace(botTokenPattern, redactedValue);
        const cut =
            masked.length > this.limits.maxStringLength
                ? `${masked.slice(0, this.limits.maxStringLength)}…[truncated ${masked.length - this.limits.maxStringLength} characters]`
                : masked;

        this.size += cut.length;

        return cut;
    }
}

function isSecretKey(key: string): boolean {
    const name = key.toLowerCase().replace(/[^a-z0-9]/g, "");

    return secretKeyEndings.some((ending) => name.endsWith(ending));
}

function describeOpaqueValue(value: object): string | undefined {
    if (ArrayBuffer.isView(value)) {
        return `[${classNameOf(value)} ${value.byteLength} bytes]`;
    }

    return value instanceof Stream || value instanceof Agent
        ? describeValue(value)
        : undefined;
}

function describeValue(value: object): string {
    return Array.isArray(value)
        ? `[Array ${value.length}]`
        : `[${classNameOf(value)}]`;
}

function classNameOf(value: object): string {
    const { constructor } = value as { constructor?: { name?: string } };

    return constructor?.name ?? "Object";
}

function entriesOfError(error: Error): [string, unknown][] {
    return [
        ["type", error.name],
        ["message", error.message],
        ["stack", error.stack],
        ...Object.entries(error).filter(
            ([key]) => key !== "name" && key !== "message" && key !== "stack",
        ),
        ["cause", error.cause],
        ["errors", error instanceof AggregateError ? error.errors : undefined],
    ];
}

function hasToJson(value: object): value is { toJSON: () => unknown } {
    return "toJSON" in value && typeof value.toJSON === "function";
}
