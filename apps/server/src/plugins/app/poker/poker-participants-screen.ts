import { escapeTelegramHtml } from "../telegram/telegram-html.js";
import { pageButtons, pageOf } from "../telegram/telegram-pagination.js";
import { TelegramMessageContent } from "../telegram/telegram-responder.js";
import { buildPokerMessage, formatPokerHeader } from "./poker-format.js";
import { PokerParticipant } from "./poker-room-entity.js";
import { PokerRoomView } from "./poker-schemas.js";

const participantsPageSize = 8;

export const pokerObserverIcon = "👀";

export function renderPokerParticipants(
    view: PokerRoomView,
    page: number,
): TelegramMessageContent {
    const { ctx, scene, room } = view;
    const { t } = ctx;
    const participants = pageOf(room.participants, page, participantsPageSize);

    return buildPokerMessage(
        [
            formatPokerHeader(room, ctx.timeZone, t("poker:participantsTitle")),
            "",
            escapeTelegramHtml(
                t("poker:participantsHint", { icon: pokerObserverIcon }),
            ),
        ],
        [
            ...participants.items.map((participant) => [
                readRoleButton(view, participant),
            ]),
            pageButtons(
                page,
                participants.total,
                participantsPageSize,
                (text, target) =>
                    scene.button(text, "participantsPage", target),
            ),
            [scene.backButton(t("poker:backButton"))],
        ],
    );
}

function readRoleButton(
    { scene, labels }: PokerRoomView,
    participant: PokerParticipant,
) {
    const userId = participant.userId.toHexString();
    const label = labels.get(userId) ?? userId;
    const isObserver = participant.role === "observer";

    return scene.button(
        isObserver ? `${pokerObserverIcon} ${label}` : label,
        "role",
        { userId, role: isObserver ? "voter" : "observer" },
    );
}
