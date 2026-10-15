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
import emitteryPlugin from "../plugins/external/emittery.js";
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
    readRichTexts(chatId: number): Promise<string[]>;
}

export async function buildInvitesBot(
    options: BuildTelegramBotServiceTestAppOptions,
): Promise<InvitesBot> {
    const bot = await buildTelegramSceneBot({
        ...options,
        plugins: [
            emitteryPlugin,
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
        readRichTexts: (chatId) =>
            readRichTexts(bot.telegramApiService, chatId),
    };
}

async function readRichTexts(
    telegramApiService: TelegramApiServiceMock,
    chatId: number,
): Promise<string[]> {
    const messages = new Map<number, string>();

    for (const call of telegramApiService.sendRichMessage.mock.calls) {
        const response = await call.result;
        const args = call.arguments[0];

        if (response?.ok && args.chat_id === chatId) {
            messages.set(
                response.result.message_id,
                readRichText(args.rich_message),
            );
        }
    }

    for (const call of telegramApiService.editMessageText.mock.calls) {
        const args = call.arguments[0];

        if (
            args.chat_id === chatId &&
            args.message_id !== undefined &&
            "rich_message" in args
        ) {
            messages.set(args.message_id, readRichText(args.rich_message));
        }
    }

    for (const call of telegramApiService.deleteMessage.mock.calls) {
        if (call.arguments[0].chat_id === chatId) {
            messages.delete(call.arguments[0].message_id);
        }
    }

    return [...messages.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, text]) => text);
}

function readRichText(value: unknown): string {
    if (typeof value === "string") {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map(readRichText).join("");
    }

    if (!value || typeof value !== "object") {
        return "";
    }

    return Object.entries(value)
        .filter(([key]) => ["blocks", "items", "cells", "text"].includes(key))
        .map(([, item]) => readRichText(item))
        .join(" ");
}
