import { S3Client } from "@aws-sdk/client-s3";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

export default fp(
    async function (fastify: FastifyInstance) {
        const client = new S3Client({
            region: fastify.config.S3_REGION,
            endpoint: fastify.config.S3_ENDPOINT,
            forcePathStyle: true,
            credentials: {
                accessKeyId: fastify.config.S3_ACCESS_KEY_ID,
                secretAccessKey: fastify.config.S3_SECRET_ACCESS_KEY,
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
