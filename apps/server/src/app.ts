import fastifyAutoload from "@fastify/autoload";
import { Ajv } from "ajv";
import { FastifyError, FastifyInstance, FastifyPluginOptions } from "fastify";
import { ObjectId } from "mongodb";
import path from "node:path";
import { TelegramApiClient } from "./plugins/app/telegram/telegram-api-service.js";

const testFilePattern = /\.(?:test|spec)\.(?:js|ts)$/;

export const options = {
    ajv: {
        customOptions: {
            coerceTypes: "array",
            removeAdditional: "all",
        },
        onCreate: (ajv: Ajv) => {
            ajv.addFormat("objectid", (data: string) => ObjectId.isValid(data));
        },
    },
} as FastifyPluginOptions;

export default async function serviceApp(
    fastify: FastifyInstance,
    opts: FastifyPluginOptions & {
        telegramApiService?: TelegramApiClient;
    },
) {
    const { telegramApiService } = opts;
    delete opts.skipOverride;
    delete opts.ajv;
    delete opts.telegramApiService;

    await fastify.register(fastifyAutoload, {
        dir: path.join(import.meta.dirname, "plugins/external"),
        ignorePattern: /(?:swagger|\.(?:test|spec)\.(?:js|ts)$)/,
        options: { ...opts },
    });

    await fastify.register(fastifyAutoload, {
        dir: path.join(import.meta.dirname, "plugins/app"),
        ignorePattern: testFilePattern,
        options: { telegramApiService, ...opts },
    });

    await fastify.register(fastifyAutoload, {
        dir: path.join(import.meta.dirname, "routes"),
        ignorePattern: testFilePattern,
        autoHooks: true,
        cascadeHooks: true,
        routeParams: true,
        options: { opts },
    });

    fastify.addHook("onReady", () => {
        fastify.log.info(`Loaded plugins:\n${fastify.printPlugins()}`);
        fastify.log.info(`Registered routes:\n${fastify.printRoutes()}`);
    });

    fastify.setErrorHandler((err: FastifyError, request, reply) => {
        fastify.log.error(
            {
                err,
                request: {
                    method: request.method,
                    url: request.url,
                    query: request.query,
                    params: request.params,
                },
            },
            "Unhandled error occurred",
        );

        reply.code(err.statusCode ?? 500);

        let message = "Internal Server Error";
        if (err.statusCode && err.statusCode < 500) {
            message = err instanceof Error ? err.message : message;
        }

        return { message };
    });

    fastify.setNotFoundHandler(
        {
            preHandler: fastify.rateLimit({
                max: 3,
                timeWindow: 500,
            }),
        },
        (request, reply) => {
            request.log.warn(
                {
                    request: {
                        method: request.method,
                        url: request.url,
                        query: request.query,
                        params: request.params,
                    },
                },
                "Resource not found",
            );

            reply.code(404);

            return { message: "Not Found" };
        },
    );
}
