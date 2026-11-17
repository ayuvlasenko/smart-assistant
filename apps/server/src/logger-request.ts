import {
    FastifyLoggerOptions,
    FastifyRequest,
    FastifyServerOptions,
} from "fastify";
import { randomUUID } from "node:crypto";
import { resolveClientAddress, resolveClientPort } from "./client-address.js";

export const REQUEST_ID_HEADER = "x-request-id";

export const requestIdOptions: Pick<
    FastifyServerOptions,
    "genReqId" | "requestIdHeader"
> = {
    genReqId: () => randomUUID(),
    requestIdHeader: false,
};

export const loggerRequestSerializers: FastifyLoggerOptions["serializers"] = {
    req: serializeRequest,
};

function serializeRequest(request: FastifyRequest) {
    const version = request.headers["accept-version"];

    return {
        method: request.method,
        url: request.url,
        version: Array.isArray(version) ? version[0] : version,
        host: request.host,
        remoteAddress: resolveClientAddress(request),
        remotePort: resolveClientPort(request),
    };
}
