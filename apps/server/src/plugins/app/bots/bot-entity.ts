import { ObjectId } from "mongodb";
import { BaseEntity } from "../../../entity.js";

export interface EncryptedBotToken {
    iv: string;
    tag: string;
    data: string;
}

export interface BotEntity extends Omit<BaseEntity, "_id"> {
    _id: string;
    username?: string;
    token?: EncryptedBotToken;
    modules: string[];
    createdBy?: ObjectId;
    disabledAt?: Date;
}

export interface BotsSubjects {
    Bot: BotEntity;
}

export function botIdOfToken(token: string): string {
    return token.split(":", 1).join("");
}

export function isBotToken(text: string): boolean {
    return /^\d{1,20}:[\w-]{30,60}$/.test(text);
}
