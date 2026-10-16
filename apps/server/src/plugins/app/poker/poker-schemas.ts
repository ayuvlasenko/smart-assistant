import { type Static, Type } from "@sinclair/typebox";
import { AccessControl } from "../access/access-service.js";
import { TelegramContext } from "../telegram/telegram-context.js";
import { TelegramSceneControl } from "../telegram/telegram-scene.js";
import { PokerDeck, pokerDeckNames } from "./poker-decks.js";
import { PokerRoomEntity, PokerSubjects } from "./poker-room-entity.js";
import { PokerRoomsService } from "./poker-rooms-service.js";

const objectIdSchema = Type.String({ pattern: "^[0-9a-f]{24}$" });

const pokerDeckNameSchema = Type.Union(
    pokerDeckNames.map((name) => Type.Literal(name)),
);

const pokerScreenSchema = Type.Union([
    Type.Literal("list"),
    Type.Literal("closed"),
    Type.Literal("form"),
    Type.Literal("deck"),
]);

const pokerRoomScreenSchema = Type.Union([
    Type.Literal("round"),
    Type.Literal("menu"),
    Type.Literal("history"),
]);

export const pokerStateSchema = Type.Object({
    userId: objectIdSchema,
    screen: pokerScreenSchema,
    page: Type.Integer({ minimum: 0 }),
    draft: Type.Object({
        title: Type.Union([Type.String(), Type.Null()]),
        deck: pokerDeckNameSchema,
        autoReveal: Type.Boolean(),
    }),
});

export const pokerButtonValues = {
    show: pokerScreenSchema,
    page: Type.Integer({ minimum: 0 }),
    open: objectIdSchema,
    create: Type.Null(),
    deck: pokerDeckNameSchema,
    askTitle: Type.Null(),
    autoReveal: Type.Null(),
    save: Type.Null(),
};

const roundNumberSchema = Type.Integer({ minimum: 1 });

export const pokerRoomStateSchema = Type.Object({
    roomId: objectIdSchema,
    screen: pokerRoomScreenSchema,
    page: Type.Integer({ minimum: 0 }),
    titleRound: Type.Union([roundNumberSchema, Type.Null()]),
    isClosing: Type.Boolean(),
});

export const pokerRoomButtonValues = {
    vote: Type.Object({ round: roundNumberSchema, card: Type.String() }),
    reveal: roundNumberSchema,
    startRound: Type.Object({
        round: roundNumberSchema,
        repeat: Type.Boolean(),
    }),
    askTitle: roundNumberSchema,
    close: Type.Null(),
    hide: Type.Null(),
    show: pokerRoomScreenSchema,
    page: Type.Integer({ minimum: 0 }),
};

export type PokerState = Static<typeof pokerStateSchema>;

export type PokerDraft = PokerState["draft"];

export type PokerRoomState = Static<typeof pokerRoomStateSchema>;

export type PokerSceneControl = TelegramSceneControl<
    PokerState,
    typeof pokerButtonValues
>;

export type PokerRoomSceneControl = TelegramSceneControl<
    PokerRoomState,
    typeof pokerRoomButtonValues
>;

export type PokerRoomUrlResolver = (token: string) => Promise<string>;

export interface PokerView {
    ctx: TelegramContext;
    scene: PokerSceneControl;
    pokerRoomsService: PokerRoomsService;
    access: AccessControl<PokerSubjects>;
}

export interface PokerRoomView {
    ctx: TelegramContext;
    scene: PokerRoomSceneControl;
    room: PokerRoomEntity;
    deck: PokerDeck;
    labels: Map<string, string>;
    roomUrl: string;
    canClose: boolean;
}
