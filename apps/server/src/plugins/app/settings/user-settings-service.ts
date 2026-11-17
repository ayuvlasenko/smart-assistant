import Emittery from "emittery";
import { FastifyBaseLogger, FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { AccessControl, AccessService } from "../access/access-service.js";
import { AppLogger } from "../app-logger.js";
import { Translate } from "../i18n-service.js";
import { readUserSetting, UserEntity } from "../users/user-entity.js";
import { UsersRepository } from "../users/users-repository.js";
import { SettingsSubjects } from "./setting-entity.js";
import { SettingsEvents } from "./settings-events.js";
import { SettingOption } from "./settings-service.js";

export interface UserChoiceSetting {
    kind: "choice";
    name: string;
    title: (t: Translate) => string;
    emoji: string;
    defaultValue: string;
    options: (botId: string) => SettingOption[];
}

export type UserSetting = UserChoiceSetting;

export interface UserSettingsSection {
    name: string;
    title: (t: Translate) => string;
    settings: UserSetting[];
}

const settingNamePattern = /^[a-z][A-Za-z0-9]*\.[a-z][A-Za-z0-9]*$/;

export class UserSettingsService {
    private readonly sections: UserSettingsSection[] = [];
    private readonly settings = new Map<string, UserSetting>();
    private readonly usersRepository: UsersRepository;
    private readonly access: AccessControl<SettingsSubjects>;
    private readonly eventEmitter: Emittery<SettingsEvents>;
    private readonly log: FastifyBaseLogger;

    constructor(
        usersRepository: UsersRepository,
        access: AccessControl<SettingsSubjects>,
        eventEmitter: Emittery<SettingsEvents>,
        log: FastifyBaseLogger,
    ) {
        this.usersRepository = usersRepository;
        this.access = access;
        this.eventEmitter = eventEmitter;
        this.log = log;
    }

    register(section: UserSettingsSection): void {
        if (this.sections.some(({ name }) => name === section.name)) {
            throw new Error(
                `User settings section "${section.name}" is already registered`,
            );
        }

        for (const { name } of section.settings) {
            if (!settingNamePattern.test(name)) {
                throw new Error(
                    `User setting "${name}" must be named <domain>.<name>`,
                );
            }

            if (this.settings.has(name)) {
                throw new Error(`User setting "${name}" is already registered`);
            }
        }

        this.sections.push(section);

        for (const setting of section.settings) {
            this.settings.set(setting.name, setting);
        }
    }

    listSections(botId: string): readonly UserSettingsSection[] {
        return this.sections.filter(({ name }) =>
            this.access.isEnabled(botId, name),
        );
    }

    find(name: string): UserSetting | undefined {
        return this.settings.get(name);
    }

    async write(
        user: UserEntity,
        setting: UserSetting,
        value: string,
    ): Promise<UserEntity> {
        if (
            !setting
                .options(user.botId)
                .some((option) => option.value === value)
        ) {
            throw new Error(
                `Value of user setting "${setting.name}" is not valid`,
            );
        }

        const updated = await this.usersRepository.setSetting(
            user._id,
            setting.name,
            value === setting.defaultValue ? undefined : value,
        );

        this.log.info(
            {
                botId: user.botId,
                userId: user._id,
                setting: setting.name,
                value,
            },
            "User setting changed",
        );
        await this.eventEmitter.emit("settings.userSettingChanged", {
            user: updated,
            name: setting.name,
        });

        return updated;
    }
}

export function readUserChoice(
    setting: UserChoiceSetting,
    user: Pick<UserEntity, "botId" | "settings">,
): string {
    const value = readUserSetting(user, setting.name);

    return typeof value === "string" &&
        setting.options(user.botId).some((option) => option.value === value)
        ? value
        : setting.defaultValue;
}

export default fp(
    async function (fastify: FastifyInstance) {
        fastify.decorate(
            "userSettingsService",
            new UserSettingsService(
                fastify.getDecorator<UsersRepository>("usersRepository"),
                fastify
                    .getDecorator<AccessService>("accessService")
                    .subjects<SettingsSubjects>(),
                fastify.getDecorator<Emittery<SettingsEvents>>("eventEmitter"),
                fastify
                    .getDecorator<AppLogger>("appLogger")
                    .child({ module: "settings" }),
            ),
        );
    },
    {
        name: "user-settings-service",
        dependencies: [
            "access-service",
            "app-logger",
            "emittery",
            "users-repository",
        ],
    },
);
