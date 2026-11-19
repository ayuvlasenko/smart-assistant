import { subject } from "@casl/ability";
import { Type } from "@sinclair/typebox";
import { ObjectId } from "mongodb";
import { AccessControl } from "../access/access-service.js";
import { TelegramContext } from "../telegram/telegram-context.js";
import {
    buildTelegramHtmlMessage,
    escapeTelegramHtml,
} from "../telegram/telegram-html.js";
import { TelegramMessageContent } from "../telegram/telegram-responder.js";
import { defineScene, TelegramScene } from "../telegram/telegram-scene.js";
import { textStep } from "../telegram/telegram-steps.js";
import { readPokerDeck } from "./poker-decks.js";
import {
    describePokerParticipants,
    validatePokerTitle,
} from "./poker-format.js";
import { renderPokerHistory } from "./poker-history-screen.js";
import {
    renderPokerParticipant,
    renderPokerParticipants,
} from "./poker-participants-screen.js";
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
    const roomIdOf = (scene: PokerRoomSceneControl) =>
        new ObjectId(scene.state.roomId);
    const renderRoom = async (
        ctx: TelegramContext,
        scene: PokerRoomSceneControl,
        renderOpen: (view: PokerRoomView) => TelegramMessageContent,
    ): Promise<TelegramMessageContent[]> => {
        const room = await pokerRoomsService.find(ctx.user, roomIdOf(scene));

        if (!room) {
            const isRemoved = await pokerRoomsService.isRemoved(
                ctx.user,
                roomIdOf(scene),
            );

            return [
                buildTelegramHtmlMessage(
                    [
                        escapeTelegramHtml(
                            ctx.t(
                                isRemoved
                                    ? "poker:roomRemoved"
                                    : "poker:roomMissing",
                            ),
                        ),
                    ],
                    [[scene.button(ctx.t("poker:hideButton"), "hide", null)]],
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
                        renderPokerRound(view, "actions"),
                    ),
            },
            menu: {
                params: pokerRoomScreens.menu,
                render: (ctx, scene) =>
                    renderRoom(ctx, scene, (view) =>
                        renderPokerRound(view, "menu"),
                    ),
            },
            autoReveal: {
                params: pokerRoomScreens.autoReveal,
                render: (ctx, scene) =>
                    renderRoom(ctx, scene, (view) =>
                        renderPokerRound(view, "autoReveal"),
                    ),
            },
            participants: {
                params: pokerRoomScreens.participants,
                render: (ctx, scene, { page }) =>
                    renderRoom(ctx, scene, (view) =>
                        renderPokerParticipants(view, page),
                    ),
            },
            participant: {
                params: pokerRoomScreens.participant,
                render: (ctx, scene, { userId }) =>
                    renderRoom(ctx, scene, (view) =>
                        renderPokerParticipant(view, userId),
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
                    await pokerRoomsService.vote(
                        ctx.user,
                        roomIdOf(scene),
                        vote,
                    );
                },
            },
            reveal: {
                value: pokerRoomButtonValues.reveal,
                handle: async (ctx, scene, round) => {
                    await pokerRoomsService.reveal(
                        ctx.user,
                        roomIdOf(scene),
                        round,
                    );
                },
            },
            startRound: {
                value: pokerRoomButtonValues.startRound,
                handle: async (ctx, scene, options) => {
                    await pokerRoomsService.startRound(
                        ctx.user,
                        roomIdOf(scene),
                        options,
                    );
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
            autoReveal: {
                value: pokerRoomButtonValues.autoReveal,
                handle: async (ctx, scene, autoReveal) => {
                    await pokerRoomsService.changeAutoReveal(
                        ctx.user,
                        roomIdOf(scene),
                        autoReveal,
                    );
                },
            },
            role: {
                value: pokerRoomButtonValues.role,
                handle: async (ctx, scene, { userId, role }) => {
                    await pokerRoomsService.changeRole(
                        ctx.user,
                        roomIdOf(scene),
                        { userId: new ObjectId(userId), role },
                    );

                    if (scene.screen.name === "participant") {
                        await scene.back();
                    }
                },
            },
            remove: {
                value: pokerRoomButtonValues.remove,
                confirm: true,
                handle: async (ctx, scene, userId) => {
                    const removed = await pokerRoomsService.removeParticipant(
                        ctx.user,
                        roomIdOf(scene),
                        new ObjectId(userId),
                    );

                    if (removed && userId === ctx.user._id.toHexString()) {
                        await scene.end({ messages: "delete" });
                        return;
                    }

                    await scene.back();
                },
            },
            participantsPage: {
                value: pokerRoomButtonValues.participantsPage,
                handle: async (ctx, scene, page) => {
                    if (scene.screen.name === "participants") {
                        scene.screen.params.page = page;
                    }
                },
            },
            close: {
                value: pokerRoomButtonValues.close,
                guard: access.guard("update", "PokerRoom"),
                confirm: true,
                handle: async (ctx, scene) => {
                    await pokerRoomsService.close(ctx.user, roomIdOf(scene));
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

                    if (round !== null) {
                        await pokerRoomsService.renameRound(
                            ctx.user,
                            roomIdOf(scene),
                            { round, title: title?.trim() },
                        );
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
        roomUrl: await resolveRoomUrl(ctx.user.botId, room.token),
        canClose: await access.can(
            ctx.user,
            "update",
            subject("PokerRoom", room),
        ),
    };
}
