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

export function renderSettingsList(view: SettingsView): TelegramMessageContent {
    const { ctx, scene, settingsService } = view;
    const { t } = ctx;
    const sections = settingsService.listSections();
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
            formatBold(t("settings:title")),
            ...sections.flatMap((section) => [
                "",
                formatBold(section.title(t)),
                ...section.settings.map((setting) =>
                    escapeTelegramHtml(
                        `${setting.title(t)}: ${formatValue(t, setting, settingsService)}`,
                    ),
                ),
            ]),
        ],
        buttons,
    );
}

export function renderSettingsChoices(
    view: SettingsView,
    setting: ChoicesSetting,
): TelegramMessageContent {
    const { ctx, scene, settingsService } = view;
    const { t } = ctx;
    const selected = settingsService.read(setting);

    return buildSettingsMessage(
        [formatBold(t("settings:title")), "", formatBold(setting.title(t))],
        [
            ...setting
                .options()
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

function formatValue(
    t: Translate,
    setting: Setting,
    settingsService: SettingsService,
): string {
    switch (setting.kind) {
        case "flag":
            return t(
                settingsService.read(setting) ? "settings:on" : "settings:off",
            );
        case "number":
            return `${settingsService.read(setting)} (${setting.min}–${setting.max})`;
        case "choices":
            return formatChoices(t, setting, settingsService.read(setting));
    }
}

function formatChoices(
    t: Translate,
    setting: ChoicesSetting,
    selected: string[],
): string {
    const titles = setting
        .options()
        .filter(({ value }) => selected.includes(value))
        .map(({ title }) => title(t));

    return titles.length ? titles.join(", ") : t("settings:none");
}
