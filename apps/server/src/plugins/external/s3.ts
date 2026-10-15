import { S3Client } from "@aws-sdk/client-s3";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { Env } from "../../env.js";

export default fp(
    async function (fastify: FastifyInstance) {
        const config = fastify.getDecorator<Env>("config");
        const client = new S3Client({
            region: config.S3_REGION,
            endpoint: config.S3_ENDPOINT,
            forcePathStyle: true,
            credentials: {
                accessKeyId: config.S3_ACCESS_KEY_ID,
                secretAccessKey: config.S3_SECRET_ACCESS_KEY,
            },
        });

        fastify.decorate("s3", client);

        fastify.addHook("onClose", async () => {
            client.destroy();
        });
    },
    {
        name: "s3",
        dependencies: ["@fastify/env"],
    },
);
