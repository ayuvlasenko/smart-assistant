import Emittery from "emittery";
import { FastifyBaseLogger, FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { ObjectId } from "mongodb";
import { AppLogger } from "../app-logger.js";
import { defaultLanguage, I18nService, Language } from "../i18n-service.js";
import { FlagSetting, SettingsService } from "../settings/settings-service.js";
import { UserSettingsService } from "../settings/user-settings-service.js";
import { UserEntity, UserProfile } from "./user-entity.js";
import { languageSetting } from "./user-language.js";
import { UsersEvents } from "./users-events.js";
import { usersLocales } from "./users-locales.js";
import { UserLookup, UsersRepository } from "./users-repository.js";

export const autoBanSetting: FlagSetting = {
    kind: "flag",
    name: "users.autoBan",
    title: (t) => t("users:autoBanSetting"),
    emoji: "🚫",
    defaultValue: true,
};

export interface ReportedUser extends Pick<
    UserEntity,
    "botId" | "telegramId" | "firstName" | "username"
> {
    languageCode: Language | undefined;
}

export class UsersService {
    private readonly usersRepository: UsersRepository;
    private readonly settingsService: SettingsService;
    private readonly eventEmitter: Emittery<UsersEvents>;
    private readonly log: FastifyBaseLogger;

    constructor(
        usersRepository: UsersRepository,
        settingsService: SettingsService,
        eventEmitter: Emittery<UsersEvents>,
        log: FastifyBaseLogger,
    ) {
        this.usersRepository = usersRepository;
        this.settingsService = settingsService;
        this.eventEmitter = eventEmitter;
        this.log = log;
    }

    async findOrCreateByTelegramId(
        reported: ReportedUser,
    ): Promise<UserLookup> {
        const { user, isCreated } =
            await this.usersRepository.findOneByTelegramIdOrCreate({
                botId: reported.botId,
                telegramId: reported.telegramId,
                ...profileOf(reported, defaultLanguage),
                isBanned: await this.settingsService.read(
                    autoBanSetting,
                    reported.botId,
                ),
            });
        const profile = profileOf(reported, user.languageCode);

        if (isSameProfile(user, profile)) {
            return { user, isCreated };
        }

        return {
            user: await this.usersRepository.updateProfile(user._id, profile),
            isCreated,
        };
    }

    async grantAccess(userId: ObjectId, grants: string[]): Promise<UserEntity> {
        const user = await this.usersRepository.grantAccess(userId, grants);

        this.log.info(
            { botId: user.botId, userId, grants },
            "User access granted",
        );
        await this.eventEmitter.emit("users.accessChanged", { user });

        return user;
    }
}

function profileOf(
    { languageCode, firstName, username }: ReportedUser,
    fallbackLanguage: Language,
): UserProfile {
    return {
        languageCode: languageCode ?? fallbackLanguage,
        firstName,
        username,
    };
}

function isSameProfile(user: UserEntity, profile: UserProfile): boolean {
    return (
        user.languageCode === profile.languageCode &&
        user.firstName === profile.firstName &&
        user.username === profile.username
    );
}

export default fp(
    async function (fastify: FastifyInstance) {
        const settingsService =
            fastify.getDecorator<SettingsService>("settingsService");

        fastify
            .getDecorator<I18nService>("i18nService")
            .addLocales("users", usersLocales);
        settingsService.register({
            name: "users",
            title: (t) => t("users:section"),
            settings: [autoBanSetting],
        });
        fastify
            .getDecorator<UserSettingsService>("userSettingsService")
            .register({
                name: "users",
                title: (t) => t("users:generalSection"),
                settings: [languageSetting],
            });

        fastify.decorate(
            "usersService",
            new UsersService(
                fastify.getDecorator<UsersRepository>("usersRepository"),
                settingsService,
                fastify.getDecorator<Emittery<UsersEvents>>("eventEmitter"),
                fastify
                    .getDecorator<AppLogger>("appLogger")
                    .child({ module: "users" }),
            ),
        );
    },
    {
        name: "users-service",
        dependencies: [
            "app-logger",
            "emittery",
            "i18n-service",
            "settings-service",
            "user-settings-service",
            "users-repository",
        ],
    },
);
