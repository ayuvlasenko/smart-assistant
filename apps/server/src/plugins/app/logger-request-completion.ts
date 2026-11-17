import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

const serverErrorStatusCode = 500;

export default fp(
    async function (fastify: FastifyInstance) {
        fastify.addHook("onResponse", async (request, reply) => {
            const fields = {
                req: request,
                res: reply,
                responseTime: Math.round(reply.elapsedTime),
            };

            if (reply.statusCode >= serverErrorStatusCode) {
                request.log.error(fields, "request completed");
            } else {
                request.log.info(fields, "request completed");
            }
        });
    },
    {
        name: "logger-request-completion",
    },
);
