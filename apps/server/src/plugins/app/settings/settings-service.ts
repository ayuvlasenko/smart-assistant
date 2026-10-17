import { subject } from "@casl/ability";
import Emittery from "emittery";
import { FastifyBaseLogger, FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { AccessControl, AccessService } from "../access/access-service.js";
import { AppLogger } from "../app-logger.js";
import { I18nService, Translate } from "../i18n-service.js";
import { UserEntity } from "../users/user-entity.js";
import { SettingsSubjects } from "./setting-entity.js";
import { SettingsEvents } from "./settings-events.js";
import { settingsLocales } from "./settings-locales.js";
import { SettingsRepository } from "./settings-repository.js";

export interface SettingOption {
    value: string;
    title: (t: Translate) => string;
}

interface SettingBase {
    name: string;
    title: (t: Translate) => string;
    emoji: string;
}

export interface FlagSetting extends SettingBase {
    kind: "flag";
    defaultValue: boolean;
}

export interface NumberSetting extends SettingBase {
    kind: "number";
    defaultValue: number;
    min: number;
    max: number;
}

export interface ChoicesSetting extends SettingBase {
    kind: "choices";
    defaultValue: string[];
    options: () => SettingOption[];
}

export type Setting = FlagSetting | NumberSetting | ChoicesSetting;

export type SettingValue<TSetting extends Setting> =
    TSetting extends FlagSetting
        ? boolean
        : TSetting extends NumberSetting
          ? number
          : string[];

export interface SettingsSection {
    name: string;
    title: (t: Translate) => string;
    settings: Setting[];
}

const refreshIntervalMilliseconds = 10_000;

export class SettingsService {
    private readonly sections: SettingsSection[] = [];
    private readonly settings = new Map<string, Setting>();
    private readonly settingsRepository: SettingsRepository;
    private readonly access: AccessControl<SettingsSubjects>;
    private readonly eventEmitter: Emittery<SettingsEvents>;
    private readonly log: FastifyBaseLogger;
    private values = new Map<string, unknown>();
    private refreshTimer: NodeJS.Timeout | undefined;

    constructor(
        settingsRepository: SettingsRepository,
        access: AccessControl<SettingsSubjects>,
        eventEmitter: Emittery<SettingsEvents>,
        log: FastifyBaseLogger,
    ) {
        this.settingsRepository = settingsRepository;
        this.access = access;
        this.eventEmitter = eventEmitter;
        this.log = log;
    }

    register(section: SettingsSection): void {
        if (this.sections.some(({ name }) => name === section.name)) {
            throw new Error(
                `Settings section "${section.name}" is already registered`,
            );
        }

        for (const setting of section.settings) {
            if (this.settings.has(setting.name)) {
                throw new Error(
                    `Setting "${setting.name}" is already registered`,
                );
            }
        }

        this.sections.push(section);

        for (const setting of section.settings) {
            this.settings.set(setting.name, setting);
        }
    }

    listSections(): readonly SettingsSection[] {
        return this.sections;
    }

    find(name: string): Setting | undefined {
        return this.settings.get(name);
    }

    read<TSetting extends Setting>(setting: TSetting): SettingValue<TSetting> {
        return (
            readValue(setting, this.values.get(setting.name)) ??
            (setting.defaultValue as SettingValue<TSetting>)
        );
    }

    async write<TSetting extends Setting>(
        actor: UserEntity,
        setting: TSetting,
        value: SettingValue<TSetting>,
    ): Promise<void> {
        this.assertCanUpdate(actor, setting);

        if (!isValidValue(setting, value)) {
            throw new Error(`Value of setting "${setting.name}" is not valid`);
        }

        await this.settingsRepository.save(setting.name, value, actor._id);
        await this.apply(actor, setting, value);
    }

    async toggle(actor: UserEntity, setting: FlagSetting): Promise<void> {
        this.assertCanUpdate(actor, setting);

        const value = await this.settingsRepository.toggleFlag(
            setting.name,
            setting.defaultValue,
            actor._id,
        );

        await this.apply(actor, setting, value);
    }

    async toggleChoice(
        actor: UserEntity,
        setting: ChoicesSetting,
        choice: string,
    ): Promise<void> {
        this.assertCanUpdate(actor, setting);

        if (!setting.options().some(({ value }) => value === choice)) {
            throw new Error(
                `Choice "${choice}" is not an option of setting "${setting.name}"`,
            );
        }

        const value = await this.settingsRepository.toggleChoice(
            setting.name,
            choice,
            setting.defaultValue,
            actor._id,
        );

        await this.apply(actor, setting, value);
    }

    async refresh(): Promise<void> {
        const documents = await this.settingsRepository.findAll();

        this.values = new Map(documents.map(({ _id, value }) => [_id, value]));
    }

    startRefresh(): void {
        this.refreshTimer = setInterval(() => {
            this.refresh().catch((err: unknown) => {
                this.log.error({ err }, "Failed to refresh settings");
            });
        }, refreshIntervalMilliseconds);
        this.refreshTimer.unref();
    }

    stopRefresh(): void {
        clearInterval(this.refreshTimer);
    }

    private assertCanUpdate(actor: UserEntity, setting: Setting): void {
        this.access.assert(
            actor,
            "update",
            subject("Setting", { _id: setting.name }),
        );
    }

    private async apply(
        actor: UserEntity,
        setting: Setting,
        value: unknown,
    ): Promise<void> {
        this.values.set(setting.name, value);
        this.log.info(
            { setting: setting.name, value, userId: actor._id },
            "Setting changed",
        );
        await this.eventEmitter.emit("settings.settingChanged", {
            name: setting.name,
        });
    }
}

function isValidValue(setting: Setting, value: unknown): boolean {
    const known = readValue(setting, value);

    return Array.isArray(known)
        ? known.length === (value as unknown[]).length
        : known !== undefined;
}

function readValue<TSetting extends Setting>(
    setting: TSetting,
    value: unknown,
): SettingValue<TSetting> | undefined {
    switch (setting.kind) {
        case "flag":
            return (typeof value === "boolean" ? value : undefined) as
                SettingValue<TSetting> | undefined;
        case "number":
            return readNumber(setting, value) as
                SettingValue<TSetting> | undefined;
        case "choices":
            return readChoices(setting, value) as
                SettingValue<TSetting> | undefined;
    }
}

function readNumber(
    setting: NumberSetting,
    value: unknown,
): number | undefined {
    return typeof value === "number" &&
        Number.isInteger(value) &&
        value >= setting.min &&
        value <= setting.max
        ? value
        : undefined;
}

function readChoices(
    setting: ChoicesSetting,
    value: unknown,
): string[] | undefined {
    if (!Array.isArray(value)) {
        return;
    }

    const options = new Set(setting.options().map((option) => option.value));

    return value.filter(
        (item): item is string => typeof item === "string" && options.has(item),
    );
}

export default fp(
    async function (fastify: FastifyInstance) {
        const settingsService = new SettingsService(
            fastify.getDecorator<SettingsRepository>("settingsRepository"),
            fastify
                .getDecorator<AccessService>("accessService")
                .subjects<SettingsSubjects>(),
            fastify.getDecorator<Emittery<SettingsEvents>>("eventEmitter"),
            fastify
                .getDecorator<AppLogger>("appLogger")
                .child({ module: "settings" }),
        );

        fastify
            .getDecorator<I18nService>("i18nService")
            .addLocales("settings", settingsLocales);

        await settingsService.refresh();

        fastify.addHook("onReady", async () => {
            settingsService.startRefresh();
        });
        fastify.addHook("onClose", async () => {
            settingsService.stopRefresh();
        });

        fastify.decorate("settingsService", settingsService);
    },
    {
        name: "settings-service",
        dependencies: [
            "access-service",
            "app-logger",
            "emittery",
            "i18n-service",
            "settings-repository",
        ],
    },
);
