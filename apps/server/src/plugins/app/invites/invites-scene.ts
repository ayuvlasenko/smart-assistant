import { Type } from "@sinclair/typebox";
import { ObjectId } from "mongodb";
import { AccessControl } from "../access/access-service.js";
import { TelegramMessageContent } from "../telegram/telegram-responder.js";
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
    InvitesState,
    invitesStateSchema,
    InvitesView,
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
    return {
        screen: "list",
        listPage: 0,
        page: 0,
        inviteId: null,
        isRevoking: false,
        section: null,
        draft: buildDraft(),
    };
}

export function createInvitesScene(
    invitesService: InvitesService,
    access: AccessControl<InvitesSubjects>,
    resolveInviteUrl: InviteUrlResolver,
): TelegramScene<typeof invitesStateSchema> {
    const canCreate = access.guard("create", "Invite");
    const canUpdate = access.guard("update", "Invite");

    return defineScene({
        name: "invites",
        state: invitesStateSchema,
        ttl: invitesSceneTtlMilliseconds,
        guard: access.guard("read", "Invite"),
        key: () => "invites",
        watch: watchInvites,
        slots: {
            invites: (ctx, scene) =>
                render({
                    ctx,
                    scene,
                    invitesService,
                    access,
                    resolveInviteUrl,
                }),
        },
        buttons: {
            show: {
                value: invitesButtonValues.show,
                handle: async (ctx, scene, screen) => {
                    scene.state.screen = screen;
                    scene.state.page = 0;
                    scene.state.isRevoking = false;
                },
            },
            open: {
                value: invitesButtonValues.open,
                handle: async (ctx, scene, inviteId) => {
                    scene.state.screen = "invite";
                    scene.state.inviteId = inviteId;
                    scene.state.isRevoking = false;
                },
            },
            listPage: {
                value: invitesButtonValues.listPage,
                handle: async (ctx, scene, page) => {
                    scene.state.listPage = page;
                },
            },
            page: {
                value: invitesButtonValues.page,
                handle: async (ctx, scene, page) => {
                    scene.state.page = page;
                },
            },
            refresh: {
                value: invitesButtonValues.refresh,
                handle: async () => undefined,
            },
            revoke: {
                value: invitesButtonValues.revoke,
                guard: canUpdate,
                handle: async (ctx, scene) => {
                    if (!scene.state.inviteId) {
                        return;
                    }

                    if (!scene.state.isRevoking) {
                        scene.state.isRevoking = true;
                        return;
                    }

                    await invitesService.revoke(
                        ctx.user,
                        new ObjectId(scene.state.inviteId),
                    );
                    scene.state.isRevoking = false;
                },
            },
            create: {
                value: invitesButtonValues.create,
                guard: canCreate,
                handle: async (ctx, scene) => {
                    scene.state.screen = "form";
                    scene.state.draft = buildDraft();
                },
            },
            section: {
                value: invitesButtonValues.section,
                guard: canCreate,
                handle: async (ctx, scene, section) => {
                    scene.state.screen = "section";
                    scene.state.section = section;
                    scene.state.page = 0;
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
                    scene.state.screen = "form";
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

                    scene.state.screen = "invite";
                    scene.state.inviteId = invite._id.toHexString();
                    scene.state.isRevoking = false;
                    scene.state.draft = buildDraft();
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
                    scene.state.screen = "form";
                },
            },
        },
    });
}

function watchInvites({ screen, inviteId }: InvitesState): string[] {
    if (screen === "list") {
        return [invitesTopic];
    }

    if ((screen === "invite" || screen === "users") && inviteId) {
        return [inviteTopic(inviteId)];
    }

    return [];
}

async function render(view: InvitesView): Promise<TelegramMessageContent> {
    switch (view.scene.state.screen) {
        case "list":
            return renderInvitesList(view);
        case "invite":
            return renderInvite(view);
        case "users":
            return renderInviteUsers(view);
        case "form":
            return renderInviteForm(view);
        case "sections":
            return renderInviteFormSections(view);
        case "section":
            return renderInviteFormSection(view);
        case "validFor":
            return renderInviteFormValidFor(view);
    }
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
