import { subject } from "@casl/ability";
import { InlineKeyboardButton } from "@grammyjs/types";
import { type Static, Type } from "@sinclair/typebox";
import { ObjectId } from "mongodb";
import { AccessSection, AccessService } from "../access/access-service.js";
import { Translate } from "../i18n-service.js";
import { TelegramContext } from "../telegram/telegram-context.js";
import {
    escapeTelegramHtml,
    formatTelegramHtmlMention,
    formatTelegramHtmlTime,
} from "../telegram/telegram-html.js";
import {
    pageButtons,
    pageOf,
    TelegramPageButton,
} from "../telegram/telegram-pagination.js";
import { TelegramMessageContent } from "../telegram/telegram-responder.js";
import {
    defineScene,
    TelegramScene,
    TelegramSceneControl,
} from "../telegram/telegram-scene.js";
import { numberStep } from "../telegram/telegram-steps.js";
import { UserEntity } from "../users/user-entity.js";
import { InviteEntity, readInviteStatus } from "./invite-entity.js";
import {
    formatGrants,
    formatInviteLabel,
    formatInviteStatus,
    formatInviteUses,
    withoutEmptyRows,
} from "./invite-format.js";
import { InvitesService, InviteUser } from "./invites-service.js";

export const invitesSceneKey = "invites";

const invitesSceneTtlMilliseconds = 24 * 60 * 60 * 1000;
const dayMilliseconds = 24 * 60 * 60 * 1000;
const invitesPageSize = 5;
const invitesPerRow = 2;
const usersPageSize = 10;
const sectionsPageSize = 6;
const grantsPageSize = 6;
const maxUsesLimit = 10_000;
const validForDaysLimit = 365;

const invitesScreenSchema = Type.Union([
    Type.Literal("list"),
    Type.Literal("invite"),
    Type.Literal("users"),
    Type.Literal("form"),
    Type.Literal("sections"),
    Type.Literal("section"),
    Type.Literal("validFor"),
]);

const inviteDraftSchema = Type.Object({
    grants: Type.Array(Type.String()),
    maxUses: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    validForDays: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
});

const invitesStateSchema = Type.Object({
    screen: invitesScreenSchema,
    listPage: Type.Integer({ minimum: 0 }),
    page: Type.Integer({ minimum: 0 }),
    inviteId: Type.Union([Type.String(), Type.Null()]),
    isRevoking: Type.Boolean(),
    section: Type.Union([Type.String(), Type.Null()]),
    draft: inviteDraftSchema,
});

const invitesButtonValues = {
    show: invitesScreenSchema,
    open: Type.String({ pattern: "^[0-9a-f]{24}$" }),
    listPage: Type.Integer({ minimum: 0 }),
    page: Type.Integer({ minimum: 0 }),
    refresh: Type.Null(),
    revoke: Type.Null(),
    create: Type.Null(),
    section: Type.String(),
    toggle: Type.String(),
    validFor: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    askLimit: Type.Null(),
    askValidFor: Type.Null(),
    save: Type.Null(),
};

type InvitesState = Static<typeof invitesStateSchema>;
type InviteDraft = InvitesState["draft"];
type InvitesControl = TelegramSceneControl<
    InvitesState,
    typeof invitesButtonValues
>;
type InviteUrlResolver = (token: string) => Promise<string>;

interface InvitesView {
    ctx: TelegramContext;
    scene: InvitesControl;
    invitesService: InvitesService;
    accessService: AccessService;
    resolveInviteUrl: InviteUrlResolver;
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
    accessService: AccessService,
    resolveInviteUrl: InviteUrlResolver,
): TelegramScene<typeof invitesStateSchema> {
    const canCreate = accessService.guard("create", "Invite");
    const canUpdate = accessService.guard("update", "Invite");

    return defineScene({
        name: "invites",
        state: invitesStateSchema,
        ttl: invitesSceneTtlMilliseconds,
        guard: accessService.guard("read", "Invite"),
        key: () => invitesSceneKey,
        slots: {
            invites: (ctx, scene) =>
                render({
                    ctx,
                    scene,
                    invitesService,
                    accessService,
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
                    if (!accessService.holds(ctx.user, grant)) {
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

function render(view: InvitesView): Promise<TelegramMessageContent> {
    switch (view.scene.state.screen) {
        case "list":
            return renderList(view);
        case "invite":
            return renderInvite(view);
        case "users":
            return renderUsers(view);
        case "form":
            return renderForm(view);
        case "sections":
            return renderSections(view);
        case "section":
            return renderSection(view);
        case "validFor":
            return renderValidFor(view);
    }
}

async function renderList({
    ctx,
    scene,
    invitesService,
    accessService,
}: InvitesView): Promise<TelegramMessageContent> {
    const { t } = ctx;
    const offset = scene.state.listPage * invitesPageSize;
    const page = await invitesService.list(ctx.user, {
        skip: offset,
        limit: invitesPageSize,
    });
    const now = new Date();
    const lines = page.items.length
        ? page.items.map((invite, index) =>
              describeListItem(
                  t,
                  ctx.timeZone,
                  accessService,
                  invite,
                  offset + index + 1,
                  now,
              ),
          )
        : [escapeTelegramHtml(t("invites:listEmpty"))];

    return html(
        [bold(t("invites:listTitle")), ...lines],
        [
            ...inRowsOf(
                invitesPerRow,
                page.items.map((invite, index) =>
                    scene.button(
                        `#${offset + index + 1} ${formatInviteLabel(invite, readInviteStatus(invite, now))}`,
                        "open",
                        invite._id.toHexString(),
                    ),
                ),
            ),
            pageButtons(
                scene.state.listPage,
                page.total,
                invitesPageSize,
                (text, target) => scene.button(text, "listPage", target),
            ),
            accessService.can(ctx.user, "create", "Invite")
                ? [scene.button(t("invites:newInviteButton"), "create", null)]
                : [],
        ],
    );
}

async function renderInvite(
    view: InvitesView,
): Promise<TelegramMessageContent> {
    const { ctx, scene, accessService, resolveInviteUrl } = view;
    const { t } = ctx;
    const invite = await findInvite(view);

    if (!invite) {
        return renderMissing(view);
    }

    const status = readInviteStatus(invite, new Date());
    const isActive = status === "active";
    const canRevoke = accessService.can(
        ctx.user,
        "update",
        subject("Invite", invite),
    );
    const summary = [
        formatInviteStatus(t, status),
        formatInviteUses(invite),
    ].map(escapeTelegramHtml);

    if (invite.expiresAt) {
        summary.push(
            `${escapeTelegramHtml(t("invites:expiresLabel"))} ${formatTelegramHtmlTime(invite.expiresAt, ctx.timeZone)}`,
        );
    }

    return html(
        [
            bold(t("invites:inviteTitle")),
            summary.join(" · "),
            labeled(
                t("invites:accessLabel"),
                formatGrants(accessService, t, invite.grants),
            ),
            `${escapeTelegramHtml(t("invites:createdLabel"))} ${formatTelegramHtmlTime(invite.createdAt, ctx.timeZone)}`,
        ],
        [
            isActive
                ? [
                      {
                          text: t("invites:copyLinkButton"),
                          copy_text: {
                              text: await resolveInviteUrl(invite.token),
                          },
                      },
                  ]
                : [],
            invite.activations.length
                ? [
                      scene.button(
                          t("invites:usersButton", {
                              count: invite.activations.length,
                          }),
                          "show",
                          "users",
                      ),
                  ]
                : [],
            [
                scene.button(t("invites:backButton"), "show", "list"),
                scene.button(t("invites:refreshButton"), "refresh", null),
            ],
            isActive && canRevoke ? [revokeButton(t, scene)] : [],
        ],
    );
}

async function renderUsers(view: InvitesView): Promise<TelegramMessageContent> {
    const { ctx, scene, invitesService } = view;
    const { t } = ctx;
    const invite = await findInvite(view);

    if (!invite) {
        return renderMissing(view);
    }

    const page = await invitesService.listUsers(ctx.user, invite, {
        skip: scene.state.page * usersPageSize,
        limit: usersPageSize,
    });

    return html(
        [
            bold(t("invites:usersTitle")),
            ...page.items.map((item) => describeUser(t, ctx.timeZone, item)),
        ],
        [
            pageButtons(
                scene.state.page,
                page.total,
                usersPageSize,
                pageButton(scene),
            ),
            [
                scene.button(t("invites:backButton"), "show", "invite"),
                scene.button(t("invites:refreshButton"), "refresh", null),
            ],
        ],
    );
}

async function renderForm(view: InvitesView): Promise<TelegramMessageContent> {
    const { ctx, scene } = view;
    const { t } = ctx;
    const { draft } = scene.state;

    return html(describeDraft(view), [
        [
            scene.button(
                t("invites:accessButton", { count: draft.grants.length }),
                "show",
                "sections",
            ),
        ],
        [
            scene.button(
                t("invites:limitButton", {
                    value: formatMaxUses(t, draft.maxUses),
                }),
                "askLimit",
                null,
            ),
        ],
        [
            scene.button(
                t("invites:validForButton", {
                    value: formatValidFor(t, draft.validForDays),
                }),
                "show",
                "validFor",
            ),
        ],
        [
            scene.button(t("invites:backButton"), "show", "list"),
            scene.button(t("invites:createButton"), "save", null),
        ],
    ]);
}

async function renderSections(
    view: InvitesView,
): Promise<TelegramMessageContent> {
    const { ctx, scene, accessService } = view;
    const { t } = ctx;
    const sections = listGrantableSections(accessService, ctx.user);
    const page = pageOf(sections, scene.state.page, sectionsPageSize);

    return html(
        [
            ...describeDraft(view),
            "",
            escapeTelegramHtml(t("invites:chooseSection")),
        ],
        [
            ...page.items.map((section) => [
                scene.button(
                    `${section.title(t)} (${countSelected(section, scene.state.draft.grants)}/${section.grants.length})`,
                    "section",
                    section.name,
                ),
            ]),
            pageButtons(
                scene.state.page,
                page.total,
                sectionsPageSize,
                pageButton(scene),
            ),
            [scene.button(t("invites:backButton"), "show", "form")],
        ],
    );
}

async function renderSection(
    view: InvitesView,
): Promise<TelegramMessageContent> {
    const { ctx, scene, accessService } = view;
    const { t } = ctx;
    const section = listGrantableSections(accessService, ctx.user).find(
        ({ name }) => name === scene.state.section,
    );

    if (!section) {
        return renderSections(view);
    }

    const { grants } = scene.state.draft;
    const page = pageOf(section.grants, scene.state.page, grantsPageSize);

    return html(
        [...describeDraft(view), "", bold(section.title(t))],
        [
            ...page.items.map((grant) => [
                scene.button(
                    `${grants.includes(grant.name) ? "✅" : "⬜"} ${grant.title(t)}`,
                    "toggle",
                    grant.name,
                ),
            ]),
            pageButtons(
                scene.state.page,
                page.total,
                grantsPageSize,
                pageButton(scene),
            ),
            [scene.button(t("invites:backButton"), "show", "sections")],
        ],
    );
}

async function renderValidFor(
    view: InvitesView,
): Promise<TelegramMessageContent> {
    const { ctx, scene } = view;
    const { t } = ctx;

    return html(
        [
            ...describeDraft(view),
            "",
            escapeTelegramHtml(t("invites:chooseValidFor")),
        ],
        [
            [
                scene.button(t("invites:oneDay"), "validFor", 1),
                scene.button(t("invites:sevenDays"), "validFor", 7),
                scene.button(t("invites:thirtyDays"), "validFor", 30),
            ],
            [
                scene.button(t("invites:otherDays"), "askValidFor", null),
                scene.button(t("invites:noExpiry"), "validFor", null),
            ],
            [scene.button(t("invites:backButton"), "show", "form")],
        ],
    );
}

async function renderMissing({
    ctx,
    scene,
}: InvitesView): Promise<TelegramMessageContent> {
    return html(
        [escapeTelegramHtml(ctx.t("invites:inviteMissing"))],
        [[scene.button(ctx.t("invites:backButton"), "show", "list")]],
    );
}

function findInvite({
    ctx,
    scene,
    invitesService,
}: InvitesView): Promise<InviteEntity | null> | null {
    const { inviteId } = scene.state;

    return inviteId
        ? invitesService.find(ctx.user, new ObjectId(inviteId))
        : null;
}

function describeDraft({ ctx, scene, accessService }: InvitesView): string[] {
    const { t } = ctx;
    const { draft } = scene.state;

    return [
        bold(t("invites:formTitle")),
        labeled(
            t("invites:accessLabel"),
            draft.grants.length
                ? formatGrants(accessService, t, draft.grants)
                : t("invites:nothingSelected"),
        ),
        labeled(t("invites:usersLabel"), formatMaxUses(t, draft.maxUses)),
        labeled(
            t("invites:validForLabel"),
            formatValidFor(t, draft.validForDays),
        ),
    ];
}

function describeListItem(
    t: Translate,
    timeZone: string,
    accessService: AccessService,
    invite: InviteEntity,
    number: number,
    now: Date,
): string {
    const parts = [
        `<b>#${number}</b> ${escapeTelegramHtml(formatInviteLabel(invite, readInviteStatus(invite, now)))}`,
        escapeTelegramHtml(formatGrants(accessService, t, invite.grants)),
    ];

    if (invite.expiresAt) {
        parts.push(
            `${escapeTelegramHtml(t("invites:expiresLabel"))} ${formatTelegramHtmlTime(invite.expiresAt, timeZone)}`,
        );
    }

    return parts.join(" · ");
}

function describeUser(
    t: Translate,
    timeZone: string,
    { userId, activatedAt, user }: InviteUser,
): string {
    const name = user
        ? formatTelegramHtmlMention(
              Number(user.telegramId),
              user.firstName ?? user.username ?? user.telegramId,
          )
        : escapeTelegramHtml(
              `${t("invites:unknownUser")} (${userId.toHexString()})`,
          );
    const username = user?.username
        ? ` @${escapeTelegramHtml(user.username)}`
        : "";

    return `${name}${username} · ${formatTelegramHtmlTime(activatedAt, timeZone)}`;
}

function revokeButton(
    t: Translate,
    scene: InvitesControl,
): InlineKeyboardButton {
    return scene.state.isRevoking
        ? {
              ...scene.button(t("invites:confirmRevokeButton"), "revoke", null),
              style: "danger",
          }
        : scene.button(t("invites:revokeButton"), "revoke", null);
}

function pageButton(scene: InvitesControl): TelegramPageButton {
    return (text, target) => scene.button(text, "page", target);
}

function html(
    lines: string[],
    keyboard: InlineKeyboardButton[][],
): TelegramMessageContent {
    return {
        kind: "text",
        parse_mode: "HTML",
        text: lines.join("\n"),
        keyboard: withoutEmptyRows(keyboard),
    };
}

function bold(text: string): string {
    return `<b>${escapeTelegramHtml(text)}</b>`;
}

function labeled(label: string, value: string): string {
    return `${escapeTelegramHtml(label)}: ${escapeTelegramHtml(value)}`;
}

function listGrantableSections(
    accessService: AccessService,
    user: UserEntity,
): AccessSection[] {
    return accessService.listSections().flatMap((section) => {
        const grants = section.grants.filter((grant) =>
            accessService.holds(user, grant.name),
        );

        return grants.length ? [{ ...section, grants }] : [];
    });
}

function countSelected(section: AccessSection, grants: string[]): number {
    return section.grants.filter(({ name }) => grants.includes(name)).length;
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

function formatMaxUses(t: Translate, maxUses: number | null): string {
    return maxUses === null ? t("invites:noLimit") : String(maxUses);
}

function formatValidFor(t: Translate, days: number | null): string {
    return days === null ? t("invites:never") : String(days);
}

function inRowsOf<TItem>(size: number, items: TItem[]): TItem[][] {
    const rows: TItem[][] = [];

    for (let index = 0; index < items.length; index += size) {
        rows.push(items.slice(index, index + size));
    }

    return rows;
}
