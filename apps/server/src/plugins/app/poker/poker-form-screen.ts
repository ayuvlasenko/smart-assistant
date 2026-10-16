import { Translate } from "../i18n-service.js";
import { escapeTelegramHtml } from "../telegram/telegram-html.js";
import { TelegramMessageContent } from "../telegram/telegram-responder.js";
import { pokerDeckNames, readPokerDeck } from "./poker-decks.js";
import {
    buildPokerMessage,
    formatBold,
    formatPokerDeckName,
} from "./poker-format.js";
import { PokerDraft, PokerView } from "./poker-schemas.js";

export function renderPokerForm({
    ctx,
    scene,
}: PokerView): TelegramMessageContent {
    const { t } = ctx;
    const { draft } = scene.state;

    return buildPokerMessage(describeDraft(t, draft), [
        [
            scene.button(t("poker:deckButton"), "show", "deck"),
            scene.button(t("poker:titleButton"), "askTitle", null),
        ],
        [scene.button(t("poker:autoRevealButton"), "autoReveal", null)],
        [
            scene.button(t("poker:backButton"), "show", "list"),
            {
                ...scene.button(t("poker:createButton"), "save", null),
                style: "success",
            },
        ],
    ]);
}

export function renderPokerDeckChoice({
    ctx,
    scene,
}: PokerView): TelegramMessageContent {
    const { t } = ctx;

    return buildPokerMessage(
        [
            ...describeDraft(t, scene.state.draft),
            "",
            escapeTelegramHtml(t("poker:chooseDeck")),
            ...pokerDeckNames.map(
                (name) =>
                    `${formatBold(formatPokerDeckName(t, name))}: ${escapeTelegramHtml(readPokerDeck(name).cards.join(" "))}`,
            ),
        ],
        [
            ...pokerDeckNames.map((name) => [
                scene.button(formatPokerDeckName(t, name), "deck", name),
            ]),
            [scene.button(t("poker:backButton"), "show", "form")],
        ],
    );
}

function describeDraft(t: Translate, draft: PokerDraft): string[] {
    return [
        formatBold(t("poker:formTitle")),
        formatLabeled(t("poker:deckLabel"), formatPokerDeckName(t, draft.deck)),
        formatLabeled(t("poker:titleLabel"), formatTitle(t, draft)),
        formatLabeled(t("poker:autoRevealLabel"), formatAutoReveal(t, draft)),
    ];
}

function formatLabeled(label: string, value: string): string {
    return `${escapeTelegramHtml(label)}: ${escapeTelegramHtml(value)}`;
}

function formatTitle(t: Translate, draft: PokerDraft): string {
    return draft.title ?? t("poker:noTitle");
}

function formatAutoReveal(t: Translate, draft: PokerDraft): string {
    return t(draft.autoReveal ? "poker:on" : "poker:off");
}
