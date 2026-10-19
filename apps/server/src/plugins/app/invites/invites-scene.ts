import { Type } from "@sinclair/typebox";
import { ObjectId } from "mongodb";
import { AccessControl } from "../access/access-service.js";
import { TelegramContext } from "../telegram/telegram-context.js";
import { defineScene, TelegramScene } from "../telegram/telegram-scene.js";
import { numberStep } from "../telegram/telegram-steps.js";
import { InvitesSubjects } from "./invite-entity.js";
import {
    renderInviteForm,
    renderInviteFormSection,
    renderInviteFormSections,
    renderInviteFormValidFor,
} from "./invite-form-screen.js";
import { renderInvite, renderInviteUsers } from "./invite-screen.js";
import { renderInvitesList } from "./invites-list-screen.js";
import {
    InviteDraft,
    invitesButtonValues,
    InvitesSceneControl,
    invitesScreens,
    InvitesState,
    invitesStateSchema,
    InviteUrlResolver,
} from "./invites-schemas.js";
import { InvitesService } from "./invites-service.js";

export const invitesTopic = "invites";

const invitesSceneTtlMilliseconds = 24 * 60 * 60 * 1000;
const dayMilliseconds = 24 * 60 * 60 * 1000;
const maxUsesLimit = 10_000;
const validForDaysLimit = 365;

export function inviteTopic(inviteId: string): string {
    return `invites.invite:${inviteId}`;
}

export function buildInvitesState(): InvitesState {
    return { draft: buildDraft() };
}

export function createInvitesScene(
    invitesService: InvitesService,
    access: AccessControl<InvitesSubjects>,
    resolveInviteUrl: InviteUrlResolver,
): TelegramScene<typeof invitesStateSchema> {
    const canCreate = access.guard("create", "Invite");
    const canUpdate = access.guard("update", "Invite");
    const view = (ctx: TelegramContext, scene: InvitesSceneControl) => ({
        ctx,
        scene,
        invitesService,
        access,
        resolveInviteUrl,
    });

    return defineScene({
        name: "invites",
        state: invitesStateSchema,
        ttl: invitesSceneTtlMilliseconds,
        guard: access.guard("read", "Invite"),
        key: () => "invites",
        root: { name: "list", params: { page: 0 } },
        screens: {
            list: {
                params: invitesScreens.list,
                watch: () => [invitesTopic],
                render: async (ctx, scene, { page }) => [
                    await renderInvitesList(view(ctx, scene), page),
                ],
            },
            invite: {
                params: invitesScreens.invite,
                watch: ({ inviteId }) => [inviteTopic(inviteId)],
                render: async (ctx, scene, { inviteId }) => [
                    await renderInvite(view(ctx, scene), inviteId),
                ],
            },
            users: {
                params: invitesScreens.users,
                watch: ({ inviteId }) => [inviteTopic(inviteId)],
                render: async (ctx, scene, { inviteId, page }) => [
                    await renderInviteUsers(view(ctx, scene), inviteId, page),
                ],
            },
            form: {
                params: invitesScreens.form,
                guard: canCreate,
                render: async (ctx, scene) => [
                    renderInviteForm(view(ctx, scene)),
                ],
            },
            sections: {
                params: invitesScreens.sections,
                guard: canCreate,
                render: async (ctx, scene, { page }) => [
                    renderInviteFormSections(view(ctx, scene), page),
                ],
            },
            section: {
                params: invitesScreens.section,
                guard: canCreate,
                render: async (ctx, scene, { section, page }) => [
                    renderInviteFormSection(view(ctx, scene), section, page),
                ],
            },
            validFor: {
                params: invitesScreens.validFor,
                guard: canCreate,
                render: async (ctx, scene) => [
                    renderInviteFormValidFor(view(ctx, scene)),
                ],
            },
        },
        buttons: {
            page: {
                value: invitesButtonValues.page,
                handle: async (ctx, scene, page) => {
                    if ("page" in scene.screen.params) {
                        scene.screen.params.page = page;
                    }
                },
            },
            revoke: {
                value: invitesButtonValues.revoke,
                guard: canUpdate,
                confirm: true,
                handle: async (ctx, scene, inviteId) => {
                    await invitesService.revoke(
                        ctx.user,
                        new ObjectId(inviteId),
                    );
                },
            },
            create: {
                value: invitesButtonValues.create,
                guard: canCreate,
                handle: async (ctx, scene) => {
                    scene.state.draft = buildDraft();
                    await scene.push("form");
                },
            },
            toggle: {
                value: invitesButtonValues.toggle,
                guard: canCreate,
                handle: async (ctx, scene, grant) => {
                    if (!access.holds(ctx.user, grant)) {
                        return;
                    }

                    const grants = scene.state.draft.grants;

                    scene.state.draft.grants = grants.includes(grant)
                        ? grants.filter((name) => name !== grant)
                        : [...grants, grant];
                },
            },
            validFor: {
                value: invitesButtonValues.validFor,
                guard: canCreate,
                handle: async (ctx, scene, days) => {
                    scene.state.draft.validForDays = days;
                    await scene.back();
                },
            },
            askLimit: {
                value: invitesButtonValues.askLimit,
                guard: canCreate,
                handle: (ctx, scene) => scene.ask("maxUses"),
            },
            askValidFor: {
                value: invitesButtonValues.askValidFor,
                guard: canCreate,
                handle: (ctx, scene) => scene.ask("validFor"),
            },
            save: {
                value: invitesButtonValues.save,
                guard: canCreate,
                handle: async (ctx, scene) => {
                    const { grants, maxUses, validForDays } = scene.state.draft;

                    if (!grants.length) {
                        await ctx.answerCallbackQuery(
                            ctx.t("invites:noAccessSelected"),
                        );
                        return;
                    }

                    const invite = await invitesService.create(ctx.user, {
                        grants,
                        maxUses: maxUses ?? undefined,
                        expiresAt: readExpiry(validForDays),
                    });

                    scene.state.draft = buildDraft();
                    await scene.replace("invite", {
                        inviteId: invite._id.toHexString(),
                    });
                },
            },
        },
        inputs: {
            maxUses: {
                payload: Type.Object({
                    maxUses: Type.Optional(Type.Integer({ minimum: 1 })),
                }),
                guard: canCreate,
                cleanup: true,
                steps: (step) => [
                    numberStep(step, {
                        name: "maxUses",
                        property: "maxUses",
                        prompt: (t) => t("invites:limitPrompt"),
                        optional: true,
                        range: { min: 1, max: maxUsesLimit },
                        maxFractionDigits: 0,
                    }),
                ],
                complete: async (ctx, scene, payload) => {
                    scene.state.draft.maxUses = payload.maxUses ?? null;
                },
            },
            validFor: {
                payload: Type.Object({
                    days: Type.Integer({ minimum: 1 }),
                }),
                guard: canCreate,
                cleanup: true,
                steps: (step) => [
                    numberStep(step, {
                        name: "days",
                        property: "days",
                        prompt: (t) => t("invites:validForPrompt"),
                        range: { min: 1, max: validForDaysLimit },
                        maxFractionDigits: 0,
                    }),
                ],
                complete: async (ctx, scene, { days }) => {
                    scene.state.draft.validForDays = days;
                    await scene.back();
                },
            },
        },
    });
}

function buildDraft(): InviteDraft {
    return { grants: [], maxUses: 1, validForDays: null };
}

function readExpiry(validForDays: number | null): Date | undefined {
    if (validForDays === null) {
        return;
    }

    const validForMilliseconds = validForDays * dayMilliseconds;

    return new Date(Date.now() + validForMilliseconds);
}
