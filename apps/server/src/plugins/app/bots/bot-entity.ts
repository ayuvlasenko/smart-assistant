import { ObjectId } from "mongodb";
import { BaseEntity } from "../../../entity.js";

export interface EncryptedBotToken {
    iv: string;
    tag: string;
    data: string;
}

export interface BotEntity extends Omit<BaseEntity, "_id"> {
    _id: string;
    telegramId: string;
    isRoot?: boolean;
    username?: string;
    token?: EncryptedBotToken;
    modules: string[];
    startModule?: string;
    createdBy?: ObjectId;
    disabledAt?: Date;
}

export interface BotsSubjects {
    Bot: BotEntity;
}

export const newRootBotId = "root";

export const botTokenPattern = "^\\d{1,20}:[\\w-]{30,60}$";

export function telegramIdOfToken(token: string): string {
    return token.split(":", 1).join("");
}

export function isBotToken(text: string): boolean {
    return new RegExp(botTokenPattern).test(text);
}
