import { FastifyInstance } from "fastify";
import { REQUEST_ID_HEADER } from "../constants/headers.js";

export default async function (fastify: FastifyInstance) {
    fastify.addHook("onRequest", async (request, reply) => {
        reply.header(REQUEST_ID_HEADER, request.id);
    });
}
