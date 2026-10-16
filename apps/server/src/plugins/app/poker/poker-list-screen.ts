import { InlineKeyboardButton } from "@grammyjs/types";
import { escapeTelegramHtml } from "../telegram/telegram-html.js";
import { pageButtons } from "../telegram/telegram-pagination.js";
import { TelegramMessageContent } from "../telegram/telegram-responder.js";
import {
    buildPokerMessage,
    formatBold,
    formatPokerRoomTitle,
} from "./poker-format.js";
import { PokerRoomStatus } from "./poker-room-entity.js";
import { PokerView } from "./poker-schemas.js";

const roomsPageSize = 5;

export function renderPokerList(
    view: PokerView,
): Promise<TelegramMessageContent> {
    const { ctx, scene, access } = view;
    const { t } = ctx;
    const canCreate = access.can(ctx.user, "create", "PokerRoom");

    return renderRooms(view, "open", [
        canCreate
            ? [
                  scene.button(t("poker:newRoomButton"), "create", null),
                  scene.button(t("poker:closedButton"), "show", "closed"),
              ]
            : [],
    ]);
}

export function renderPokerClosedList(
    view: PokerView,
): Promise<TelegramMessageContent> {
    const { ctx, scene } = view;

    return renderRooms(view, "closed", [
        [scene.button(ctx.t("poker:backButton"), "show", "list")],
    ]);
}

async function renderRooms(
    { ctx, scene, pokerRoomsService }: PokerView,
    status: PokerRoomStatus,
    actions: InlineKeyboardButton[][],
): Promise<TelegramMessageContent> {
    const { t } = ctx;
    const offset = scene.state.page * roomsPageSize;
    const page = await pokerRoomsService.list(ctx.user, {
        status,
        skip: offset,
        limit: roomsPageSize,
    });
    const labels = page.items.map((room, index) =>
        t("poker:roomListItem", {
            title: `#${offset + index + 1} ${formatPokerRoomTitle(room, ctx.timeZone)}`,
            count: room.participants.length,
            round: room.round.number,
        }),
    );

    return buildPokerMessage(
        [
            formatBold(
                t(status === "open" ? "poker:listTitle" : "poker:closedTitle"),
            ),
            ...(page.items.length
                ? []
                : [
                      escapeTelegramHtml(
                          t(
                              status === "open"
                                  ? "poker:listEmpty"
                                  : "poker:closedEmpty",
                          ),
                      ),
                  ]),
        ],
        [
            ...page.items.map((room, index) => [
                scene.button(
                    labels[index] ?? "",
                    "open",
                    room._id.toHexString(),
                ),
            ]),
            pageButtons(
                scene.state.page,
                page.total,
                roomsPageSize,
                (text, target) => scene.button(text, "page", target),
            ),
            ...actions,
        ],
    );
}
