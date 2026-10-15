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
import { TelegramApiServiceMock } from "./telegram-api-service-mock.js";
import { BuildTelegramBotServiceTestAppOptions } from "./telegram-bot-service-helper.js";
import {
    buildTelegramSceneBot,
    TelegramSceneBot,
} from "./telegram-scene-bot.js";

export interface InvitesBot extends TelegramSceneBot {
    accessService: AccessService;
    invitesRepository: InvitesRepository;
    invitesService: InvitesService;
    readMessageTexts(chatId: number): Promise<string[]>;
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
        readMessageTexts: (chatId) =>
            readMessageTexts(bot.telegramApiService, chatId),
    };
}

async function readMessageTexts(
    telegramApiService: TelegramApiServiceMock,
    chatId: number,
): Promise<string[]> {
    const messages = new Map<number, string>();

    for (const call of telegramApiService.sendMessage.mock.calls) {
        const response = await call.result;
        const args = call.arguments[0];

        if (response?.ok && args.chat_id === chatId) {
            messages.set(response.result.message_id, stripTags(args.text));
        }
    }

    for (const call of telegramApiService.editMessageText.mock.calls) {
        const args = call.arguments[0];

        if (
            args.chat_id === chatId &&
            args.message_id !== undefined &&
            "text" in args &&
            typeof args.text === "string"
        ) {
            messages.set(args.message_id, stripTags(args.text));
        }
    }

    for (const messageId of readDeletedMessageIds(telegramApiService, chatId)) {
        messages.delete(messageId);
    }

    return [...messages.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, text]) => text);
}

function readDeletedMessageIds(
    telegramApiService: TelegramApiServiceMock,
    chatId: number,
): number[] {
    return [
        ...telegramApiService.deleteMessage.mock.calls.map(
            (call) => call.arguments[0],
        ),
        ...telegramApiService.deleteMessages.mock.calls.flatMap((call) =>
            call.arguments[0].message_ids.map((messageId) => ({
                chat_id: call.arguments[0].chat_id,
                message_id: messageId,
            })),
        ),
    ]
        .filter(({ chat_id: messageChatId }) => messageChatId === chatId)
        .map(({ message_id: messageId }) => messageId);
}

function stripTags(html: string): string {
    const [first = "", ...rest] = html.split("<");

    return first + rest.map(dropTag).join("");
}

function dropTag(part: string): string {
    return part.slice(part.indexOf(">") + 1);
}
