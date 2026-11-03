import { TestContext } from "node:test";
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
    const [botId = ""] = token.split(":");
    let api = childApis.get(botId);

    if (!api) {
        api = buildTelegramApiServiceMock({
            t,
            getMeResponse: buildTelegramGetMeResponse({
                id: Number(botId),
                username: `child_${botId}_bot`,
            }),
        });
        childApis.set(botId, api);
    }

    return api;
}
