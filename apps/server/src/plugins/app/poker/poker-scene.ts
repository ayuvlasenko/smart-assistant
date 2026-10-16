import { Type } from "@sinclair/typebox";
import { AccessControl } from "../access/access-service.js";
import { TelegramContext } from "../telegram/telegram-context.js";
import { TelegramMessageContent } from "../telegram/telegram-responder.js";
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
    PokerState,
    pokerStateSchema,
    PokerView,
} from "./poker-schemas.js";

const pokerSceneTtlMilliseconds = 7 * 24 * 60 * 60 * 1000;

const roomTitleLength = 64;

export function pokerRoomsTopic(userId: string): string {
    return `poker.rooms:${userId}`;
}

export function buildPokerState(userId: string): PokerState {
    return { userId, screen: "list", page: 0, draft: buildDraft() };
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

    return defineScene({
        name: "poker",
        state: pokerStateSchema,
        ttl: pokerSceneTtlMilliseconds,
        guard: access.guard("read", "PokerRoom"),
        key: () => "poker",
        watch: (state) => [pokerRoomsTopic(state.userId)],
        slots: {
            poker: (ctx, scene) =>
                render({ ctx, scene, pokerRoomsService, access }),
        },
        buttons: {
            show: {
                value: pokerButtonValues.show,
                handle: async (ctx, scene, screen) => {
                    scene.state.screen = screen;
                    scene.state.page = 0;
                },
            },
            page: {
                value: pokerButtonValues.page,
                handle: async (ctx, scene, page) => {
                    scene.state.page = page;
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
                    scene.state.screen = "form";
                    scene.state.draft = buildDraft();
                },
            },
            deck: {
                value: pokerButtonValues.deck,
                guard: canCreate,
                handle: async (ctx, scene, deck) => {
                    scene.state.draft.deck = deck;
                    scene.state.screen = "form";
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

                    scene.state.screen = "list";
                    scene.state.page = 0;
                    scene.state.draft = buildDraft();
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

async function render(view: PokerView): Promise<TelegramMessageContent> {
    switch (view.scene.state.screen) {
        case "list":
            return renderPokerList(view);
        case "closed":
            return renderPokerClosedList(view);
        case "form":
            return renderPokerForm(view);
        case "deck":
            return renderPokerDeckChoice(view);
    }
}
