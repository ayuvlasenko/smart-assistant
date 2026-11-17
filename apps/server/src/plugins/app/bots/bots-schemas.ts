import { type Static, Type } from "@sinclair/typebox";
import { TelegramContext } from "../telegram/telegram-context.js";
import {
    TelegramSceneControl,
    TelegramSceneInputSchemas,
} from "../telegram/telegram-scene.js";
import { BotsService } from "./bots-service.js";

export const botsStateSchema = Type.Object({
    tokenBotId: Type.Union([Type.String(), Type.Null()]),
});

export const botsScreens = {
    list: Type.Object({}),
    bot: Type.Object({ botId: Type.String() }),
    modules: Type.Object({ botId: Type.String() }),
    startModule: Type.Object({ botId: Type.String() }),
    ownerInvite: Type.Object({ botId: Type.String(), token: Type.String() }),
};

export const botsButtonValues = {
    add: Type.Null(),
    toggle: Type.String(),
    pickStart: Type.Union([Type.String(), Type.Null()]),
    ownerInvite: Type.String(),
    webhook: Type.String(),
    token: Type.String(),
    move: Type.String(),
    stop: Type.String(),
    start: Type.String(),
};

export type BotsState = Static<typeof botsStateSchema>;

export type BotsSceneControl = TelegramSceneControl<
    BotsState,
    typeof botsButtonValues,
    TelegramSceneInputSchemas,
    typeof botsScreens
>;

export interface BotsView {
    ctx: TelegramContext;
    scene: BotsSceneControl;
    botsService: BotsService;
}
