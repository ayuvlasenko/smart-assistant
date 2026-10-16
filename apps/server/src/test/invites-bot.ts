import accessPlugin, {
    AccessService,
} from "../plugins/app/access/access-service.js";
import invitesHandlersPlugin from "../plugins/app/invites/invites-handlers.js";
import invitesRepositoryPlugin, {
    InvitesRepository,
} from "../plugins/app/invites/invites-repository.js";
import invitesServicePlugin, {
    InvitesService,
} from "../plugins/app/invites/invites-service.js";
import pingHandlersPlugin from "../plugins/app/ping/ping-handlers.js";
import { BuildTelegramBotServiceTestAppOptions } from "./telegram-bot-service-helper.js";
import {
    buildTelegramSceneBot,
    TelegramSceneBot,
} from "./telegram-scene-bot.js";

export interface InvitesBot extends TelegramSceneBot {
    accessService: AccessService;
    invitesRepository: InvitesRepository;
    invitesService: InvitesService;
}

export async function buildInvitesBot(
    options: BuildTelegramBotServiceTestAppOptions,
): Promise<InvitesBot> {
    const bot = await buildTelegramSceneBot({
        ...options,
        plugins: [
            accessPlugin,
            pingHandlersPlugin,
            invitesRepositoryPlugin,
            invitesServicePlugin,
            invitesHandlersPlugin,
            ...(options.plugins ?? []),
        ],
    });

    return {
        ...bot,
        accessService: bot.app.getDecorator<AccessService>("accessService"),
        invitesRepository:
            bot.app.getDecorator<InvitesRepository>("invitesRepository"),
        invitesService: bot.app.getDecorator<InvitesService>("invitesService"),
    };
}
