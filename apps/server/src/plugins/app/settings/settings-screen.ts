import { InlineKeyboardButton } from "@grammyjs/types";
import { Translate } from "../i18n-service.js";
import { escapeTelegramHtml } from "../telegram/telegram-html.js";
import { TelegramMessageContent } from "../telegram/telegram-responder.js";
import { SettingsView } from "./settings-schemas.js";
import {
    ChoicesSetting,
    Setting,
    SettingsService,
} from "./settings-service.js";
import { readUserChoice, UserSetting } from "./user-settings-service.js";

export function renderOwnSettings(view: SettingsView): TelegramMessageContent {
    const { ctx, scene, userSettingsService, canChangeBot } = view;
    const { t } = ctx;
    const sections = userSettingsService.listSections(ctx.user.botId);

    return buildSettingsMessage(
        [
            formatBold(t("settings:title")),
            ...sections.flatMap((section) => [
                "",
                formatBold(section.title(t)),
                ...section.settings.map((setting) =>
                    escapeTelegramHtml(
                        `${setting.title(t)}: ${formatOwnValue(t, setting, view)}`,
                    ),
                ),
            ]),
        ],
        [
            ...sections
                .flatMap(({ settings }) => settings)
                .map((setting) => [
                    scene.button(
                        `${setting.emoji} ${setting.title(t)}`,
                        "openOwn",
                        setting.name,
                    ),
                ]),
            canChangeBot
                ? [scene.screenButton(t("settings:botButton"), "bot")]
                : [],
        ],
    );
}

export function renderOwnSettingChoice(
    view: SettingsView,
    setting: UserSetting,
): TelegramMessageContent {
    const { ctx, scene } = view;
    const { t } = ctx;
    const chosen = readUserChoice(setting, ctx.user);

    return buildSettingsMessage(
        [formatBold(t("settings:title")), "", formatBold(setting.title(t))],
        [
            ...setting
                .options(ctx.user.botId)
                .map((option) => [
                    scene.button(
                        `${option.value === chosen ? "🔘" : "⚪"} ${option.title(t)}`,
                        "pick",
                        option.value,
                    ),
                ]),
            [scene.backButton(t("settings:backButton"))],
        ],
    );
}

export function renderBotSettings(view: SettingsView): TelegramMessageContent {
    const { ctx, scene, settingsService } = view;
    const { t } = ctx;
    const sections = settingsService.listSections(ctx.user.botId);
    const buttons = sections
        .flatMap(({ settings }) => settings)
        .map((setting) => [
            scene.button(
                `${setting.emoji} ${setting.title(t)}`,
                "open",
                setting.name,
            ),
        ]);

    return buildSettingsMessage(
        [
            formatBold(t("settings:botTitle")),
            ...sections.flatMap((section) => [
                "",
                formatBold(section.title(t)),
                ...section.settings.map((setting) =>
                    escapeTelegramHtml(
                        `${setting.title(t)}: ${formatValue(t, setting, settingsService, ctx.user.botId)}`,
                    ),
                ),
            ]),
        ],
        [...buttons, [scene.backButton(t("settings:backButton"))]],
    );
}

export function renderSettingsChoices(
    view: SettingsView,
    setting: ChoicesSetting,
): TelegramMessageContent {
    const { ctx, scene, settingsService } = view;
    const { t } = ctx;
    const selected = settingsService.read(setting, ctx.user.botId);

    return buildSettingsMessage(
        [formatBold(t("settings:botTitle")), "", formatBold(setting.title(t))],
        [
            ...setting
                .options(ctx.user.botId)
                .map((option) => [
                    scene.button(
                        `${selected.includes(option.value) ? "✅" : "⬜"} ${option.title(t)}`,
                        "choose",
                        option.value,
                    ),
                ]),
            [scene.backButton(t("settings:backButton"))],
        ],
    );
}

function buildSettingsMessage(
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

function formatOwnValue(
    t: Translate,
    setting: UserSetting,
    { ctx }: SettingsView,
): string {
    const chosen = readUserChoice(setting, ctx.user);
    const option = setting
        .options(ctx.user.botId)
        .find(({ value }) => value === chosen);

    return option ? option.title(t) : chosen;
}

function formatValue(
    t: Translate,
    setting: Setting,
    settingsService: SettingsService,
    botId: string,
): string {
    switch (setting.kind) {
        case "flag":
            return t(
                settingsService.read(setting, botId)
                    ? "settings:on"
                    : "settings:off",
            );
        case "number":
            return `${settingsService.read(setting, botId)} (${setting.min}–${setting.max})`;
        case "choices":
            return formatChoices(
                t,
                setting,
                settingsService.read(setting, botId),
                botId,
            );
    }
}

function formatChoices(
    t: Translate,
    setting: ChoicesSetting,
    selected: string[],
    botId: string,
): string {
    const titles = setting
        .options(botId)
        .filter(({ value }) => selected.includes(value))
        .map(({ title }) => title(t));

    return titles.length ? titles.join(", ") : t("settings:none");
}
