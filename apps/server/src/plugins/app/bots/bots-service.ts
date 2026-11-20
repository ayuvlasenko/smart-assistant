import { WebhookInfo } from "@grammyjs/types";
import Emittery from "emittery";
import { FastifyBaseLogger, FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import {
    AccessControl,
    AccessSection,
    AccessService,
} from "../access/access-service.js";
import { AppLogger } from "../app-logger.js";
import { InviteEntity } from "../invites/invite-entity.js";
import { InvitesService } from "../invites/invites-service.js";
import { TelegramStartEntries } from "../telegram/telegram-start-entries.js";
import { UserEntity } from "../users/user-entity.js";
import { BotEntity, BotsSubjects } from "./bot-entity.js";
import { BotProfile, BotsConnector } from "./bots-connector.js";
import { BotTelegramIdTakenError } from "./bots-errors.js";
import { BotsEvents } from "./bots-events.js";
import { botsModule, BotsRegistry } from "./bots-registry.js";
import { BotsRepository } from "./bots-repository.js";

export type BotAddResult =
    | { status: "added"; bot: BotEntity; ownerInvite: InviteEntity }
    | { status: "alreadyAdded"; botId: string }
    | { status: "invalidToken" }
    | { status: "keyMissing" };

export type BotTokenResult =
    | { status: "replaced"; bot: BotEntity }
    | { status: "otherBot" }
    | { status: "invalidToken" }
    | { status: "keyMissing" };

export type BotMoveResult =
    | { status: "moved"; bot: BotEntity }
    | { status: "sameBot" }
    | { status: "alreadyAdded"; botId: string }
    | { status: "invalidToken" }
    | { status: "keyMissing" };

type BotTokenCheck =
    | { status: "valid"; profile: BotProfile }
    | { status: "invalidToken" }
    | { status: "keyMissing" };

export class BotsService {
    private readonly botsRepository: BotsRepository;
    private readonly botsRegistry: BotsRegistry;
    private readonly botsConnector: BotsConnector;
    private readonly startEntries: TelegramStartEntries;
    private readonly invitesService: InvitesService;
    private readonly access: AccessControl<BotsSubjects>;
    private readonly eventEmitter: Emittery<BotsEvents>;
    private readonly log: FastifyBaseLogger;

    constructor(
        botsRepository: BotsRepository,
        botsRegistry: BotsRegistry,
        botsConnector: BotsConnector,
        startEntries: TelegramStartEntries,
        invitesService: InvitesService,
        access: AccessControl<BotsSubjects>,
        eventEmitter: Emittery<BotsEvents>,
        log: FastifyBaseLogger,
    ) {
        this.botsRepository = botsRepository;
        this.botsRegistry = botsRegistry;
        this.botsConnector = botsConnector;
        this.startEntries = startEntries;
        this.invitesService = invitesService;
        this.access = access;
        this.eventEmitter = eventEmitter;
        this.log = log;
    }

    isRoot(botId: string): boolean {
        return botId === this.botsRegistry.rootId;
    }

    isServed(botId: string): Promise<boolean> {
        return this.botsConnector.isServed(botId);
    }

    listModules(): readonly AccessSection[] {
        return this.access
            .listModules()
            .filter(({ name }) => name !== botsModule);
    }

    listStartModules(bot: BotEntity): AccessSection[] {
        const withStartEntry = this.startEntries.listModules();

        return this.listModules().filter(
            ({ name }) =>
                bot.modules.includes(name) && withStartEntry.includes(name),
        );
    }

    async list(actor: UserEntity): Promise<BotEntity[]> {
        await this.access.assert(actor, "read", "Bot");

        return this.botsRepository.findAll();
    }

    async find(actor: UserEntity, botId: string): Promise<BotEntity | null> {
        await this.access.assert(actor, "read", "Bot");

        return this.botsRepository.findOneById(botId);
    }

    async readWebhook(
        actor: UserEntity,
        botId: string,
    ): Promise<WebhookInfo | undefined> {
        await this.access.assert(actor, "read", "Bot");

        return this.botsConnector.readWebhook(botId);
    }

    async add(actor: UserEntity, token: string): Promise<BotAddResult> {
        await this.access.assert(actor, "create", "Bot");

        const check = await this.checkToken(token);

        if (check.status !== "valid") {
            return check;
        }

        const { profile } = check;
        const bot = await this.botsRepository.createIfMissing({
            telegramId: profile.telegramId,
            username: profile.username,
            token: this.botsRegistry.encrypt(token),
            createdBy: actor._id,
        });

        if (!bot) {
            return this.alreadyAdded(
                await this.botsRepository.findOneByTelegramId(
                    profile.telegramId,
                ),
            );
        }
        await this.botsConnector.connect(bot._id);

        const ownerInvite = await this.invitesService.replaceOwnerInvite(
            actor,
            bot._id,
        );

        this.log.info({ botId: bot._id, userId: actor._id }, "Bot added");
        await this.emitChanged(bot._id);

        return { status: "added", bot, ownerInvite };
    }

    async replaceOwnerInvite(
        actor: UserEntity,
        botId: string,
    ): Promise<InviteEntity | null> {
        await this.access.assert(actor, "update", "Bot");

        if (this.isRoot(botId) || !(await this.isServed(botId))) {
            return null;
        }

        return this.invitesService.replaceOwnerInvite(actor, botId);
    }

    async toggleModule(
        actor: UserEntity,
        botId: string,
        module: string,
    ): Promise<BotEntity | null> {
        await this.access.assert(actor, "update", "Bot");

        if (!this.listModules().some(({ name }) => name === module)) {
            throw new Error(`Module "${module}" is not registered`);
        }

        const bot = await this.botsRepository.toggleModule(botId, module);

        if (!bot) {
            return null;
        }
        await this.botsConnector.refreshCommands(botId);
        this.log.info(
            { botId, modules: bot.modules, userId: actor._id },
            "Bot modules changed",
        );
        await this.emitChanged(botId);

        return bot;
    }

    async setStartModule(
        actor: UserEntity,
        botId: string,
        module: string | null,
    ): Promise<BotEntity | null> {
        await this.access.assert(actor, "update", "Bot");

        const current = await this.botsRepository.findOneById(botId);

        if (
            !current ||
            module === (current.startModule ?? null) ||
            (module !== null &&
                !this.listStartModules(current).some(
                    ({ name }) => name === module,
                ))
        ) {
            return current;
        }

        const bot = await this.botsRepository.setStartModule(
            botId,
            module ?? undefined,
        );

        if (!bot) {
            return this.botsRepository.findOneById(botId);
        }

        await this.botsConnector.refreshCommands(botId);
        this.log.info(
            { botId, startModule: bot.startModule, userId: actor._id },
            "Bot start module changed",
        );
        await this.emitChanged(botId);

        return bot;
    }

    async replaceToken(
        actor: UserEntity,
        botId: string,
        token: string,
    ): Promise<BotTokenResult> {
        await this.access.assert(actor, "update", "Bot");
        this.assertNotRoot(botId);

        const check = await this.checkToken(token);

        if (check.status !== "valid") {
            return check;
        }

        const { profile } = check;
        const bot = await this.botsRepository.replaceToken(
            botId,
            profile.telegramId,
            this.botsRegistry.encrypt(token),
            profile.username,
        );

        if (!bot) {
            return { status: "otherBot" };
        }
        await this.botsConnector.connect(botId);
        this.log.info({ botId, userId: actor._id }, "Bot token replaced");
        await this.emitChanged(botId);

        return { status: "replaced", bot };
    }

    async move(
        actor: UserEntity,
        botId: string,
        token: string,
    ): Promise<BotMoveResult> {
        await this.access.assert(actor, "update", "Bot");
        this.assertNotRoot(botId);

        const current = await this.botsRepository.findOneById(botId);

        if (!current) {
            throw new Error(`Bot ${botId} is not stored`);
        }

        const check = await this.checkToken(token);

        if (check.status !== "valid") {
            return check;
        }

        const { profile } = check;

        if (profile.telegramId === current.telegramId) {
            return { status: "sameBot" };
        }

        const owner = await this.botsRepository.findOneByTelegramId(
            profile.telegramId,
        );

        if (owner) {
            return this.alreadyAdded(owner);
        }

        const previous = await this.botsConnector.find(botId);
        let bot: BotEntity | null;

        try {
            bot = await this.botsRepository.moveToTelegramBot(
                botId,
                profile.telegramId,
                this.botsRegistry.encrypt(token),
                profile.username,
            );
        } catch (err) {
            if (err instanceof BotTelegramIdTakenError) {
                return this.alreadyAdded(
                    await this.botsRepository.findOneByTelegramId(
                        profile.telegramId,
                    ),
                );
            }

            throw err;
        }

        if (!bot) {
            throw new Error(`Bot ${botId} is not stored`);
        }

        if (previous) {
            await this.botsConnector.deleteWebhook(previous);
        }

        await this.botsConnector.connect(botId);
        this.log.info(
            {
                botId,
                telegramId: profile.telegramId,
                previousTelegramId: current.telegramId,
                userId: actor._id,
            },
            "Bot moved to another Telegram bot",
        );
        await this.emitChanged(botId);

        return { status: "moved", bot };
    }

    async reconnect(actor: UserEntity, botId: string): Promise<void> {
        await this.access.assert(actor, "update", "Bot");
        await this.botsConnector.connect(botId);
        await this.emitChanged(botId);
    }

    async stop(actor: UserEntity, botId: string): Promise<BotEntity | null> {
        await this.access.assert(actor, "update", "Bot");
        this.assertNotRoot(botId);

        await this.botsConnector.disconnect(botId);

        const bot = await this.botsRepository.disable(botId, new Date());

        if (bot) {
            this.log.info({ botId, userId: actor._id }, "Bot stopped");
            await this.emitChanged(botId);
        }

        return bot;
    }

    async start(actor: UserEntity, botId: string): Promise<BotEntity | null> {
        await this.access.assert(actor, "update", "Bot");

        const bot = await this.botsRepository.enable(botId);

        if (bot) {
            await this.botsConnector.connect(botId);
            this.log.info({ botId, userId: actor._id }, "Bot started");
            await this.emitChanged(botId);
        }

        return bot;
    }

    private assertNotRoot(botId: string): void {
        if (this.isRoot(botId)) {
            throw new Error("The root bot lives in TELEGRAM_BOT_TOKEN");
        }
    }

    private async checkToken(token: string): Promise<BotTokenCheck> {
        if (!this.botsRegistry.canStoreTokens) {
            return { status: "keyMissing" };
        }

        const profile = await this.botsConnector.readProfile(token);

        return profile
            ? { status: "valid", profile }
            : { status: "invalidToken" };
    }

    private alreadyAdded(owner: BotEntity | null): {
        status: "alreadyAdded";
        botId: string;
    } {
        if (!owner) {
            throw new Error("The bot that took the Telegram bot is not stored");
        }

        return { status: "alreadyAdded", botId: owner._id };
    }

    private async emitChanged(botId: string): Promise<void> {
        await this.eventEmitter.emit("bots.botChanged", { botId });
    }
}

export default fp(
    async function (fastify: FastifyInstance) {
        fastify.decorate(
            "botsService",
            new BotsService(
                fastify.getDecorator<BotsRepository>("botsRepository"),
                fastify.getDecorator<BotsRegistry>("botsRegistry"),
                fastify.getDecorator<BotsConnector>("botsConnector"),
                fastify.getDecorator<TelegramStartEntries>(
                    "telegramStartEntries",
                ),
                fastify.getDecorator<InvitesService>("invitesService"),
                fastify
                    .getDecorator<AccessService>("accessService")
                    .subjects<BotsSubjects>(),
                fastify.getDecorator<Emittery<BotsEvents>>("eventEmitter"),
                fastify
                    .getDecorator<AppLogger>("appLogger")
                    .child({ module: "bots" }),
            ),
        );
    },
    {
        name: "bots-service",
        dependencies: [
            "access-service",
            "app-logger",
            "bots-connector",
            "bots-registry",
            "bots-repository",
            "emittery",
            "invites-service",
            "telegram-start-entries",
        ],
    },
);
