import closeWithGrace from "close-with-grace";
import Fastify from "fastify";
import fp from "fastify-plugin";
import serviceApp, { options } from "./app.js";
import { Env } from "./env.js";
import { buildLoggerOptions } from "./logger-options.js";

const app = Fastify({
    logger: buildLoggerOptions(process.env.LOG_LEVEL ?? "info", {
        pretty: process.stdout.isTTY,
    }),
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
            port: app.getDecorator<Env>("config").PORT,
            host: process.env.HOST ?? "0.0.0.0",
        });
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
}

await init();
