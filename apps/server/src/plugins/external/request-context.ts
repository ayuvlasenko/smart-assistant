import { fastifyRequestContext } from "@fastify/request-context";
import { FastifyBaseLogger, FastifyRequest } from "fastify";

declare module "@fastify/request-context" {
    interface RequestContextData {
        log: FastifyBaseLogger;
        reqId: string;
    }
}

export const autoConfig = {
    defaultStoreValues: (request: FastifyRequest) => ({
        log: request.log,
        reqId: request.id,
    }),
};

export default fastifyRequestContext;
