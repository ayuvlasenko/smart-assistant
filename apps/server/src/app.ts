import fastifyAutoload from "@fastify/autoload";
import { Ajv } from "ajv";
import {
    FastifyError,
    FastifyInstance,
    FastifyPluginOptions,
    FastifyServerOptions,
} from "fastify";
import { ObjectId } from "mongodb";
import { STATUS_CODES } from "node:http";
import path from "node:path";
import { requestIdOptions } from "./constants/options.js";
import { TelegramApiClient } from "./plugins/app/telegram/telegram-api-service.js";

const testFilePattern = /\.(?:test|spec)\.(?:js|ts)$/;
const internalServerErrorMessage = "Internal Server Error";

export const options = {
    ...requestIdOptions,
    ajv: {
        customOptions: {
            coerceTypes: "array",
            removeAdditional: "all",
        },
        onCreate: (ajv: Ajv) => {
            ajv.addFormat("objectid", (data: string) => ObjectId.isValid(data));
        },
    },
} satisfies FastifyServerOptions;

export default async function serviceApp(
    fastify: FastifyInstance,
    opts: FastifyPluginOptions & {
        telegramApiService?: TelegramApiClient;
    },
) {
    const { telegramApiService } = opts;
    const autoloadOptions = { ...opts };
    delete autoloadOptions.skipOverride;
    delete autoloadOptions.ajv;
    delete autoloadOptions.telegramApiService;
    delete autoloadOptions.genReqId;
    delete autoloadOptions.requestIdHeader;
    delete autoloadOptions.requestIdLogLabel;

    await fastify.register(fastifyAutoload, {
        dir: path.join(import.meta.dirname, "plugins/external"),
        ignorePattern: /(?:swagger|\.(?:test|spec)\.(?:js|ts)$)/,
        options: { ...autoloadOptions },
    });

    await fastify.register(fastifyAutoload, {
        dir: path.join(import.meta.dirname, "plugins/app"),
        ignorePattern: testFilePattern,
        options: { telegramApiService, ...autoloadOptions },
    });

    fastify.setErrorHandler((err: FastifyError, request, reply) => {
        const statusCode = err.statusCode ?? 500;
        reply.code(statusCode);

        if (statusCode < 500) {
            const response = {
                message: err.message,
                error: STATUS_CODES[statusCode] ?? "Error",
                statusCode,
            };

            if (err.code) {
                return { ...response, code: err.code };
            }

            return response;
        }

        request.log.error(
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

        return { message: internalServerErrorMessage };
    });

    await fastify.register(fastifyAutoload, {
        dir: path.join(import.meta.dirname, "routes"),
        ignorePattern: testFilePattern,
        autoHooks: true,
        cascadeHooks: true,
        routeParams: true,
        options: { opts: autoloadOptions },
    });

    fastify.addHook("onReady", () => {
        fastify.log.info(`Loaded plugins:\n${fastify.printPlugins()}`);
        fastify.log.info(`Registered routes:\n${fastify.printRoutes()}`);
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
