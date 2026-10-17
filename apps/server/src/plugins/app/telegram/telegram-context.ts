import { InlineKeyboardMarkup, Message, Update } from "@grammyjs/types";
import Emittery from "emittery";
import { FastifyBaseLogger } from "fastify";
import { Translate } from "../i18n-service.js";
import { UserEntity } from "../users/user-entity.js";
import {
    GuardedTelegramUpdate,
    GuardedTelegramUpdates,
    TelegramUpdateFilter,
} from "./telegram-filters.js";
import {
    TelegramMessageContent,
    TelegramReplyOptions,
    TelegramResponder,
    toInlineKeyboardMarkup,
} from "./telegram-responder.js";
import { TelegramMessageMarkup } from "./telegram-scene-buttons.js";
import { TelegramSession } from "./telegram-session.js";

export type MaybeArray<T> = T | readonly T[];

export interface TelegramContextOptions<TUpdate extends Update | undefined> {
    update: TUpdate;
    user: UserEntity;
    session: TelegramSession;
    log: FastifyBaseLogger;
    t: Translate;
    timeZone: string;
    responder: TelegramResponder;
}

export interface TelegramMessageChange {
    messageId: number;
    markup?: TelegramMessageMarkup;
}

export interface TelegramContextEvents {
    messageSent: TelegramMessageChange;
    messageEdited: TelegramMessageChange;
    messageRemoved: TelegramMessageChange;
}

export class TelegramContext<
    TUpdate extends Update | undefined = Update | undefined,
> {
    readonly update: TUpdate;
    readonly user: UserEntity;
    readonly log: FastifyBaseLogger;
    readonly t: Translate;
    readonly timeZone: string;
    readonly session: TelegramSession;
    readonly events = new Emittery<TelegramContextEvents>();
    private readonly responder: TelegramResponder;

    constructor(options: TelegramContextOptions<TUpdate>) {
        this.update = options.update;
        this.user = options.user;
        this.log = options.log;
        this.t = options.t;
        this.timeZone = options.timeZone;
        this.session = options.session;
        this.responder = options.responder;
    }

    has<TFilter extends TelegramUpdateFilter<Update>>(
        filter: TFilter,
    ): this is TelegramContext<
        NonNullable<TUpdate> & GuardedTelegramUpdate<TFilter>
    >;
    has<const TFilters extends readonly TelegramUpdateFilter<Update>[]>(
        filters: TFilters,
    ): this is TelegramContext<
        NonNullable<TUpdate> & GuardedTelegramUpdates<TFilters>
    >;
    has(filters: MaybeArray<TelegramUpdateFilter<Update>>): boolean {
        const update = this.update;
        const filterList: readonly TelegramUpdateFilter<Update>[] =
            Array.isArray(filters) ? filters : [filters];

        return !!update && filterList.some((filter) => filter(update));
    }

    async reply(
        text: string,
        options?: TelegramReplyOptions,
    ): Promise<Message.TextMessage> {
        const message = await this.responder.reply(text, options);

        await this.events.emit("messageSent", {
            messageId: message.message_id,
            markup: options?.reply_markup,
        });

        return message;
    }

    async send(content: TelegramMessageContent): Promise<Message> {
        const message = await this.responder.send(content);

        await this.events.emit("messageSent", {
            messageId: message.message_id,
            markup: toInlineKeyboardMarkup(content.keyboard),
        });

        return message;
    }

    async edit(
        messageId: number,
        content: TelegramMessageContent,
    ): Promise<boolean> {
        const isEdited = await this.responder.edit(messageId, content);

        if (isEdited) {
            await this.events.emit("messageEdited", {
                messageId,
                markup: toInlineKeyboardMarkup(content.keyboard),
            });
        }

        return isEdited;
    }

    async deleteMessage(messageId: number): Promise<boolean> {
        const isDeleted = await this.responder.deleteMessage(messageId);

        await this.events.emit("messageRemoved", { messageId });

        return isDeleted;
    }

    async deleteMessages(messageIds: number[]): Promise<void> {
        await this.responder.deleteMessages(messageIds);

        for (const messageId of messageIds) {
            await this.events.emit("messageRemoved", { messageId });
        }
    }

    async editKeyboard(
        messageId: number,
        markup: InlineKeyboardMarkup,
    ): Promise<void> {
        await this.responder.editKeyboard(messageId, markup);
        await this.events.emit("messageEdited", {
            messageId,
            markup,
        });
    }

    async removeKeyboard(messageId: number): Promise<void> {
        await this.responder.removeKeyboard(messageId);
        await this.events.emit("messageEdited", { messageId });
    }

    answerCallbackQuery(text?: string): Promise<void> {
        return this.responder.answerCallback(text);
    }

    async notify(text: string): Promise<void> {
        if (this.responder.hasPendingCallback()) {
            await this.responder.answerCallback(text);
            return;
        }

        await this.reply(text);
    }

    editReplyMarkup(markup: InlineKeyboardMarkup): Promise<void> {
        const messageId = this.update?.callback_query?.message?.message_id;

        if (messageId === undefined) {
            throw new Error(
                "Cannot edit a reply markup for an update without a callback message",
            );
        }

        return this.editKeyboard(messageId, markup);
    }
}
