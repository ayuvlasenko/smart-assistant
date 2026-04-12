import serviceApp, { options } from "../app.js";
import Fastify from "fastify";
import fp from "fastify-plugin";
import { TestContext } from "node:test";

// automatically build and tear down our instance
export async function build(t?: TestContext) {
    const app = Fastify({
        logger: {
            level: "info",
            transport: {
                target: "pino-pretty",
                options: {
                    translateTime: "HH:MM:ss Z",
                    ignore: "pid,hostname",
                },
            },
        },
        trustProxy: true,
        ...options,
    });

    app.register(fp(serviceApp));

    await app.ready();

    // If we pass the test contest, it will close the app after we are done
    if (t) {
        t.after(() => app.close());
    }

    return app;
}
