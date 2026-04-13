import Fastify from "fastify";
import fp from "fastify-plugin";
import { TestContext } from "node:test";
import serviceApp, { options } from "../app.js";
import {
    buildTelegramApiServiceMock,
    TelegramApiServiceMock,
} from "./telegram-api-service-mock.js";

type BuildOptions = {
    t: TestContext;
    telegramApiService?: TelegramApiServiceMock;
};

export async function buildTestApp({ t, ...opts }: BuildOptions) {
    const app = Fastify({
        logger: false,
        trustProxy: true,
        ...options,
    });

    const telegramApiService =
        opts.telegramApiService ?? buildTelegramApiServiceMock({ t });

    app.register(fp(serviceApp), { telegramApiService });

    await app.ready();

    t.after(() => app.close());

    return { app, telegramApiService };
}
