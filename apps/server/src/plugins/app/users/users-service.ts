import Emittery from "emittery";
import { FastifyBaseLogger, FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { ObjectId } from "mongodb";
import { AppLogger } from "../app-logger.js";
import { I18nService } from "../i18n-service.js";
import { FlagSetting, SettingsService } from "../settings/settings-service.js";
import { UserEntity, UserProfile } from "./user-entity.js";
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

    findOrCreateByTelegramId(
        data: Pick<UserEntity, "botId" | "telegramId"> & UserProfile,
    ): Promise<UserLookup> {
        return this.usersRepository.findOneByTelegramIdOrCreate({
            ...data,
            isBanned: this.settingsService.read(autoBanSetting, data.botId),
        });
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
            "users-repository",
        ],
    },
);
