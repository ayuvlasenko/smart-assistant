import {
    FastifyLoggerOptions,
    FastifyRequest,
    FastifyServerOptions,
} from "fastify";
import { randomUUID } from "node:crypto";
import {
    resolveClientAddress,
    resolveClientPort,
} from "../utils/client-address.js";

export const requestIdOptions: Pick<
    FastifyServerOptions,
    "genReqId" | "requestIdHeader" | "requestIdLogLabel"
> = {
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    requestIdLogLabel: "reqId",
};

export const requestLogSerializers: FastifyLoggerOptions["serializers"] = {
    req: serializeRequestForLog,
};

function serializeRequestForLog(request: FastifyRequest) {
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
