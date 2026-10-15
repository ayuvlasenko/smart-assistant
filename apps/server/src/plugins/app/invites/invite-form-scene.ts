import { InputRichBlock } from "@grammyjs/types";
import { type Static, Type } from "@sinclair/typebox";
import {
    AccessGrant,
    AccessSection,
    AccessService,
} from "../access/access-service.js";
import { Translate } from "../i18n-service.js";
import { pageButtons, pageOf } from "../telegram/telegram-pagination.js";
import { TelegramMessageContent } from "../telegram/telegram-responder.js";
import { TelegramSceneEngine } from "../telegram/telegram-scene-engine.js";
import { defineScene, TelegramScene } from "../telegram/telegram-scene.js";
import { numberStep } from "../telegram/telegram-steps.js";
import { UserEntity } from "../users/user-entity.js";
import { formatGrants, tableCell, withoutEmptyRows } from "./invite-format.js";
import { buildInviteSceneState } from "./invite-scene.js";
import { InvitesService } from "./invites-service.js";

const inviteFormTtlMilliseconds = 30 * 60 * 1000;
const dayMilliseconds = 24 * 60 * 60 * 1000;
const sectionsPageSize = 6;
const grantsPageSize = 6;
const maxUsesLimit = 10_000;
const validForDaysLimit = 365;

const inviteFormScreenSchema = Type.Union([
    Type.Literal("main"),
    Type.Literal("sections"),
    Type.Literal("section"),
    Type.Literal("validFor"),
]);

const inviteFormStateSchema = Type.Object({
    grants: Type.Array(Type.String()),
    maxUses: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    validForDays: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    screen: inviteFormScreenSchema,
    section: Type.Union([Type.String(), Type.Null()]),
    page: Type.Integer({ minimum: 0 }),
});

type InviteFormState = Static<typeof inviteFormStateSchema>;

export function buildInviteFormState(): InviteFormState {
    return {
        grants: [],
        maxUses: 1,
        validForDays: null,
        screen: "main",
        section: null,
        page: 0,
    };
}

export function createInviteFormScene(
    invitesService: InvitesService,
    accessService: AccessService,
    sceneEngine: TelegramSceneEngine,
    inviteScene: TelegramScene,
): TelegramScene<typeof inviteFormStateSchema> {
    return defineScene({
        name: "invites.form",
        state: inviteFormStateSchema,
        ttl: inviteFormTtlMilliseconds,
        blocking: true,
        title: (t) => t("invites:formTitle"),
        guard: accessService.guard("create", "Invite"),
        slots: {
            form: async (ctx, scene): Promise<TelegramMessageContent> => {
                const { t } = ctx;
                const state = scene.state;
                const sections = listGrantableSections(accessService, ctx.user);
                const section = sections.find(
                    ({ name }) => name === state.section,
                );
                const back = (screen: InviteFormState["screen"]) => [
                    scene.button(t("invites:backButton"), "screen", screen),
                ];
                const blocks: InputRichBlock<never>[] = [
                    {
                        type: "heading",
                        size: 3,
                        text: t("invites:formTitle"),
                    },
                    {
                        type: "table",
                        is_bordered: true,
                        cells: [
                            [
                                tableCell(t("invites:accessLabel")),
                                tableCell(
                                    state.grants.length
                                        ? formatGrants(
                                              accessService,
                                              t,
                                              state.grants,
                                          )
                                        : t("invites:nothingSelected"),
                                ),
                            ],
                            [
                                tableCell(t("invites:usersLabel")),
                                tableCell(formatMaxUses(t, state.maxUses)),
                            ],
                            [
                                tableCell(t("invites:validForLabel")),
                                tableCell(
                                    formatValidFor(t, state.validForDays),
                                ),
                            ],
                        ],
                    },
                ];

                if (state.screen === "section" && section) {
                    const page = pageOf(
                        section.grants,
                        state.page,
                        grantsPageSize,
                    );

                    return {
                        kind: "rich",
                        message: {
                            blocks: [
                                ...blocks,
                                {
                                    type: "heading",
                                    size: 4,
                                    text: section.title(t),
                                },
                                {
                                    type: "list",
                                    items: section.grants.map((grant) => ({
                                        blocks: [
                                            {
                                                type: "paragraph",
                                                text: grant.title(t),
                                            },
                                        ],
                                        has_checkbox: true,
                                        ...(state.grants.includes(grant.name)
                                            ? { is_checked: true }
                                            : {}),
                                    })),
                                },
                            ],
                        },
                        keyboard: withoutEmptyRows([
                            ...page.items.map((grant) => [
                                scene.button(
                                    `${state.grants.includes(grant.name) ? "✅" : "⬜"} ${grant.title(t)}`,
                                    "toggle",
                                    grant.name,
                                ),
                            ]),
                            pageButtons(
                                state.page,
                                page.total,
                                grantsPageSize,
                                (text, target) =>
                                    scene.button(text, "page", target),
                            ),
                            back("sections"),
                        ]),
                    };
                }

                if (state.screen === "sections" || state.screen === "section") {
                    const page = pageOf(sections, state.page, sectionsPageSize);

                    return {
                        kind: "rich",
                        message: {
                            blocks: [
                                ...blocks,
                                {
                                    type: "paragraph",
                                    text: t("invites:chooseSection"),
                                },
                            ],
                        },
                        keyboard: withoutEmptyRows([
                            ...page.items.map((item) => [
                                scene.button(
                                    `${item.title(t)} (${countSelected(item, state.grants)}/${item.grants.length})`,
                                    "section",
                                    item.name,
                                ),
                            ]),
                            pageButtons(
                                state.page,
                                page.total,
                                sectionsPageSize,
                                (text, target) =>
                                    scene.button(text, "page", target),
                            ),
                            back("main"),
                        ]),
                    };
                }

                if (state.screen === "validFor") {
                    return {
                        kind: "rich",
                        message: {
                            blocks: [
                                ...blocks,
                                {
                                    type: "paragraph",
                                    text: t("invites:chooseValidFor"),
                                },
                            ],
                        },
                        keyboard: [
                            [
                                scene.button(
                                    t("invites:oneDay"),
                                    "validFor",
                                    1,
                                ),
                                scene.button(
                                    t("invites:sevenDays"),
                                    "validFor",
                                    7,
                                ),
                                scene.button(
                                    t("invites:thirtyDays"),
                                    "validFor",
                                    30,
                                ),
                            ],
                            [
                                scene.button(
                                    t("invites:otherDays"),
                                    "askValidFor",
                                    null,
                                ),
                                scene.button(
                                    t("invites:noExpiry"),
                                    "validFor",
                                    null,
                                ),
                            ],
                            back("main"),
                        ],
                    };
                }

                return {
                    kind: "rich",
                    message: { blocks },
                    keyboard: [
                        [
                            scene.button(
                                t("invites:accessButton", {
                                    count: state.grants.length,
                                }),
                                "screen",
                                "sections",
                            ),
                        ],
                        [
                            scene.button(
                                t("invites:limitButton", {
                                    value: formatMaxUses(t, state.maxUses),
                                }),
                                "askLimit",
                                null,
                            ),
                        ],
                        [
                            scene.button(
                                t("invites:validForButton", {
                                    value: formatValidFor(
                                        t,
                                        state.validForDays,
                                    ),
                                }),
                                "screen",
                                "validFor",
                            ),
                        ],
                        [
                            scene.button(
                                t("invites:createButton"),
                                "create",
                                null,
                            ),
                        ],
                    ],
                };
            },
        },
        buttons: {
            screen: {
                value: inviteFormScreenSchema,
                handle: async (ctx, scene, screen) => {
                    scene.state.screen = screen;
                    scene.state.page = 0;
                },
            },
            section: {
                value: Type.String(),
                handle: async (ctx, scene, section) => {
                    scene.state.screen = "section";
                    scene.state.section = section;
                    scene.state.page = 0;
                },
            },
            toggle: {
                value: Type.String(),
                handle: async (ctx, scene, grant) => {
                    if (!accessService.holds(ctx.user, grant)) {
                        return;
                    }

                    const grants = scene.state.grants;

                    scene.state.grants = grants.includes(grant)
                        ? grants.filter((name) => name !== grant)
                        : [...grants, grant];
                },
            },
            page: {
                value: Type.Integer({ minimum: 0 }),
                handle: async (ctx, scene, page) => {
                    scene.state.page = page;
                },
            },
            validFor: {
                value: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
                handle: async (ctx, scene, days) => {
                    scene.state.validForDays = days;
                    scene.state.screen = "main";
                },
            },
            askLimit: {
                value: Type.Null(),
                handle: (ctx, scene) => scene.ask("maxUses"),
            },
            askValidFor: {
                value: Type.Null(),
                handle: (ctx, scene) => scene.ask("validFor"),
            },
            create: {
                value: Type.Null(),
                handle: async (ctx, scene) => {
                    const { grants, maxUses, validForDays } = scene.state;

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
                    await scene.end({ messages: "delete" });
                    await sceneEngine.start(
                        ctx,
                        inviteScene,
                        buildInviteSceneState(invite._id),
                    );
                },
            },
        },
        inputs: {
            maxUses: {
                payload: Type.Object({
                    maxUses: Type.Optional(Type.Integer({ minimum: 1 })),
                }),
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
                    scene.state.maxUses = payload.maxUses ?? null;
                },
            },
            validFor: {
                payload: Type.Object({
                    days: Type.Integer({ minimum: 1 }),
                }),
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
                    scene.state.validForDays = days;
                    scene.state.screen = "main";
                },
            },
        },
    });
}

function listGrantableSections(
    accessService: AccessService,
    user: UserEntity,
): AccessSection[] {
    return accessService.listSections().flatMap((section) => {
        const grants = section.grants.filter((grant: AccessGrant) =>
            accessService.holds(user, grant.name),
        );

        return grants.length ? [{ ...section, grants }] : [];
    });
}

function readExpiry(validForDays: number | null): Date | undefined {
    if (validForDays === null) {
        return;
    }

    const validForMilliseconds = validForDays * dayMilliseconds;

    return new Date(Date.now() + validForMilliseconds);
}

function countSelected(section: AccessSection, grants: string[]): number {
    return section.grants.filter(({ name }) => grants.includes(name)).length;
}

function formatMaxUses(t: Translate, maxUses: number | null): string {
    return maxUses === null ? t("invites:noLimit") : String(maxUses);
}

function formatValidFor(t: Translate, days: number | null): string {
    return days === null ? t("invites:never") : String(days);
}
