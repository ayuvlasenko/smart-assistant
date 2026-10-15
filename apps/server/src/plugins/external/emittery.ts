import Emittery from "emittery";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

export default fp(
    async function emitteryPlugin(fastify: FastifyInstance) {
        fastify.decorate("eventEmitter", new Emittery());
    },
    {
        name: "emittery",
    },
);
