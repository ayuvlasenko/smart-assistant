import { AccessControl } from "../access/access-service.js";
import { Translate } from "../i18n-service.js";
import { escapeTelegramHtml } from "../telegram/telegram-html.js";
import { pageButtons } from "../telegram/telegram-pagination.js";
import { TelegramMessageContent } from "../telegram/telegram-responder.js";
import {
    InviteEntity,
    InvitesSubjects,
    readInviteStatus,
} from "./invite-entity.js";
import {
    buildInvitesMessage,
    formatBold,
    formatGrants,
    formatInviteLabel,
    formatLabeledTime,
} from "./invite-format.js";
import { InvitesView } from "./invites-schemas.js";

const invitesPageSize = 5;
const invitesPerRow = 2;

export async function renderInvitesList({
    ctx,
    scene,
    invitesService,
    access,
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
                  access,
                  invite,
                  offset + index + 1,
                  now,
              ),
          )
        : [escapeTelegramHtml(t("invites:listEmpty"))];

    return buildInvitesMessage(
        [formatBold(t("invites:listTitle")), ...lines],
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
            access.can(ctx.user, "create", "Invite")
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

function inRowsOf<TItem>(size: number, items: TItem[]): TItem[][] {
    const rows: TItem[][] = [];

    for (let index = 0; index < items.length; index += size) {
        rows.push(items.slice(index, index + size));
    }

    return rows;
}
