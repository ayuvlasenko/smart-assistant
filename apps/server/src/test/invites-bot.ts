import { AccessService } from "../plugins/app/access/access-service.js";
import { InviteEntity } from "../plugins/app/invites/invite-entity.js";
import invitesHandlersPlugin from "../plugins/app/invites/invites-handlers.js";
import invitesRepositoryPlugin, {
    InvitesRepository,
} from "../plugins/app/invites/invites-repository.js";
import invitesServicePlugin, {
    InvitesService,
    NewInvite,
} from "../plugins/app/invites/invites-service.js";
import pingHandlersPlugin from "../plugins/app/ping/ping-handlers.js";
import { UserEntity } from "../plugins/app/users/user-entity.js";
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

export async function createInviteAs(
    bot: InvitesBot,
    actor: UserEntity,
    draft: NewInvite,
): Promise<InviteEntity> {
    const result = await bot.invitesService.create(actor, draft);

    if (result.status !== "created") {
        throw new Error(`The invite was not created: ${result.status}`);
    }

    return result.invite;
}
