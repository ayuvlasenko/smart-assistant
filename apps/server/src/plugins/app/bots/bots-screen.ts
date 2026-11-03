import { InlineKeyboardButton, WebhookInfo } from "@grammyjs/types";
import { Translate } from "../i18n-service.js";
import { escapeTelegramHtml } from "../telegram/telegram-html.js";
import { TelegramMessageContent } from "../telegram/telegram-responder.js";
import { BotEntity } from "./bot-entity.js";
import { BotsSceneControl, BotsView } from "./bots-schemas.js";
import { BotsService } from "./bots-service.js";

export async function renderBotsList({
    ctx,
    scene,
    botsService,
}: BotsView): Promise<TelegramMessageContent> {
    const { t } = ctx;
    const bots = await botsService.list(ctx.user);

    return buildBotsMessage(
        [
            formatBold(t("bots:listTitle")),
            ...bots.map((bot) =>
                escapeTelegramHtml(
                    [
                        labelOf(t, botsService, bot),
                        statusOf(t, bot),
                        `${t("bots:modulesLabel")}: ${modulesOf(t, botsService, bot)}`,
                    ].join(" · "),
                ),
            ),
        ],
        [
            ...bots.map((bot) => [
                scene.screenButton(labelOf(t, botsService, bot), "bot", {
                    botId: bot._id,
                }),
            ]),
            [scene.button(t("bots:addButton"), "add", null)],
        ],
    );
}

export async function renderBot(
    { ctx, scene, botsService }: BotsView,
    botId: string,
): Promise<TelegramMessageContent> {
    const { t } = ctx;
    const bot = await botsService.find(ctx.user, botId);

    if (!bot) {
        return renderMissing(t, scene);
    }

    const isRoot = botsService.isRoot(bot._id);
    const webhook = bot.disabledAt
        ? undefined
        : await botsService.readWebhook(ctx.user, bot._id);

    return buildBotsMessage(
        [
            formatBold(labelOf(t, botsService, bot)),
            `<code>${escapeTelegramHtml(bot._id)}</code>`,
            formatLabeled(t("bots:statusLabel"), statusOf(t, bot)),
            formatLabeled(
                t("bots:modulesLabel"),
                modulesOf(t, botsService, bot),
            ),
            ...(bot.disabledAt
                ? []
                : [
                      formatLabeled(
                          t("bots:webhookLabel"),
                          describeWebhook(t, webhook),
                      ),
                  ]),
        ],
        [
            [
                scene.screenButton(t("bots:modulesButton"), "modules", {
                    botId: bot._id,
                }),
                ...(isRoot
                    ? []
                    : [
                          scene.button(
                              t("bots:ownerInviteButton"),
                              "ownerInvite",
                              bot._id,
                          ),
                      ]),
            ],
            [
                scene.button(t("bots:webhookButton"), "webhook", bot._id),
                ...(isRoot
                    ? []
                    : [scene.button(t("bots:tokenButton"), "token", bot._id)]),
            ],
            [
                scene.backButton(t("bots:backButton")),
                ...(isRoot ? [] : [switchButton(t, scene, bot)]),
            ],
        ],
    );
}

export async function renderBotModules(
    { ctx, scene, botsService }: BotsView,
    botId: string,
): Promise<TelegramMessageContent> {
    const { t } = ctx;
    const bot = await botsService.find(ctx.user, botId);

    if (!bot) {
        return renderMissing(t, scene);
    }

    return buildBotsMessage(
        [
            formatBold(
                t("bots:modulesTitle", { bot: labelOf(t, botsService, bot) }),
            ),
        ],
        [
            ...botsService
                .listModules()
                .map((module) => [
                    scene.button(
                        `${bot.modules.includes(module.name) ? "✅" : "⬜"} ${module.title(t)}`,
                        "toggle",
                        module.name,
                    ),
                ]),
            [scene.backButton(t("bots:backButton"))],
        ],
    );
}

export async function renderBotOwnerInvite(
    { ctx, scene, botsService, resolveInviteUrl }: BotsView,
    botId: string,
    token: string,
): Promise<TelegramMessageContent> {
    const { t } = ctx;
    const bot = await botsService.find(ctx.user, botId);

    if (!bot) {
        return renderMissing(t, scene);
    }

    const url = await resolveInviteUrl(bot._id, token);

    return buildBotsMessage(
        [
            formatBold(
                t("bots:ownerInviteTitle", {
                    bot: labelOf(t, botsService, bot),
                }),
            ),
            escapeTelegramHtml(t("bots:ownerInviteText")),
            "",
            escapeTelegramHtml(url),
        ],
        [
            [{ text: t("bots:copyLinkButton"), copy_text: { text: url } }],
            [scene.backButton(t("bots:backButton"))],
        ],
    );
}

function renderMissing(
    t: Translate,
    scene: BotsSceneControl,
): TelegramMessageContent {
    return buildBotsMessage(
        [escapeTelegramHtml(t("bots:botMissing"))],
        [[scene.backButton(t("bots:backButton"))]],
    );
}

function buildBotsMessage(
    lines: string[],
    keyboard: InlineKeyboardButton[][],
): TelegramMessageContent {
    return {
        kind: "text",
        parse_mode: "HTML",
        text: lines.join("\n"),
        keyboard: keyboard.filter((row) => row.length),
    };
}

function formatBold(text: string): string {
    return `<b>${escapeTelegramHtml(text)}</b>`;
}

function labelOf(
    t: Translate,
    botsService: BotsService,
    bot: BotEntity,
): string {
    if (botsService.isRoot(bot._id)) {
        return t("bots:rootBot");
    }

    return bot.username ? `@${bot.username}` : bot._id;
}

function statusOf(t: Translate, bot: BotEntity): string {
    return t(bot.disabledAt ? "bots:statusStopped" : "bots:statusActive");
}

function modulesOf(
    t: Translate,
    botsService: BotsService,
    bot: BotEntity,
): string {
    const titles = botsService
        .listModules()
        .filter(({ name }) => bot.modules.includes(name))
        .map(({ title }) => title(t));

    return titles.length ? titles.join(", ") : t("bots:none");
}

function formatLabeled(label: string, value: string): string {
    return `${escapeTelegramHtml(label)}: ${escapeTelegramHtml(value)}`;
}

function describeWebhook(
    t: Translate,
    webhook: WebhookInfo | undefined,
): string {
    if (!webhook?.url) {
        return t("bots:webhookMissing");
    }

    const state = webhook.last_error_message ?? t("bots:webhookOk");

    return webhook.pending_update_count
        ? `${state}, ${t("bots:webhookPending", { count: webhook.pending_update_count })}`
        : state;
}

function switchButton(
    t: Translate,
    scene: BotsSceneControl,
    bot: BotEntity,
): InlineKeyboardButton {
    if (bot.disabledAt) {
        return scene.button(t("bots:startButton"), "start", bot._id);
    }

    return {
        ...scene.button(
            t(
                scene.isConfirming("stop", bot._id)
                    ? "bots:confirmStopButton"
                    : "bots:stopButton",
            ),
            "stop",
            bot._id,
        ),
        style: "danger",
    };
}
