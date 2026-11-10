import { Type } from "@sinclair/typebox";
import { AccessControl } from "../access/access-service.js";
import { TelegramContext } from "../telegram/telegram-context.js";
import { TelegramSceneEngine } from "../telegram/telegram-scene-engine.js";
import { defineScene, TelegramScene } from "../telegram/telegram-scene.js";
import { textStep } from "../telegram/telegram-steps.js";
import { defaultPokerDeckName } from "./poker-decks.js";
import { renderPokerDeckChoice, renderPokerForm } from "./poker-form-screen.js";
import { validatePokerTitle } from "./poker-format.js";
import { renderPokerClosedList, renderPokerList } from "./poker-list-screen.js";
import { PokerSubjects } from "./poker-room-entity.js";
import { buildPokerRoomState } from "./poker-room-scene.js";
import { PokerRoomsService } from "./poker-rooms-service.js";
import {
    pokerButtonValues,
    PokerDraft,
    pokerRoomStateSchema,
    PokerSceneControl,
    pokerScreens,
    PokerState,
    pokerStateSchema,
} from "./poker-schemas.js";

const pokerSceneTtlMilliseconds = 7 * 24 * 60 * 60 * 1000;

const roomTitleLength = 64;

export function pokerRoomsTopic(userId: string): string {
    return `poker.rooms:${userId}`;
}

export function buildPokerState(userId: string): PokerState {
    return { userId, draft: buildDraft() };
}

export function createPokerScene(
    pokerRoomsService: PokerRoomsService,
    access: AccessControl<PokerSubjects>,
    sceneEngine: TelegramSceneEngine,
    roomScene: TelegramScene<typeof pokerRoomStateSchema>,
): TelegramScene<typeof pokerStateSchema> {
    const canCreate = access.guard("create", "PokerRoom");
    const openRoom = (ctx: TelegramContext, roomId: string) =>
        sceneEngine.start(ctx, roomScene, buildPokerRoomState(roomId));
    const view = (ctx: TelegramContext, scene: PokerSceneControl) => ({
        ctx,
        scene,
        pokerRoomsService,
        access,
    });

    return defineScene({
        name: "poker",
        state: pokerStateSchema,
        ttl: pokerSceneTtlMilliseconds,
        guard: access.guard("read", "PokerRoom"),
        key: () => "poker",
        watch: (state) => [pokerRoomsTopic(state.userId)],
        root: { name: "list", params: { page: 0 } },
        screens: {
            list: {
                params: pokerScreens.list,
                render: async (ctx, scene, { page }) => [
                    await renderPokerList(view(ctx, scene), page),
                ],
            },
            closed: {
                params: pokerScreens.closed,
                render: async (ctx, scene, { page }) => [
                    await renderPokerClosedList(view(ctx, scene), page),
                ],
            },
            form: {
                params: pokerScreens.form,
                guard: canCreate,
                render: async (ctx, scene) => [
                    renderPokerForm(view(ctx, scene)),
                ],
            },
            deck: {
                params: pokerScreens.deck,
                guard: canCreate,
                render: async (ctx, scene) => [
                    renderPokerDeckChoice(view(ctx, scene)),
                ],
            },
        },
        buttons: {
            page: {
                value: pokerButtonValues.page,
                handle: async (ctx, scene, page) => {
                    if ("page" in scene.screen.params) {
                        scene.screen.params.page = page;
                    }
                },
            },
            open: {
                value: pokerButtonValues.open,
                handle: (ctx, scene, roomId) => openRoom(ctx, roomId),
            },
            create: {
                value: pokerButtonValues.create,
                guard: canCreate,
                handle: async (ctx, scene) => {
                    scene.state.draft = buildDraft();
                    await scene.push("form");
                },
            },
            deck: {
                value: pokerButtonValues.deck,
                guard: canCreate,
                handle: async (ctx, scene, deck) => {
                    scene.state.draft.deck = deck;
                    await scene.back();
                },
            },
            askTitle: {
                value: pokerButtonValues.askTitle,
                guard: canCreate,
                handle: (ctx, scene) => scene.ask("title"),
            },
            autoReveal: {
                value: pokerButtonValues.autoReveal,
                guard: canCreate,
                handle: async (ctx, scene) => {
                    scene.state.draft.autoReveal =
                        !scene.state.draft.autoReveal;
                },
            },
            save: {
                value: pokerButtonValues.save,
                guard: canCreate,
                handle: async (ctx, scene) => {
                    const { title, deck, autoReveal } = scene.state.draft;
                    const room = await pokerRoomsService.create(ctx.user, {
                        ...(title === null ? {} : { title }),
                        deck,
                        autoReveal,
                    });

                    scene.state.draft = buildDraft();
                    await scene.reset();
                    await openRoom(ctx, room._id.toHexString());
                },
            },
        },
        inputs: {
            title: {
                payload: Type.Object({
                    title: Type.Optional(Type.String()),
                }),
                guard: canCreate,
                cleanup: true,
                steps: (step) => [
                    textStep(step, {
                        name: "title",
                        property: "title",
                        prompt: (t) =>
                            t("poker:roomTitlePrompt", {
                                max: roomTitleLength,
                            }),
                        optional: true,
                        validate: (text, t) =>
                            validatePokerTitle(text, t, roomTitleLength),
                    }),
                ],
                complete: async (ctx, scene, { title }) => {
                    scene.state.draft.title = title?.trim() ?? null;
                },
            },
        },
    });
}

function buildDraft(): PokerDraft {
    return { title: null, deck: defaultPokerDeckName, autoReveal: true };
}
