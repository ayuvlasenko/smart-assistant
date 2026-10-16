import { AccessControl, AccessSection } from "../access/access-service.js";
import { Translate } from "../i18n-service.js";
import { escapeTelegramHtml } from "../telegram/telegram-html.js";
import { pageButtons, pageOf } from "../telegram/telegram-pagination.js";
import { TelegramMessageContent } from "../telegram/telegram-responder.js";
import { UserEntity } from "../users/user-entity.js";
import { InvitesSubjects } from "./invite-entity.js";
import {
    buildInvitesMessage,
    formatBold,
    formatGrants,
    formatLabeled,
    pageButtonOf,
} from "./invite-format.js";
import { InvitesView } from "./invites-schemas.js";

const sectionsPageSize = 6;
const grantsPageSize = 6;

export function renderInviteForm(view: InvitesView): TelegramMessageContent {
    const { ctx, scene } = view;
    const { t } = ctx;

    return buildInvitesMessage(describeDraft(view), [
        [
            scene.button(t("invites:accessButton"), "show", "sections"),
            scene.button(t("invites:limitButton"), "askLimit", null),
        ],
        [scene.button(t("invites:validForButton"), "show", "validFor")],
        [
            scene.button(t("invites:backButton"), "show", "list"),
            {
                ...scene.button(t("invites:createButton"), "save", null),
                style: "success",
            },
        ],
    ]);
}

export function renderInviteFormSections(
    view: InvitesView,
): TelegramMessageContent {
    const { ctx, scene, access } = view;
    const { t } = ctx;
    const sections = listGrantableSections(access, ctx.user);
    const page = pageOf(sections, scene.state.page, sectionsPageSize);

    return buildInvitesMessage(
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
                pageButtonOf(scene),
            ),
            [scene.button(t("invites:backButton"), "show", "form")],
        ],
    );
}

export function renderInviteFormSection(
    view: InvitesView,
): TelegramMessageContent {
    const { ctx, scene, access } = view;
    const { t } = ctx;
    const section = listGrantableSections(access, ctx.user).find(
        ({ name }) => name === scene.state.section,
    );

    if (!section) {
        return renderInviteFormSections(view);
    }

    const { grants } = scene.state.draft;
    const page = pageOf(section.grants, scene.state.page, grantsPageSize);

    return buildInvitesMessage(
        [...describeDraft(view), "", formatBold(section.title(t))],
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
                pageButtonOf(scene),
            ),
            [scene.button(t("invites:backButton"), "show", "sections")],
        ],
    );
}

export function renderInviteFormValidFor(
    view: InvitesView,
): TelegramMessageContent {
    const { ctx, scene } = view;
    const { t } = ctx;

    return buildInvitesMessage(
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

function describeDraft({ ctx, scene, access }: InvitesView): string[] {
    const { t } = ctx;
    const { draft } = scene.state;

    return [
        formatBold(t("invites:formTitle")),
        formatLabeled(
            t("invites:accessLabel"),
            draft.grants.length
                ? formatGrants(access, t, draft.grants)
                : t("invites:nothingSelected"),
        ),
        formatLabeled(t("invites:usersLabel"), formatMaxUses(t, draft.maxUses)),
        formatLabeled(
            t("invites:validForLabel"),
            formatValidFor(t, draft.validForDays),
        ),
    ];
}

function formatMaxUses(t: Translate, maxUses: number | null): string {
    return maxUses === null ? t("invites:noLimit") : String(maxUses);
}

function formatValidFor(t: Translate, days: number | null): string {
    return days === null ? t("invites:never") : String(days);
}

function listGrantableSections(
    access: AccessControl<InvitesSubjects>,
    user: UserEntity,
): AccessSection[] {
    return access.listSections().flatMap((section) => {
        const grants = section.grants.filter((grant) =>
            access.holds(user, grant.name),
        );

        return grants.length ? [{ ...section, grants }] : [];
    });
}

function countSelected(section: AccessSection, grants: string[]): number {
    return section.grants.filter(({ name }) => grants.includes(name)).length;
}
