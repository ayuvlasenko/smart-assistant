import fastifyAutoload from "@fastify/autoload";
import { Ajv } from "ajv";
import {
    FastifyError,
    FastifyInstance,
    FastifyPluginOptions,
    FastifyServerOptions,
    LogController,
} from "fastify";
import { ObjectId } from "mongodb";
import { STATUS_CODES } from "node:http";
import path from "node:path";
import { requestIdOptions } from "./logger-request.js";
import { TelegramApiFactory } from "./plugins/app/telegram/telegram-bots.js";

const testFilePattern = /\.(?:test|spec)\.(?:js|ts)$/;
const internalServerErrorMessage = "Internal Server Error";

export interface AppOptions extends FastifyPluginOptions {
    database?: string;
    telegramApiFactory?: TelegramApiFactory;
}

export const options = {
    ...requestIdOptions,
    trustProxy: true,
    logController: new LogController({ disableRequestLogging: true }),
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
    { database, telegramApiFactory }: AppOptions,
) {
    await fastify.register(fastifyAutoload, {
        dir: path.join(import.meta.dirname, "plugins/external"),
        ignorePattern: testFilePattern,
        options: { database },
    });

    await fastify.register(fastifyAutoload, {
        dir: path.join(import.meta.dirname, "plugins/app"),
        ignorePattern: testFilePattern,
        options: { telegramApiFactory },
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

        request.log.error({ err }, "Unhandled error occurred");

        return { message: internalServerErrorMessage };
    });

    await fastify.register(fastifyAutoload, {
        dir: path.join(import.meta.dirname, "routes"),
        ignorePattern: testFilePattern,
        autoHooks: true,
        cascadeHooks: true,
        routeParams: true,
    });

    fastify.addHook("onReady", () => {
        fastify.log.debug(`Loaded plugins:\n${fastify.printPlugins()}`);
        fastify.log.debug(`Registered routes:\n${fastify.printRoutes()}`);
    });

    fastify.setNotFoundHandler(
        {
            preHandler: fastify.rateLimit({
                max: 3,
                timeWindow: 500,
            }),
        },
        (_request, reply) => {
            reply.code(404);

            return { message: "Not Found" };
        },
    );
}
