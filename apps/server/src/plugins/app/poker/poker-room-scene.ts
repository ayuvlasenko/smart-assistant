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
    pokerRoomScreens,
    PokerRoomState,
    pokerRoomStateSchema,
    PokerRoomUrlResolver,
    PokerRoomView,
} from "./poker-schemas.js";

const roundTitleLength = 100;

export function pokerRoomTopic(roomId: string): string {
    return `poker.room:${roomId}`;
}

export function buildPokerRoomState(roomId: string): PokerRoomState {
    return { roomId, titleRound: null };
}

export function createPokerRoomScene(
    pokerRoomsService: PokerRoomsService,
    access: AccessControl<PokerSubjects>,
    resolveRoomUrl: PokerRoomUrlResolver,
): TelegramScene<typeof pokerRoomStateSchema> {
    const load = (ctx: TelegramContext, scene: PokerRoomSceneControl) =>
        pokerRoomsService.find(ctx.user, new ObjectId(scene.state.roomId));
    const renderRoom = async (
        ctx: TelegramContext,
        scene: PokerRoomSceneControl,
        renderOpen: (view: PokerRoomView) => TelegramMessageContent,
    ): Promise<TelegramMessageContent[]> => {
        const room = await load(ctx, scene);

        if (!room) {
            return [
                buildPokerMessage(
                    [escapeTelegramHtml(ctx.t("poker:roomMissing"))],
                    [],
                ),
            ];
        }

        const view = await buildView(
            ctx,
            scene,
            room,
            pokerRoomsService,
            access,
            resolveRoomUrl,
        );

        if (readPokerRoomStatus(room, new Date()) === "closed") {
            return [
                renderPokerHistory(view, {
                    isClosed: true,
                    page:
                        scene.screen.name === "history"
                            ? scene.screen.params.page
                            : 0,
                }),
            ];
        }

        return [renderOpen(view)];
    };

    return defineScene({
        name: "pokerRoom",
        state: pokerRoomStateSchema,
        ttl: pokerRoomIdleMilliseconds,
        guard: access.guard("use", "PokerRoom"),
        key: (state) => state.roomId,
        watch: (state) => [pokerRoomTopic(state.roomId)],
        root: { name: "round", params: {} },
        screens: {
            round: {
                params: pokerRoomScreens.round,
                render: (ctx, scene) =>
                    renderRoom(ctx, scene, (view) =>
                        renderPokerRound(view, { isMenu: false }),
                    ),
            },
            menu: {
                params: pokerRoomScreens.menu,
                render: (ctx, scene) =>
                    renderRoom(ctx, scene, (view) =>
                        renderPokerRound(view, { isMenu: true }),
                    ),
            },
            history: {
                params: pokerRoomScreens.history,
                render: (ctx, scene, { page }) =>
                    renderRoom(ctx, scene, (view) =>
                        renderPokerHistory(view, { isClosed: false, page }),
                    ),
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
                },
            },
            reveal: {
                value: pokerRoomButtonValues.reveal,
                handle: async (ctx, scene, round) => {
                    const room = await load(ctx, scene);

                    if (room) {
                        await pokerRoomsService.reveal(ctx.user, room, round);
                    }
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
                },
            },
            askTitle: {
                value: pokerRoomButtonValues.askTitle,
                handle: async (ctx, scene, round) => {
                    scene.state.titleRound = round;
                    await scene.reset();
                    await scene.ask("title");
                },
            },
            close: {
                value: pokerRoomButtonValues.close,
                guard: access.guard("update", "PokerRoom"),
                confirm: true,
                handle: async (ctx, scene) => {
                    const room = await load(ctx, scene);

                    if (room) {
                        await pokerRoomsService.close(ctx.user, room);
                    }
                },
            },
            hide: {
                value: pokerRoomButtonValues.hide,
                handle: (ctx, scene) => scene.end({ messages: "delete" }),
            },
            page: {
                value: pokerRoomButtonValues.page,
                handle: async (ctx, scene, page) => {
                    if (scene.screen.name === "history") {
                        scene.screen.params.page = page;
                        return;
                    }

                    await scene.replace("history", { page });
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

async function buildView(
    ctx: TelegramContext,
    scene: PokerRoomSceneControl,
    room: PokerRoomEntity,
    pokerRoomsService: PokerRoomsService,
    access: AccessControl<PokerSubjects>,
    resolveRoomUrl: PokerRoomUrlResolver,
): Promise<PokerRoomView> {
    return {
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
}
