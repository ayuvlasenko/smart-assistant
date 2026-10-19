import {
    Chat,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Update,
} from "@grammyjs/types";
import { type StaticDecode, type TSchema } from "@sinclair/typebox";
import { Redis } from "ioredis";
import { TelegramApiServiceMock } from "./telegram-api-service-mock.js";
import {
    buildTelegramBotServiceTestApp,
    BuildTelegramBotServiceTestAppOptions,
    TelegramBotServiceTestApp,
} from "./telegram-bot-service-helper.js";
import {
    buildTelegramCallbackQueryUpdate,
    buildTelegramTextMessage,
    buildTelegramTextMessageUpdate,
    buildTelegramUser,
} from "./telegram-fixtures.js";

export interface TelegramSceneBot extends TelegramBotServiceTestApp {
    allowUser(telegramId: number): Promise<void>;
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
    readLastKeyboard(): InlineKeyboardButton.CallbackButton[][];
    readLastEditedKeyboard(): InlineKeyboardButton.CallbackButton[][];
}

let updateId = 0;
const userMessageIdOffset = 1_000_000;

export async function buildTelegramSceneBot(
    options: BuildTelegramBotServiceTestAppOptions,
): Promise<TelegramSceneBot> {
    const testApp = await buildTelegramBotServiceTestApp(options);
    const {
        app,
        cache,
        telegramApiService,
        telegramUpdateHandler,
        usersRepository,
    } = testApp;
    const valkey = app.getDecorator<Redis>("valkey");
    const allowedUserIds = new Set<number>();

    const send = async (update: Update) => {
        await telegramUpdateHandler.handle(update);
        return update;
    };

    const allowUser = async (telegramId: number) => {
        if (allowedUserIds.has(telegramId)) {
            return;
        }

        allowedUserIds.add(telegramId);
        await usersRepository.findOneByTelegramIdOrCreate({
            telegramId: String(telegramId),
            isBanned: false,
            languageCode: "en",
        });
    };

    return {
        ...testApp,
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
            const keyboards = await readKeyboardsByMessage(
                telegramApiService,
                chat.id,
            );
            const [messageId, button] = findLatestButton(keyboards, label);

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
        readMessageTexts: (chatId) =>
            readMessageTexts(telegramApiService, chatId),
        readButtonLabels: async (chatId) => {
            const keyboards = await readKeyboardsByMessage(
                telegramApiService,
                chatId,
            );

            return [...keyboards.entries()]
                .sort(([left], [right]) => left - right)
                .flatMap(([, markup]) =>
                    (
                        (markup as InlineKeyboardMarkup | undefined)
                            ?.inline_keyboard ?? []
                    )
                        .flat()
                        .map((button) => button.text),
                );
        },
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

export function buildSessionKey(userId: number): string {
    return `telegram:session:${userId}`;
}

function buildTextUpdate(chat: Chat.PrivateChat, text: string): Update {
    updateId += 1;
    const [commandPart] = text.startsWith("/") ? text.split(" ") : [];

    return buildTelegramTextMessageUpdate({
        update_id: updateId,
        message: {
            message_id: userMessageIdOffset + updateId,
            chat,
            from: buildTelegramUser({ id: chat.id }),
            text,
            ...(commandPart
                ? {
                      entities: [
                          {
                              type: "bot_command",
                              offset: 0,
                              length: commandPart.length,
                          },
                      ],
                  }
                : {}),
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

async function readKeyboardsByMessage(
    telegramApiService: TelegramApiServiceMock,
    chatId: number,
): Promise<Map<number, unknown>> {
    const keyboards = new Map<number, unknown>();
    const sendCalls = [
        ...telegramApiService.sendMessage.mock.calls,
        ...telegramApiService.sendRichMessage.mock.calls,
        ...telegramApiService.sendPhoto.mock.calls,
    ];

    for (const call of sendCalls) {
        const response = await call.result;

        if (response?.ok && call.arguments[0].chat_id === chatId) {
            keyboards.set(
                response.result.message_id,
                call.arguments[0].reply_markup,
            );
        }
    }

    const editCalls = [
        ...telegramApiService.editMessageText.mock.calls,
        ...telegramApiService.editMessageMedia.mock.calls,
        ...telegramApiService.editMessageReplyMarkup.mock.calls,
    ];

    for (const call of editCalls) {
        const response = await call.result;
        const {
            chat_id: editedChatId,
            message_id: messageId,
            reply_markup: markup,
        } = call.arguments[0];

        if (
            response?.ok &&
            editedChatId === chatId &&
            messageId !== undefined
        ) {
            keyboards.set(messageId, markup);
        }
    }

    for (const call of telegramApiService.deleteMessage.mock.calls) {
        const response = await call.result;

        if (response?.ok && call.arguments[0].chat_id === chatId) {
            keyboards.delete(call.arguments[0].message_id);
        }
    }

    return keyboards;
}

function findLatestButton(
    keyboards: Map<number, unknown>,
    label: string,
): [number, InlineKeyboardButton.CallbackButton] {
    const messageIds = [...keyboards.keys()].sort((a, b) => b - a);

    for (const messageId of messageIds) {
        const keyboard =
            (keyboards.get(messageId) as InlineKeyboardMarkup | undefined)
                ?.inline_keyboard ?? [];
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
