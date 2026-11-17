import { TestContext } from "node:test";
import botsConnectorPlugin from "../plugins/app/bots/bots-connector.js";
import botsHandlersPlugin from "../plugins/app/bots/bots-handlers.js";
import botsServicePlugin, {
    BotsService,
} from "../plugins/app/bots/bots-service.js";
import invitesHandlersPlugin from "../plugins/app/invites/invites-handlers.js";
import invitesRepositoryPlugin from "../plugins/app/invites/invites-repository.js";
import invitesServicePlugin from "../plugins/app/invites/invites-service.js";
import {
    buildTelegramApiServiceMock,
    TelegramApiServiceMock,
} from "./telegram-api-service-mock.js";
import { BuildTelegramBotServiceTestAppOptions } from "./telegram-bot-service-helper.js";
import { buildTelegramGetMeResponse } from "./telegram-fixtures.js";
import {
    buildTelegramSceneBot,
    TelegramSceneBot,
} from "./telegram-scene-bot.js";

export interface BotsBot extends TelegramSceneBot {
    botsService: BotsService;
    childApis: Map<string, TelegramApiServiceMock>;
}

export async function buildBotsBot(
    options: BuildTelegramBotServiceTestAppOptions,
): Promise<BotsBot> {
    const childApis = new Map<string, TelegramApiServiceMock>();
    const bot = await buildTelegramSceneBot({
        ...options,
        telegramApiFactory: (token) => childApiOf(options.t, childApis, token),
        plugins: [
            invitesRepositoryPlugin,
            invitesServicePlugin,
            invitesHandlersPlugin,
            botsConnectorPlugin,
            botsServicePlugin,
            botsHandlersPlugin,
            ...(options.plugins ?? []),
        ],
    });

    return {
        ...bot,
        botsService: bot.app.getDecorator<BotsService>("botsService"),
        childApis,
    };
}

function childApiOf(
    t: TestContext,
    childApis: Map<string, TelegramApiServiceMock>,
    token: string,
): TelegramApiServiceMock {
    const [telegramId = ""] = token.split(":");
    let api = childApis.get(telegramId);

    if (!api) {
        api = buildTelegramApiServiceMock({
            t,
            getMeResponse: buildTelegramGetMeResponse({
                id: Number(telegramId),
                username: `child_${telegramId}_bot`,
            }),
        });
        childApis.set(telegramId, api);
    }

    return api;
}
