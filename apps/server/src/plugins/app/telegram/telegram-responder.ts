import {
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    InputMediaAnimation,
    InputMediaAudio,
    InputMediaDocument,
    InputMediaPhoto,
    InputMediaVideo,
    InputRichMessage,
    Message,
    ParseMode,
} from "@grammyjs/types";
import { FastifyBaseLogger } from "fastify";
import {
    TelegramApiClient,
    TelegramMethodArgs,
} from "./telegram-api-service.js";
import { TelegramApiError } from "./telegram-errors.js";

export type TelegramReplyOptions = Omit<
    TelegramMethodArgs<"sendMessage">[0],
    "chat_id" | "text"
>;

export type TelegramMedia =
    | InputMediaAnimation<never>
    | InputMediaAudio<never>
    | InputMediaDocument<never>
    | InputMediaPhoto<never>
    | InputMediaVideo<never>;

export type TelegramMessageContent =
    | {
          kind: "text";
          text: string;
          parse_mode?: ParseMode;
          keyboard?: InlineKeyboardButton[][];
      }
    | {
          kind: "rich";
          message: InputRichMessage<never>;
          keyboard?: InlineKeyboardButton[][];
      }
    | {
          kind: "media";
          media: TelegramMedia;
          keyboard?: InlineKeyboardButton[][];
      };

export type TelegramMessageKind = TelegramMessageContent["kind"];

const notModifiedDescription = "message is not modified";

export class TelegramResponder {
    private isCallbackAnswered = false;
    private readonly chatId: number | undefined;
    private readonly callbackQuery: CallbackQuery | undefined;
    private readonly telegramApiService: TelegramApiClient;
    private readonly log: FastifyBaseLogger;

    constructor(
        chatId: number | undefined,
        callbackQuery: CallbackQuery | undefined,
        telegramApiService: TelegramApiClient,
        log: FastifyBaseLogger,
    ) {
        this.chatId = chatId;
        this.callbackQuery = callbackQuery;
        this.telegramApiService = telegramApiService;
        this.log = log;
    }

    async reply(
        text: string,
        options: TelegramReplyOptions = {},
    ): Promise<Message.TextMessage> {
        const result = await this.telegramApiService.sendMessage({
            ...options,
            chat_id: this.requireChatId(),
            text,
        });

        if (!result.ok) {
            throw new TelegramApiError("sendMessage", result);
        }

        return result.result;
    }

    async send(content: TelegramMessageContent): Promise<Message> {
        const result = await this.sendContent(this.requireChatId(), content);

        if (!result.ok) {
            throw new TelegramApiError(`send ${content.kind} message`, result);
        }

        return result.result;
    }

    async edit(
        messageId: number,
        content: TelegramMessageContent,
    ): Promise<boolean> {
        const target = { chat_id: this.requireChatId(), message_id: messageId };
        const replyMarkup = toInlineKeyboardMarkup(content.keyboard);
        const result =
            content.kind === "media"
                ? await this.telegramApiService.editMessageMedia({
                      ...target,
                      media: content.media,
                      reply_markup: replyMarkup,
                  })
                : await this.telegramApiService.editMessageText({
                      ...target,
                      ...(content.kind === "text"
                          ? {
                                text: content.text,
                                parse_mode: content.parse_mode,
                            }
                          : { rich_message: content.message }),
                      reply_markup: replyMarkup,
                  });

        if (result.ok || result.description.includes(notModifiedDescription)) {
            return true;
        }

        this.log.warn(
            { description: result.description },
            "Failed to edit telegram message",
        );

        return false;
    }

    async deleteMessage(messageId: number): Promise<boolean> {
        const result = await this.telegramApiService.deleteMessage({
            chat_id: this.requireChatId(),
            message_id: messageId,
        });

        if (!result.ok) {
            this.log.warn(
                { description: result.description },
                "Failed to delete telegram message",
            );
        }

        return result.ok;
    }

    async deleteMessages(messageIds: number[]): Promise<void> {
        try {
            const result = await this.telegramApiService.deleteMessages({
                chat_id: this.requireChatId(),
                message_ids: messageIds,
            });

            if (!result.ok) {
                this.log.warn(
                    { description: result.description },
                    "Failed to delete telegram messages",
                );
            }
        } catch (err) {
            this.log.warn({ err }, "Failed to delete telegram messages");
        }
    }

    async removeKeyboard(messageId: number): Promise<void> {
        const result = await this.telegramApiService.editMessageReplyMarkup({
            chat_id: this.requireChatId(),
            message_id: messageId,
        });

        if (!result.ok) {
            this.log.warn(
                { description: result.description },
                "Failed to remove a telegram keyboard",
            );
        }
    }

    async answerCallback(text?: string): Promise<void> {
        if (!this.callbackQuery) {
            throw new Error(
                "Cannot answer a callback query for an update without one",
            );
        }

        const result = await this.telegramApiService.answerCallbackQuery({
            callback_query_id: this.callbackQuery.id,
            ...(text === undefined ? {} : { text }),
        });

        if (!result.ok) {
            throw new TelegramApiError("answerCallbackQuery", result);
        }

        this.isCallbackAnswered = true;
    }

    hasPendingCallback(): boolean {
        return Boolean(this.callbackQuery) && !this.isCallbackAnswered;
    }

    async answerPendingCallback(): Promise<void> {
        if (!this.callbackQuery || this.isCallbackAnswered) {
            return;
        }

        try {
            await this.answerCallback();
        } catch (err) {
            this.log.warn({ err }, "Failed to answer callback query");
        }
    }

    async editKeyboard(
        messageId: number,
        markup: InlineKeyboardMarkup,
    ): Promise<void> {
        const result = await this.telegramApiService.editMessageReplyMarkup({
            chat_id: this.requireChatId(),
            message_id: messageId,
            reply_markup: markup,
        });

        if (!result.ok) {
            throw new TelegramApiError("editMessageReplyMarkup", result);
        }
    }

    private sendContent(chatId: number, content: TelegramMessageContent) {
        const replyMarkup = toInlineKeyboardMarkup(content.keyboard);

        switch (content.kind) {
            case "text":
                return this.telegramApiService.sendMessage({
                    chat_id: chatId,
                    text: content.text,
                    parse_mode: content.parse_mode,
                    reply_markup: replyMarkup,
                });
            case "rich":
                return this.telegramApiService.sendRichMessage({
                    chat_id: chatId,
                    rich_message: content.message,
                    reply_markup: replyMarkup,
                });
            case "media":
                return this.sendMedia(chatId, content.media, replyMarkup);
        }
    }

    private sendMedia(
        chatId: number,
        { type, media, ...options }: TelegramMedia,
        replyMarkup: InlineKeyboardMarkup | undefined,
    ) {
        const target = { chat_id: chatId, reply_markup: replyMarkup };

        switch (type) {
            case "photo":
                return this.telegramApiService.sendPhoto({
                    ...options,
                    ...target,
                    photo: media,
                });
            case "video":
                return this.telegramApiService.sendVideo({
                    ...options,
                    ...target,
                    video: media,
                });
            case "document":
                return this.telegramApiService.sendDocument({
                    ...options,
                    ...target,
                    document: media,
                });
            case "animation":
                return this.telegramApiService.sendAnimation({
                    ...options,
                    ...target,
                    animation: media,
                });
            case "audio":
                return this.telegramApiService.sendAudio({
                    ...options,
                    ...target,
                    audio: media,
                });
        }
    }

    private requireChatId(): number {
        if (this.chatId === undefined) {
            throw new Error(
                "Cannot send a message for an update without a chat",
            );
        }

        return this.chatId;
    }
}

export function toInlineKeyboardMarkup(
    keyboard: InlineKeyboardButton[][] | undefined,
): InlineKeyboardMarkup | undefined {
    return keyboard ? { inline_keyboard: keyboard } : undefined;
}
