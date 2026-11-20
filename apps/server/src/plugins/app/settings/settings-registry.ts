import { Translate } from "../i18n-service.js";

export interface SettingsRegistrySection<TSetting> {
    name: string;
    title: (t: Translate) => string;
    settings: TSetting[];
}

const settingNamePattern = /^[a-z][A-Za-z0-9]*\.[a-z][A-Za-z0-9]*$/;

export class SettingsRegistry<TSetting extends { name: string }> {
    readonly sections: SettingsRegistrySection<TSetting>[] = [];
    private readonly settings = new Map<string, TSetting>();
    private readonly kind: string;

    constructor(kind: string) {
        this.kind = kind;
    }

    register(section: SettingsRegistrySection<TSetting>): void {
        if (this.sections.some(({ name }) => name === section.name)) {
            throw new Error(
                `${this.kind} section "${section.name}" is already registered`,
            );
        }

        for (const { name } of section.settings) {
            if (!settingNamePattern.test(name)) {
                throw new Error(
                    `${this.kind} "${name}" must be named <domain>.<name>`,
                );
            }

            if (this.settings.has(name)) {
                throw new Error(`${this.kind} "${name}" is already registered`);
            }
        }

        this.sections.push(section);

        for (const setting of section.settings) {
            this.settings.set(setting.name, setting);
        }
    }

    find(name: string): TSetting | undefined {
        return this.settings.get(name);
    }
}
