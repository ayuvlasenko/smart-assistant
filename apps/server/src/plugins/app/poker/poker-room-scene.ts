import { subject } from "@casl/ability";
import { Type } from "@sinclair/typebox";
import { ObjectId } from "mongodb";
import { AccessControl } from "../access/access-service.js";
import { TelegramContext } from "../telegram/telegram-context.js";
import { escapeTelegramHtml } from "../telegram/telegram-html.js";
import { TelegramMessageContent } from "../telegram/telegram-responder.js";
import { defineScene, TelegramScene } from "../telegram/telegram-scene.js";
import { textStep } from "../telegram/telegram-steps.js";
import { readPokerDeck } from "./poker-decks.js";
import {
    buildPokerMessage,
    describePokerParticipants,
    validatePokerTitle,
} from "./poker-format.js";
import { renderPokerHistory } from "./poker-history-screen.js";
import {
    PokerRoomEntity,
    pokerRoomIdleMilliseconds,
    PokerSubjects,
    readPokerRoomStatus,
} from "./poker-room-entity.js";
import { PokerRoomsService } from "./poker-rooms-service.js";
import { renderPokerRound } from "./poker-round-screen.js";
import {
    pokerRoomButtonValues,
    PokerRoomSceneControl,
    PokerRoomState,
    pokerRoomStateSchema,
    PokerRoomUrlResolver,
} from "./poker-schemas.js";

const roundTitleLength = 100;

export function pokerRoomTopic(roomId: string): string {
    return `poker.room:${roomId}`;
}

export function buildPokerRoomState(roomId: string): PokerRoomState {
    return {
        roomId,
        screen: "round",
        page: 0,
        titleRound: null,
        isClosing: false,
    };
}

export function createPokerRoomScene(
    pokerRoomsService: PokerRoomsService,
    access: AccessControl<PokerSubjects>,
    resolveRoomUrl: PokerRoomUrlResolver,
): TelegramScene<typeof pokerRoomStateSchema> {
    const load = (ctx: TelegramContext, scene: PokerRoomSceneControl) =>
        pokerRoomsService.find(ctx.user, new ObjectId(scene.state.roomId));

    return defineScene({
        name: "pokerRoom",
        state: pokerRoomStateSchema,
        ttl: pokerRoomIdleMilliseconds,
        guard: access.guard("use", "PokerRoom"),
        key: (state) => state.roomId,
        watch: (state) => [pokerRoomTopic(state.roomId)],
        slots: {
            room: async (ctx, scene) => {
                const room = await load(ctx, scene);

                return room
                    ? render(
                          ctx,
                          scene,
                          room,
                          pokerRoomsService,
                          access,
                          resolveRoomUrl,
                      )
                    : buildPokerMessage(
                          [escapeTelegramHtml(ctx.t("poker:roomMissing"))],
                          [],
                      );
            },
        },
        buttons: {
            vote: {
                value: pokerRoomButtonValues.vote,
                handle: async (ctx, scene, vote) => {
                    const room = await load(ctx, scene);

                    if (room) {
                        await pokerRoomsService.vote(ctx.user, room, vote);
                    }

                    scene.state.isClosing = false;
                },
            },
            reveal: {
                value: pokerRoomButtonValues.reveal,
                handle: async (ctx, scene, round) => {
                    const room = await load(ctx, scene);

                    if (room) {
                        await pokerRoomsService.reveal(ctx.user, room, round);
                    }

                    scene.state.isClosing = false;
                },
            },
            startRound: {
                value: pokerRoomButtonValues.startRound,
                handle: async (ctx, scene, options) => {
                    const room = await load(ctx, scene);

                    if (room) {
                        await pokerRoomsService.startRound(
                            ctx.user,
                            room,
                            options,
                        );
                    }

                    scene.state.screen = "round";
                    scene.state.isClosing = false;
                },
            },
            askTitle: {
                value: pokerRoomButtonValues.askTitle,
                handle: async (ctx, scene, round) => {
                    scene.state.titleRound = round;
                    scene.state.screen = "round";
                    scene.state.isClosing = false;
                    await scene.ask("title");
                },
            },
            close: {
                value: pokerRoomButtonValues.close,
                guard: access.guard("update", "PokerRoom"),
                handle: async (ctx, scene) => {
                    if (!scene.state.isClosing) {
                        scene.state.isClosing = true;
                        return;
                    }

                    const room = await load(ctx, scene);

                    if (room) {
                        await pokerRoomsService.close(ctx.user, room);
                    }

                    scene.state.isClosing = false;
                },
            },
            hide: {
                value: pokerRoomButtonValues.hide,
                handle: (ctx, scene) => scene.end({ messages: "delete" }),
            },
            show: {
                value: pokerRoomButtonValues.show,
                handle: async (ctx, scene, screen) => {
                    scene.state.screen = screen;
                    scene.state.page = 0;
                    scene.state.isClosing = false;
                },
            },
            page: {
                value: pokerRoomButtonValues.page,
                handle: async (ctx, scene, page) => {
                    scene.state.page = page;
                },
            },
        },
        inputs: {
            title: {
                payload: Type.Object({
                    title: Type.Optional(Type.String()),
                }),
                cleanup: true,
                steps: (step) => [
                    textStep(step, {
                        name: "title",
                        property: "title",
                        prompt: (t) =>
                            t("poker:roundTitlePrompt", {
                                max: roundTitleLength,
                            }),
                        optional: true,
                        validate: (text, t) =>
                            validatePokerTitle(text, t, roundTitleLength),
                    }),
                ],
                complete: async (ctx, scene, { title }) => {
                    const round = scene.state.titleRound;
                    const room = await load(ctx, scene);

                    if (room && round !== null) {
                        await pokerRoomsService.renameRound(ctx.user, room, {
                            round,
                            title: title?.trim(),
                        });
                    }

                    scene.state.titleRound = null;
                },
            },
        },
    });
}

async function render(
    ctx: TelegramContext,
    scene: PokerRoomSceneControl,
    room: PokerRoomEntity,
    pokerRoomsService: PokerRoomsService,
    access: AccessControl<PokerSubjects>,
    resolveRoomUrl: PokerRoomUrlResolver,
): Promise<TelegramMessageContent> {
    const view = {
        ctx,
        scene,
        room,
        deck: readPokerDeck(room.deck),
        labels: describePokerParticipants(
            ctx.t,
            room,
            await pokerRoomsService.findUsers(room),
            ctx.user._id,
        ),
        roomUrl: await resolveRoomUrl(room.token),
        canClose: access.can(ctx.user, "update", subject("PokerRoom", room)),
    };

    if (readPokerRoomStatus(room, new Date()) === "closed") {
        return renderPokerHistory(view, { isClosed: true });
    }

    return scene.state.screen === "history"
        ? renderPokerHistory(view, { isClosed: false })
        : renderPokerRound(view);
}
