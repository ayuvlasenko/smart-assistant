import closeWithGrace from "close-with-grace";
import Fastify, { FastifyServerOptions } from "fastify";
import fp from "fastify-plugin";
import serviceApp, { options } from "./app.js";
import {
    buildLoggerOptions,
    buildPrettyLoggerOptions,
} from "./logger-options.js";

function getLoggerOptions(): FastifyServerOptions["logger"] {
    const level = process.env.LOG_LEVEL ?? "info";

    if (process.stdout.isTTY) {
        return {
            ...buildPrettyLoggerOptions(level),
            transport: {
                target: "pino-pretty",
                options: {
                    translateTime: "HH:MM:ss Z",
                    ignore: "pid,hostname",
                },
            },
        };
    }

    return buildLoggerOptions(level);
}

const app = Fastify({
    logger: getLoggerOptions(),
    trustProxy: true,
    ...options,
});

async function init() {
    // Register your application as a normal plugin.
    // fp must be used to override default error handler
    app.register(fp(serviceApp));

    // Delay is the number of milliseconds for the graceful close to finish
    closeWithGrace(
        {
            delay: Number(process.env.FASTIFY_CLOSE_GRACE_DELAY ?? 500),
            skip: ["unhandledRejection"],
        },
        async ({ err }) => {
            if (err) {
                app.log.error(err);
            }

            await app.close();
        },
    );

    await app.ready();

    try {
        await app.listen({
            port: Number(process.env.PORT ?? 3020),
            host: process.env.HOST ?? "0.0.0.0",
        });
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
}

await init();
