import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import fp from "fastify-plugin";
import { Env } from "../../env.js";

export default fp(
    async function (fastify) {
        if (fastify.getDecorator<Env>("config").ENVIRONMENT !== "preview") {
            return;
        }

        await fastify.register(swagger, {
            hideUntagged: true,
            openapi: {
                info: {
                    title: "Smart Assistant",
                    description: "Bot with smart features",
                    version: "0.0.1",
                },
                components: {
                    securitySchemes: {
                        bearerAuth: {
                            type: "http",
                            scheme: "bearer",
                            bearerFormat: "JWT",
                            description: "JWT authentication",
                        },
                    },
                },
            },
        });

        await fastify.register(swaggerUi, {
            routePrefix: "/api/docs",
        });
    },
    { dependencies: ["@fastify/env"] },
);
