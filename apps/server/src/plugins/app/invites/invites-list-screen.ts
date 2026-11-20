import { AccessControl } from "../access/access-service.js";
import { Translate } from "../i18n-service.js";
import {
    buildTelegramHtmlMessage,
    escapeTelegramHtml,
    formatTelegramHtmlBold,
} from "../telegram/telegram-html.js";
import { inRowsOf } from "../telegram/telegram-keyboard.js";
import { loadPage, pageButtons } from "../telegram/telegram-pagination.js";
import { TelegramMessageContent } from "../telegram/telegram-responder.js";
import {
    InviteEntity,
    InvitesSubjects,
    readInviteStatus,
} from "./invite-entity.js";
import {
    formatGrants,
    formatInviteLabel,
    formatLabeledTime,
    pageButtonOf,
} from "./invite-format.js";
import { InvitesView } from "./invites-scene.js";

const invitesPageSize = 5;
const invitesPerRow = 2;

export async function renderInvitesList(
    { ctx, scene, invitesService, access }: InvitesView,
    page: number,
): Promise<TelegramMessageContent> {
    const { t } = ctx;
    const invites = await loadPage(page, invitesPageSize, (request) =>
        invitesService.list(ctx.user, request),
    );
    const offset = invites.index * invitesPageSize;
    const now = new Date();
    const lines = invites.items.length
        ? invites.items.map((invite, index) =>
              describeListItem(
                  t,
                  ctx.timeZone,
                  access,
                  invite,
                  offset + index + 1,
                  now,
              ),
          )
        : [escapeTelegramHtml(t("invites:listEmpty"))];

    return buildTelegramHtmlMessage(
        [formatTelegramHtmlBold(t("invites:listTitle")), ...lines],
        [
            ...inRowsOf(
                invitesPerRow,
                invites.items.map((invite, index) =>
                    scene.screenButton(
                        `#${offset + index + 1} ${formatInviteLabel(invite, readInviteStatus(invite, now))}`,
                        "invite",
                        { inviteId: invite._id.toHexString() },
                    ),
                ),
            ),
            pageButtons(invites, pageButtonOf(scene)),
            (await access.can(ctx.user, "create", "Invite"))
                ? [scene.button(t("invites:newInviteButton"), "create", null)]
                : [],
        ],
    );
}

function describeListItem(
    t: Translate,
    timeZone: string,
    access: AccessControl<InvitesSubjects>,
    invite: InviteEntity,
    number: number,
    now: Date,
): string {
    const parts = [
        `<b>#${number}</b> ${escapeTelegramHtml(formatInviteLabel(invite, readInviteStatus(invite, now)))}`,
        escapeTelegramHtml(formatGrants(access, t, invite.grants)),
    ];

    if (invite.expiresAt) {
        parts.push(
            formatLabeledTime(
                t("invites:expiresLabel"),
                invite.expiresAt,
                timeZone,
            ),
        );
    }

    return parts.join(" · ");
}
