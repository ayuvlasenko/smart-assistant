import cors, { FastifyCorsOptions } from "@fastify/cors";

export const autoConfig: FastifyCorsOptions = {
    methods: ["GET", "POST", "PUT", "DELETE"],
};

export default cors;
