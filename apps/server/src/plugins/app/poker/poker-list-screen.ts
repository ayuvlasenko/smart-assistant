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
    page: number,
): Promise<TelegramMessageContent> {
    const { ctx, scene, access } = view;
    const { t } = ctx;
    const canCreate = access.can(ctx.user, "create", "PokerRoom");

    return renderRooms(view, "open", page, [
        canCreate
            ? [
                  scene.button(t("poker:newRoomButton"), "create", null),
                  scene.screenButton(t("poker:closedButton"), "closed", {
                      page: 0,
                  }),
              ]
            : [],
    ]);
}

export function renderPokerClosedList(
    view: PokerView,
    page: number,
): Promise<TelegramMessageContent> {
    const { ctx, scene } = view;

    return renderRooms(view, "closed", page, [
        [scene.backButton(ctx.t("poker:backButton"))],
    ]);
}

async function renderRooms(
    { ctx, scene, pokerRoomsService }: PokerView,
    status: PokerRoomStatus,
    page: number,
    actions: InlineKeyboardButton[][],
): Promise<TelegramMessageContent> {
    const { t } = ctx;
    const offset = page * roomsPageSize;
    const rooms = await pokerRoomsService.list(ctx.user, {
        status,
        skip: offset,
        limit: roomsPageSize,
    });
    const labels = rooms.items.map((room, index) =>
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
            ...(rooms.items.length
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
            ...rooms.items.map((room, index) => [
                scene.button(
                    labels[index] ?? "",
                    "open",
                    room._id.toHexString(),
                ),
            ]),
            pageButtons(page, rooms.total, roomsPageSize, (text, target) =>
                scene.button(text, "page", target),
            ),
            ...actions,
        ],
    );
}
