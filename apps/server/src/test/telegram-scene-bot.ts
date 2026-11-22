import {
    ApiResponse,
    Chat,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
    Update,
} from "@grammyjs/types";
import { type StaticDecode, type TSchema } from "@sinclair/typebox";
import { Redis } from "ioredis";
import {
    buildTelegramApiServiceMock,
    TelegramApiServiceMock,
} from "./telegram-api-service-mock.js";
import {
    buildTelegramBotServiceTestApp,
    BuildTelegramBotServiceTestAppOptions,
    TelegramBotServiceTestApp,
} from "./telegram-bot-service-helper.js";
import {
    buildTelegramCallbackQueryUpdate,
    buildTelegramCommandUpdate,
    buildTelegramTextMessage,
    buildTelegramTextMessageUpdate,
    buildTelegramUser,
    testTelegramBotId,
} from "./telegram-fixtures.js";

export interface TelegramSceneBot extends TelegramBotServiceTestApp {
    allowUser(telegramId: number, grants?: string[]): Promise<void>;
    sendText(chat: Chat.PrivateChat, text: string): Promise<Update>;
    sendCallback(
        chat: Chat.PrivateChat,
        data: string,
        messageId?: number,
    ): Promise<Update>;
    pressButton(chat: Chat.PrivateChat, label: string): Promise<Update>;
    sendPhoto(chat: Chat.PrivateChat): Promise<Update>;
    readSessionField<Schema extends TSchema>(
        userId: number,
        field: string,
        schema: Schema,
    ): Promise<StaticDecode<Schema> | undefined>;
    readSessionFieldTtl(userId: number, field: string): Promise<number>;
    writeSessionField(
        userId: number,
        field: string,
        value: unknown,
    ): Promise<void>;
    readSentTexts(): string[];
    readMessageTexts(chatId: number): Promise<string[]>;
    readButtonLabels(chatId: number): Promise<string[]>;
    readKeyboards(chatId: number): Promise<InlineKeyboardButton[][][]>;
    readAnswerTexts(): (string | undefined)[];
    readLastKeyboard(): InlineKeyboardButton.CallbackButton[][];
    readLastEditedKeyboard(): InlineKeyboardButton.CallbackButton[][];
}

let updateId = 0;
const userMessageIdOffset = 1_000_000;

export async function buildTelegramSceneBot(
    options: BuildTelegramBotServiceTestAppOptions,
): Promise<TelegramSceneBot> {
    const telegramApiService =
        options.telegramApiService ??
        buildTelegramApiServiceMock({ t: options.t });
    const apiCalls: TestApiCall[] = [];
    const testApp = await buildTelegramBotServiceTestApp({
        ...options,
        telegramApiService: recordApiCalls(telegramApiService, apiCalls),
    });
    const { app, cache, telegramBots, telegramUpdateHandler, usersRepository } =
        testApp;
    const valkey = app.getDecorator<Redis>("valkey");
    const allowedUserIds = new Set<number>();

    const send = async (update: Update) => {
        await telegramUpdateHandler.handle(await telegramBots.root(), update);
        return update;
    };

    const allowUser = async (telegramId: number, grants: string[] = []) => {
        if (allowedUserIds.has(telegramId) && !grants.length) {
            return;
        }

        allowedUserIds.add(telegramId);

        const { user } = await usersRepository.findOneByTelegramIdOrCreate({
            botId: (await telegramBots.root()).id,
            telegramId: String(telegramId),
            isBanned: false,
            languageCode: "en",
        });

        if (grants.length) {
            await usersRepository.grantAccess(user._id, grants);
        }
    };

    return {
        ...testApp,
        telegramApiService,
        allowUser,
        sendText: async (chat, text) => {
            await allowUser(chat.id);
            return send(buildTextUpdate(chat, text));
        },
        sendCallback: async (chat, data, messageId = 1) => {
            await allowUser(chat.id);
            return send(buildCallbackUpdate(chat, data, messageId));
        },
        pressButton: async (chat, label) => {
            const [messageId, button] = findLatestButton(
                await readChat(apiCalls, chat.id),
                label,
            );

            await allowUser(chat.id);
            return send(
                buildCallbackUpdate(chat, button.callback_data, messageId),
            );
        },
        sendPhoto: async (chat) => {
            await allowUser(chat.id);
            return send(buildPhotoUpdate(chat));
        },
        readSessionField: (userId, field, schema) =>
            cache.getHashField(buildSessionKey(userId), field, schema),
        readSessionFieldTtl: async (userId, field) => {
            const [ttl] = (await valkey.call(
                "HPTTL",
                buildSessionKey(userId),
                "FIELDS",
                "1",
                field,
            )) as number[];

            return ttl ?? -2;
        },
        writeSessionField: async (userId, field, value) => {
            await valkey.hset(
                buildSessionKey(userId),
                field,
                JSON.stringify(value),
            );
        },
        readSentTexts: () =>
            telegramApiService.sendMessage.mock.calls.map(
                (call) => call.arguments[0].text,
            ),
        readMessageTexts: async (chatId) =>
            (await readChat(apiCalls, chatId))
                .map(({ text }) => text)
                .filter((text) => text !== undefined),
        readButtonLabels: async (chatId) =>
            (await readChat(apiCalls, chatId)).flatMap(({ keyboard }) =>
                keyboard.flat().map(({ text }) => text),
            ),
        readKeyboards: async (chatId) =>
            (await readChat(apiCalls, chatId)).map(({ keyboard }) => keyboard),
        readAnswerTexts: () =>
            telegramApiService.answerCallbackQuery.mock.calls.map(
                (call) => call.arguments[0].text,
            ),
        readLastKeyboard: () =>
            readCallbackButtons(
                telegramApiService.sendMessage.mock.calls.at(-1)?.arguments[0]
                    .reply_markup,
            ),
        readLastEditedKeyboard: () =>
            readCallbackButtons(
                telegramApiService.editMessageReplyMarkup.mock.calls.at(-1)
                    ?.arguments[0].reply_markup,
            ),
    };
}

export function buildSessionKey(
    userId: number,
    botTelegramId = testTelegramBotId,
): string {
    return `telegram:${botTelegramId}:session:${userId}`;
}

function buildTextUpdate(chat: Chat.PrivateChat, text: string): Update {
    updateId += 1;

    const ids = {
        update_id: updateId,
        message_id: userMessageIdOffset + updateId,
    };

    if (text.startsWith("/")) {
        return buildTelegramCommandUpdate(chat, text, ids);
    }

    return buildTelegramTextMessageUpdate({
        update_id: ids.update_id,
        message: {
            message_id: ids.message_id,
            chat,
            from: buildTelegramUser({ id: chat.id }),
            text,
        },
    });
}

function buildCallbackUpdate(
    chat: Chat.PrivateChat,
    data: string,
    messageId: number,
): Update {
    updateId += 1;

    return {
        ...buildTelegramCallbackQueryUpdate({
            id: `callback-${updateId}`,
            from: buildTelegramUser({ id: chat.id }),
            message: buildTelegramTextMessage({ chat, message_id: messageId }),
            data,
        }),
        update_id: updateId,
    };
}

function buildPhotoUpdate(chat: Chat.PrivateChat): Update {
    updateId += 1;

    return {
        update_id: updateId,
        message: {
            message_id: userMessageIdOffset + updateId,
            date: 1776076800,
            chat,
            from: buildTelegramUser({ id: chat.id }),
            photo: [
                {
                    file_id: "photo",
                    file_unique_id: "photo",
                    width: 1,
                    height: 1,
                },
            ],
        },
    };
}

interface TestChatMessage {
    messageId: number;
    text?: string;
    keyboard: InlineKeyboardButton[][];
}

interface TestApiCall {
    method: string;
    params: TestApiCallParams;
    result: Promise<ApiResponse<unknown>>;
}

interface TestApiCallParams {
    chat_id?: number | string;
    message_id?: number;
    message_ids?: number[];
    text?: unknown;
    reply_markup?: unknown;
}

function recordApiCalls(
    client: TelegramApiServiceMock,
    calls: TestApiCall[],
): TelegramApiServiceMock {
    return new Proxy(client, {
        get(target, method, receiver) {
            const value: unknown = Reflect.get(target, method, receiver);

            if (typeof value !== "function" || typeof method !== "string") {
                return value;
            }

            return (...args: [TestApiCallParams?]) => {
                const result = (
                    value as (
                        ...params: [TestApiCallParams?]
                    ) => Promise<ApiResponse<unknown>>
                ).apply(target, args);

                calls.push({ method, params: args[0] ?? {}, result });

                return result;
            };
        },
    });
}

async function readChat(
    calls: TestApiCall[],
    chatId: number,
): Promise<TestChatMessage[]> {
    const messages = new Map<number, TestChatMessage>();

    for (const { method, params, result } of calls) {
        const response = await result;

        if (response.ok && params.chat_id === chatId) {
            applyApiCall(messages, method, params, response.result);
        }
    }

    return [...messages.values()].sort(
        (left, right) => left.messageId - right.messageId,
    );
}

function applyApiCall(
    messages: Map<number, TestChatMessage>,
    method: string,
    params: TestApiCallParams,
    result: unknown,
): void {
    if (method.startsWith("send")) {
        const { message_id: messageId } = result as Message;

        messages.set(messageId, {
            messageId,
            ...textOf(params),
            keyboard: inlineKeyboardOf(params.reply_markup),
        });
    } else if (method.startsWith("edit") && params.message_id !== undefined) {
        const messageId = params.message_id;

        messages.set(messageId, {
            messageId,
            ...messages.get(messageId),
            ...textOf(params),
            keyboard: inlineKeyboardOf(params.reply_markup),
        });
    } else if (method === "deleteMessage" && params.message_id !== undefined) {
        messages.delete(params.message_id);
    } else if (method === "deleteMessages") {
        for (const messageId of params.message_ids ?? []) {
            messages.delete(messageId);
        }
    }
}

function textOf({ text }: TestApiCallParams): { text?: string } {
    return typeof text === "string" ? { text: stripTags(text) } : {};
}

function inlineKeyboardOf(markup: unknown): InlineKeyboardButton[][] {
    return (markup as InlineKeyboardMarkup | undefined)?.inline_keyboard ?? [];
}

function stripTags(html: string): string {
    const [first = "", ...rest] = html.split("<");

    return first + rest.map(dropTag).join("");
}

function dropTag(part: string): string {
    return part.slice(part.indexOf(">") + 1);
}

function findLatestButton(
    messages: TestChatMessage[],
    label: string,
): [number, InlineKeyboardButton.CallbackButton] {
    for (const { messageId, keyboard } of messages.toReversed()) {
        const button = keyboard
            .flat()
            .find(
                (item): item is InlineKeyboardButton.CallbackButton =>
                    "callback_data" in item && item.text === label,
            );

        if (button) {
            return [messageId, button];
        }
    }

    throw new Error(`Expected a "${label}" button`);
}

function readCallbackButtons(
    markup: unknown,
): InlineKeyboardButton.CallbackButton[][] {
    const keyboard = (markup as InlineKeyboardMarkup | undefined)
        ?.inline_keyboard;

    if (!keyboard) {
        throw new Error("Expected an inline keyboard");
    }

    return keyboard.map((row) =>
        row.filter(
            (button): button is InlineKeyboardButton.CallbackButton =>
                "callback_data" in button,
        ),
    );
}
