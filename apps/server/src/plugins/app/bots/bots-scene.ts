import { type Static, Type } from "@sinclair/typebox";
import { AccessControl } from "../access/access-service.js";
import { Translate } from "../i18n-service.js";
import { TelegramContext } from "../telegram/telegram-context.js";
import {
    defineScene,
    TelegramScene,
    TelegramSceneControl,
    TelegramSceneInputSchemas,
} from "../telegram/telegram-scene.js";
import { textStep } from "../telegram/telegram-steps.js";
import { BotsSubjects, isBotToken } from "./bot-entity.js";
import {
    renderBot,
    renderBotModules,
    renderBotOwnerInvite,
    renderBotsList,
    renderBotStartModule,
} from "./bots-screen.js";
import {
    BotAddResult,
    BotMoveResult,
    BotsService,
    BotTokenResult,
} from "./bots-service.js";

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

export const botsTopic = "bots";

const botsSceneTtlMilliseconds = 24 * 60 * 60 * 1000;
const tokenPayload = Type.Object({ token: Type.String() });
const tokenReplies = {
    alreadyAdded: "bots:alreadyAdded",
    invalidToken: "bots:invalidToken",
    keyMissing: "bots:keyMissing",
    moved: "bots:botMoved",
    otherBot: "bots:otherBot",
    replaced: "bots:tokenReplaced",
    sameBot: "bots:sameBot",
} as const;

export function buildBotsState(): BotsState {
    return { tokenBotId: null };
}

export function createBotsScene(
    botsService: BotsService,
    access: AccessControl<BotsSubjects>,
): TelegramScene<typeof botsStateSchema> {
    const canUpdate = access.guard("update", "Bot");
    const viewOf = (ctx: TelegramContext, scene: BotsSceneControl) => ({
        ctx,
        scene,
        botsService,
    });

    return defineScene({
        name: "bots",
        state: botsStateSchema,
        ttl: botsSceneTtlMilliseconds,
        guard: access.guard("read", "Bot"),
        key: () => "bots",
        watch: () => [botsTopic],
        root: { name: "list", params: {} },
        screens: {
            list: {
                params: botsScreens.list,
                render: async (ctx, scene) => [
                    await renderBotsList(viewOf(ctx, scene)),
                ],
            },
            bot: {
                params: botsScreens.bot,
                render: async (ctx, scene, { botId }) => [
                    await renderBot(viewOf(ctx, scene), botId),
                ],
            },
            modules: {
                params: botsScreens.modules,
                guard: canUpdate,
                render: async (ctx, scene, { botId }) => [
                    await renderBotModules(viewOf(ctx, scene), botId),
                ],
            },
            startModule: {
                params: botsScreens.startModule,
                guard: canUpdate,
                render: async (ctx, scene, { botId }) => [
                    await renderBotStartModule(viewOf(ctx, scene), botId),
                ],
            },
            ownerInvite: {
                params: botsScreens.ownerInvite,
                guard: canUpdate,
                render: async (ctx, scene, { botId, token }) => [
                    await renderBotOwnerInvite(
                        viewOf(ctx, scene),
                        botId,
                        token,
                    ),
                ],
            },
        },
        buttons: {
            add: {
                value: botsButtonValues.add,
                guard: access.guard("create", "Bot"),
                handle: async (ctx, scene) => {
                    scene.state.tokenBotId = null;
                    await scene.ask("token");
                },
            },
            toggle: {
                value: botsButtonValues.toggle,
                guard: canUpdate,
                handle: async (ctx, scene, module) => {
                    if (scene.screen.name === "modules") {
                        await botsService.toggleModule(
                            ctx.user,
                            scene.screen.params.botId,
                            module,
                        );
                    }
                },
            },
            pickStart: {
                value: botsButtonValues.pickStart,
                guard: canUpdate,
                handle: async (ctx, scene, module) => {
                    if (scene.screen.name === "startModule") {
                        await botsService.setStartModule(
                            ctx.user,
                            scene.screen.params.botId,
                            module,
                        );
                    }
                },
            },
            ownerInvite: {
                value: botsButtonValues.ownerInvite,
                guard: canUpdate,
                handle: async (ctx, scene, botId) => {
                    const invite = await botsService.replaceOwnerInvite(
                        ctx.user,
                        botId,
                    );

                    if (invite) {
                        await scene.push("ownerInvite", {
                            botId,
                            token: invite.token,
                        });
                    }
                },
            },
            webhook: {
                value: botsButtonValues.webhook,
                guard: canUpdate,
                handle: async (ctx, scene, botId) => {
                    await botsService.reconnect(ctx.user, botId);
                },
            },
            token: {
                value: botsButtonValues.token,
                guard: canUpdate,
                handle: async (ctx, scene, botId) => {
                    scene.state.tokenBotId = botId;
                    await scene.ask("token");
                },
            },
            move: {
                value: botsButtonValues.move,
                guard: canUpdate,
                confirm: true,
                handle: async (ctx, scene, botId) => {
                    scene.state.tokenBotId = botId;
                    await scene.ask("moveToken");
                },
            },
            stop: {
                value: botsButtonValues.stop,
                guard: canUpdate,
                confirm: true,
                handle: async (ctx, scene, botId) => {
                    await botsService.stop(ctx.user, botId);
                },
            },
            start: {
                value: botsButtonValues.start,
                guard: canUpdate,
                handle: async (ctx, scene, botId) => {
                    await botsService.start(ctx.user, botId);
                },
            },
        },
        inputs: {
            moveToken: {
                payload: tokenPayload,
                guard: canUpdate,
                cleanup: true,
                steps: (step) => [
                    textStep(step, {
                        name: "token",
                        property: "token",
                        prompt: (t) => t("bots:movePrompt"),
                        validate: validateToken,
                    }),
                ],
                complete: async (ctx, scene, { token }) => {
                    const botId = scene.state.tokenBotId;

                    if (botId) {
                        await completeTokenInput(
                            ctx,
                            scene,
                            await botsService.move(
                                ctx.user,
                                botId,
                                token.trim(),
                            ),
                        );
                    }
                },
            },
            token: {
                payload: tokenPayload,
                guard: canUpdate,
                cleanup: true,
                steps: (step) => [
                    textStep(step, {
                        name: "token",
                        property: "token",
                        prompt: (t) => t("bots:tokenPrompt"),
                        validate: validateToken,
                    }),
                ],
                complete: async (ctx, scene, { token }) => {
                    const botId = scene.state.tokenBotId;

                    if (botId) {
                        await completeTokenInput(
                            ctx,
                            scene,
                            await botsService.replaceToken(
                                ctx.user,
                                botId,
                                token.trim(),
                            ),
                        );
                        return;
                    }

                    await completeTokenInput(
                        ctx,
                        scene,
                        await botsService.add(ctx.user, token.trim()),
                    );
                },
            },
        },
    });
}

function validateToken(text: string, t: Translate): string | undefined {
    return isBotToken(text.trim()) ? undefined : t("bots:tokenFormat");
}

async function completeTokenInput(
    ctx: TelegramContext,
    scene: BotsSceneControl,
    result: BotAddResult | BotMoveResult | BotTokenResult,
): Promise<void> {
    if (result.status === "added") {
        await scene.push("ownerInvite", {
            botId: result.bot._id,
            token: result.ownerInvite.token,
        });
        return;
    }

    await ctx.reply(ctx.t(tokenReplies[result.status]));

    if (result.status === "alreadyAdded") {
        await scene.push("bot", { botId: result.botId });
    }
}
