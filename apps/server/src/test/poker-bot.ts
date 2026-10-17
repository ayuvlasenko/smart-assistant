import { AccessService } from "../plugins/app/access/access-service.js";
import pokerHandlersPlugin from "../plugins/app/poker/poker-handlers.js";
import pokerRoomsRepositoryPlugin, {
    PokerRoomsRepository,
} from "../plugins/app/poker/poker-rooms-repository.js";
import pokerRoomsServicePlugin, {
    PokerRoomsService,
} from "../plugins/app/poker/poker-rooms-service.js";
import { BuildTelegramBotServiceTestAppOptions } from "./telegram-bot-service-helper.js";
import {
    buildTelegramSceneBot,
    TelegramSceneBot,
} from "./telegram-scene-bot.js";

export interface PokerBot extends TelegramSceneBot {
    accessService: AccessService;
    pokerRoomsRepository: PokerRoomsRepository;
    pokerRoomsService: PokerRoomsService;
}

export async function buildPokerBot(
    options: BuildTelegramBotServiceTestAppOptions,
): Promise<PokerBot> {
    const bot = await buildTelegramSceneBot({
        ...options,
        plugins: [
            pokerRoomsRepositoryPlugin,
            pokerRoomsServicePlugin,
            pokerHandlersPlugin,
            ...(options.plugins ?? []),
        ],
    });

    return {
        ...bot,
        accessService: bot.app.getDecorator<AccessService>("accessService"),
        pokerRoomsRepository: bot.app.getDecorator<PokerRoomsRepository>(
            "pokerRoomsRepository",
        ),
        pokerRoomsService:
            bot.app.getDecorator<PokerRoomsService>("pokerRoomsService"),
    };
}
