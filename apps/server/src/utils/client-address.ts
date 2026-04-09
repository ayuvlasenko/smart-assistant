export interface ClientAddressRequest {
    headers: Record<string, string | string[] | undefined>;
    ip?: string;
    socket?: {
        remoteAddress?: string;
        remotePort?: number;
    };
}

export function resolveClientAddress(
    request: ClientAddressRequest,
): string | undefined {
    return (
        readHeader(request.headers["cf-connecting-ip"]) ??
        readHeader(request.headers["true-client-ip"]) ??
        request.ip ??
        request.socket?.remoteAddress
    );
}

export function resolveClientPort(
    request: ClientAddressRequest,
): number | undefined {
    return (
        parsePort(readHeader(request.headers["x-forwarded-port"])) ??
        request.socket?.remotePort
    );
}

function readHeader(value: string | string[] | undefined): string | undefined {
    const header = Array.isArray(value) ? value[0] : value;
    const trimmed = header?.trim();

    if (!trimmed) {
        return undefined;
    }

    return trimmed;
}

function parsePort(value: string | undefined): number | undefined {
    if (!value) {
        return undefined;
    }

    const port = Number(value);

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return undefined;
    }

    return port;
}
