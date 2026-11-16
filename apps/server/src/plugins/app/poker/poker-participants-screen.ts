import { InlineKeyboardButton } from "@grammyjs/types";
import { ObjectId } from "mongodb";
import { escapeTelegramHtml } from "../telegram/telegram-html.js";
import { pageButtons, pageOf } from "../telegram/telegram-pagination.js";
import { TelegramMessageContent } from "../telegram/telegram-responder.js";
import {
    buildPokerMessage,
    formatBold,
    formatPokerHeader,
} from "./poker-format.js";
import {
    findPokerParticipant,
    isPokerParticipantIdle,
    PokerParticipant,
} from "./poker-room-entity.js";
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
            describeHeader(view),
            "",
            escapeTelegramHtml(
                t("poker:participantsHint", { icon: pokerObserverIcon }),
            ),
        ],
        [
            ...participants.items.map((participant) => [
                readParticipantButton(view, participant),
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

export function renderPokerParticipant(
    view: PokerRoomView,
    userId: string,
): TelegramMessageContent {
    const { ctx, scene, room } = view;
    const { t } = ctx;
    const participant = findPokerParticipant(room, new ObjectId(userId));

    if (!participant) {
        return buildPokerMessage(
            [
                describeHeader(view),
                "",
                escapeTelegramHtml(t("poker:participantGone")),
            ],
            [[scene.backButton(t("poker:backButton"))]],
        );
    }

    return buildPokerMessage(
        [
            describeHeader(view),
            "",
            formatBold(readLabel(view, participant)),
            ...describeParticipant(view, participant).map(escapeTelegramHtml),
        ],
        [
            [readRoleButton(view, participant)],
            [
                scene.backButton(t("poker:backButton")),
                ...readRemoveButtons(view, participant),
            ],
        ],
    );
}

function describeHeader({ ctx, room }: PokerRoomView): string {
    return formatPokerHeader(
        room,
        ctx.timeZone,
        ctx.t("poker:participantsTitle"),
    );
}

function readParticipantButton(
    view: PokerRoomView,
    participant: PokerParticipant,
): InlineKeyboardButton {
    const label = readLabel(view, participant);

    return view.scene.screenButton(
        participant.role === "observer"
            ? `${pokerObserverIcon} ${label}`
            : label,
        "participant",
        { userId: participant.userId.toHexString() },
    );
}

function readLabel(
    { labels }: PokerRoomView,
    participant: PokerParticipant,
): string {
    const userId = participant.userId.toHexString();

    return labels.get(userId) ?? userId;
}

function describeParticipant(
    { ctx, room }: PokerRoomView,
    participant: PokerParticipant,
): string[] {
    const { t } = ctx;

    if (participant.role === "observer") {
        return [t("poker:participantObserver", { icon: pokerObserverIcon })];
    }

    return [
        t("poker:participantVoter"),
        ...(isPokerParticipantIdle(room, participant)
            ? [t("poker:participantIdle")]
            : []),
    ];
}

function readRoleButton(
    view: PokerRoomView,
    participant: PokerParticipant,
): InlineKeyboardButton {
    const { ctx, scene } = view;
    const isObserver = participant.role === "observer";
    const labels = isOwn(view, participant)
        ? (["poker:voteButton", "poker:watchButton"] as const)
        : (["poker:makeVoterButton", "poker:makeObserverButton"] as const);

    return scene.button(ctx.t(labels[isObserver ? 0 : 1]), "role", {
        userId: participant.userId.toHexString(),
        role: isObserver ? "voter" : "observer",
    });
}

function readRemoveButtons(
    view: PokerRoomView,
    participant: PokerParticipant,
): InlineKeyboardButton[] {
    const { ctx, scene, room } = view;

    if (participant.userId.equals(room.createdBy)) {
        return [];
    }

    const label = isOwn(view, participant)
        ? "poker:leaveButton"
        : "poker:removeButton";

    return [
        {
            ...scene.button(
                ctx.t(
                    scene.isConfirming("remove")
                        ? "poker:confirmRemoveButton"
                        : label,
                ),
                "remove",
                participant.userId.toHexString(),
            ),
            style: "danger",
        },
    ];
}

function isOwn({ ctx }: PokerRoomView, participant: PokerParticipant): boolean {
    return participant.userId.equals(ctx.user._id);
}
