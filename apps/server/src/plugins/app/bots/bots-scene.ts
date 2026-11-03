import { Type } from "@sinclair/typebox";
import { AccessControl } from "../access/access-service.js";
import { TelegramContext } from "../telegram/telegram-context.js";
import { defineScene, TelegramScene } from "../telegram/telegram-scene.js";
import { textStep } from "../telegram/telegram-steps.js";
import { BotsSubjects, isBotToken } from "./bot-entity.js";
import {
    BotInviteUrlResolver,
    botsButtonValues,
    BotsSceneControl,
    botsScreens,
    BotsState,
    botsStateSchema,
} from "./bots-schemas.js";
import {
    renderBot,
    renderBotModules,
    renderBotOwnerInvite,
    renderBotsList,
} from "./bots-screen.js";
import { BotAddResult, BotsService, BotTokenResult } from "./bots-service.js";

export const botsTopic = "bots";

const botsSceneTtlMilliseconds = 24 * 60 * 60 * 1000;

export function buildBotsState(): BotsState {
    return { tokenBotId: null };
}

export function createBotsScene(
    botsService: BotsService,
    access: AccessControl<BotsSubjects>,
    resolveInviteUrl: BotInviteUrlResolver,
): TelegramScene<typeof botsStateSchema> {
    const canUpdate = access.guard("update", "Bot");
    const viewOf = (ctx: TelegramContext, scene: BotsSceneControl) => ({
        ctx,
        scene,
        botsService,
        resolveInviteUrl,
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
            ownerInvite: {
                value: botsButtonValues.ownerInvite,
                guard: canUpdate,
                handle: async (ctx, scene, botId) => {
                    const invite = await botsService.createOwnerInvite(
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
            token: {
                payload: Type.Object({ token: Type.String() }),
                guard: canUpdate,
                cleanup: true,
                steps: (step) => [
                    textStep(step, {
                        name: "token",
                        property: "token",
                        prompt: (t) => t("bots:tokenPrompt"),
                        validate: (text, t) => {
                            return isBotToken(text.trim())
                                ? undefined
                                : t("bots:tokenFormat");
                        },
                    }),
                ],
                complete: async (ctx, scene, { token }) => {
                    const botId = scene.state.tokenBotId;

                    if (botId) {
                        await completeReplacement(
                            ctx,
                            await botsService.replaceToken(
                                ctx.user,
                                botId,
                                token.trim(),
                            ),
                        );
                        return;
                    }

                    await completeAddition(
                        ctx,
                        scene,
                        await botsService.add(ctx.user, token.trim()),
                    );
                },
            },
        },
    });
}

async function completeAddition(
    ctx: TelegramContext,
    scene: BotsSceneControl,
    result: BotAddResult,
): Promise<void> {
    switch (result.status) {
        case "added":
            await scene.push("ownerInvite", {
                botId: result.bot._id,
                token: result.ownerInvite.token,
            });
            return;
        case "alreadyAdded":
            await ctx.reply(ctx.t("bots:alreadyAdded"));
            await scene.push("bot", { botId: result.botId });
            return;
        case "invalidToken":
            await ctx.reply(ctx.t("bots:invalidToken"));
            return;
        case "keyMissing":
            await ctx.reply(ctx.t("bots:keyMissing"));
    }
}

async function completeReplacement(
    ctx: TelegramContext,
    result: BotTokenResult,
): Promise<void> {
    switch (result.status) {
        case "replaced":
            await ctx.reply(ctx.t("bots:tokenReplaced"));
            return;
        case "otherBot":
            await ctx.reply(ctx.t("bots:otherBot"));
            return;
        case "invalidToken":
            await ctx.reply(ctx.t("bots:invalidToken"));
            return;
        case "keyMissing":
            await ctx.reply(ctx.t("bots:keyMissing"));
    }
}
