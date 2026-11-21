import { InlineKeyboardButton } from "@grammyjs/types";
import {
    buildTelegramHtmlMessage,
    escapeTelegramHtml,
    formatTelegramHtmlBold,
} from "../telegram/telegram-html.js";
import { loadPage, pageButtons } from "../telegram/telegram-pagination.js";
import { TelegramMessageContent } from "../telegram/telegram-responder.js";
import { formatPokerRoomTitle } from "./poker-format.js";
import { PokerRoomStatus } from "./poker-room-entity.js";
import { PokerView } from "./poker-scene.js";

const roomsPageSize = 5;

export async function renderPokerList(
    view: PokerView,
    page: number,
): Promise<TelegramMessageContent> {
    const { ctx, scene, access } = view;
    const { t } = ctx;
    const canCreate = await access.can(ctx.user, "create", "PokerRoom");

    return renderRooms(view, "open", page, [
        [
            ...(canCreate
                ? [scene.button(t("poker:newRoomButton"), "create", null)]
                : []),
            scene.screenButton(t("poker:closedButton"), "closed", { page: 0 }),
        ],
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
    const rooms = await loadPage(page, roomsPageSize, (request) =>
        pokerRoomsService.list(ctx.user, { ...request, status }),
    );
    const offset = rooms.index * roomsPageSize;
    const labels = rooms.items.map((room, index) =>
        t("poker:roomListItem", {
            title: `#${offset + index + 1} ${formatPokerRoomTitle(room, ctx.timeZone)}`,
            count: room.participants.length,
            round: room.round.number,
        }),
    );

    return buildTelegramHtmlMessage(
        [
            formatTelegramHtmlBold(
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
            pageButtons(rooms, (text, target) =>
                scene.button(text, "page", target),
            ),
            ...actions,
        ],
    );
}
