import { AccessSection } from "../access/access-service.js";
import { Translate } from "../i18n-service.js";
import {
    buildTelegramHtmlMessage,
    escapeTelegramHtml,
    formatTelegramHtmlBold,
    formatTelegramHtmlLabeled,
} from "../telegram/telegram-html.js";
import { pageButtons, pageOf } from "../telegram/telegram-pagination.js";
import { TelegramMessageContent } from "../telegram/telegram-responder.js";
import { formatGrants, pageButtonOf } from "./invite-format.js";
import { InvitesView } from "./invites-scene.js";

const sectionsPageSize = 6;
const grantsPageSize = 6;

export function renderInviteForm(view: InvitesView): TelegramMessageContent {
    const { ctx, scene } = view;
    const { t } = ctx;

    return buildTelegramHtmlMessage(describeDraft(view), [
        [
            scene.screenButton(t("invites:accessButton"), "sections", {
                page: 0,
            }),
            scene.button(t("invites:limitButton"), "askLimit", null),
        ],
        [scene.screenButton(t("invites:validForButton"), "validFor")],
        [
            scene.backButton(t("invites:backButton")),
            {
                ...scene.button(t("invites:createButton"), "save", null),
                style: "success",
            },
        ],
    ]);
}

export async function renderInviteFormSections(
    view: InvitesView,
    page: number,
): Promise<TelegramMessageContent> {
    const { ctx, scene, invitesService } = view;
    const { t } = ctx;
    const sections = pageOf(
        await invitesService.listGrantableSections(ctx.user),
        page,
        sectionsPageSize,
    );

    return buildTelegramHtmlMessage(
        [
            ...describeDraft(view),
            "",
            escapeTelegramHtml(t("invites:chooseSection")),
        ],
        [
            ...sections.items.map((section) => [
                scene.screenButton(
                    `${section.title(t)} (${countSelected(section, scene.state.draft.grants)}/${section.grants.length})`,
                    "section",
                    { section: section.name, page: 0 },
                ),
            ]),
            pageButtons(sections, pageButtonOf(scene)),
            [scene.backButton(t("invites:backButton"))],
        ],
    );
}

export async function renderInviteFormSection(
    view: InvitesView,
    sectionName: string,
    page: number,
): Promise<TelegramMessageContent> {
    const { ctx, scene, invitesService } = view;
    const { t } = ctx;
    const sections = await invitesService.listGrantableSections(ctx.user);
    const section = sections.find(({ name }) => name === sectionName);

    if (!section) {
        return renderInviteFormSections(view, 0);
    }

    const { grants } = scene.state.draft;
    const sectionGrants = pageOf(section.grants, page, grantsPageSize);

    return buildTelegramHtmlMessage(
        [...describeDraft(view), "", formatTelegramHtmlBold(section.title(t))],
        [
            ...sectionGrants.items.map((grant) => [
                scene.button(
                    `${grants.includes(grant.name) ? "✅" : "⬜"} ${grant.title(t)}`,
                    "toggle",
                    grant.name,
                ),
            ]),
            pageButtons(sectionGrants, pageButtonOf(scene)),
            [scene.backButton(t("invites:backButton"))],
        ],
    );
}

export function renderInviteFormValidFor(
    view: InvitesView,
): TelegramMessageContent {
    const { ctx, scene } = view;
    const { t } = ctx;

    return buildTelegramHtmlMessage(
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
            [scene.backButton(t("invites:backButton"))],
        ],
    );
}

function describeDraft({ ctx, scene, access }: InvitesView): string[] {
    const { t } = ctx;
    const { draft } = scene.state;

    return [
        formatTelegramHtmlBold(t("invites:formTitle")),
        formatTelegramHtmlLabeled(
            t("invites:accessLabel"),
            draft.grants.length
                ? formatGrants(access, t, draft.grants)
                : t("invites:nothingSelected"),
        ),
        formatTelegramHtmlLabeled(
            t("invites:usersLabel"),
            formatMaxUses(t, draft.maxUses),
        ),
        formatTelegramHtmlLabeled(
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

function countSelected(section: AccessSection, grants: string[]): number {
    return section.grants.filter(({ name }) => grants.includes(name)).length;
}
