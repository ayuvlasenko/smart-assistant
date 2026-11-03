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
import { TelegramBotService } from "../telegram/telegram-bot-service.js";
import { TelegramBots } from "../telegram/telegram-bots.js";
import { TelegramCommandMenus } from "../telegram/telegram-command-menus.js";
import { UserEntity } from "../users/user-entity.js";
import { BotEntity, BotsSubjects, isBotToken } from "./bot-entity.js";
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

interface BotProfile {
    id: string;
    username: string;
}

export class BotsService {
    private readonly botsRepository: BotsRepository;
    private readonly botsRegistry: BotsRegistry;
    private readonly telegramBots: TelegramBots;
    private readonly telegramBotService: TelegramBotService;
    private readonly telegramCommandMenus: TelegramCommandMenus;
    private readonly invitesService: InvitesService;
    private readonly access: AccessControl<BotsSubjects>;
    private readonly eventEmitter: Emittery<BotsEvents>;
    private readonly log: FastifyBaseLogger;

    constructor(
        botsRepository: BotsRepository,
        botsRegistry: BotsRegistry,
        telegramBots: TelegramBots,
        telegramBotService: TelegramBotService,
        telegramCommandMenus: TelegramCommandMenus,
        invitesService: InvitesService,
        access: AccessControl<BotsSubjects>,
        eventEmitter: Emittery<BotsEvents>,
        log: FastifyBaseLogger,
    ) {
        this.botsRepository = botsRepository;
        this.botsRegistry = botsRegistry;
        this.telegramBots = telegramBots;
        this.telegramBotService = telegramBotService;
        this.telegramCommandMenus = telegramCommandMenus;
        this.invitesService = invitesService;
        this.access = access;
        this.eventEmitter = eventEmitter;
        this.log = log;
    }

    isRoot(botId: string): boolean {
        return botId === this.botsRegistry.rootId;
    }

    isServed(botId: string): boolean {
        return this.telegramBots.find(botId) !== undefined;
    }

    listModules(): readonly AccessSection[] {
        return this.access
            .listModules()
            .filter(({ name }) => name !== botsModule);
    }

    list(actor: UserEntity): Promise<BotEntity[]> {
        this.access.assert(actor, "read", "Bot");

        return this.botsRepository.findAll();
    }

    find(actor: UserEntity, botId: string): Promise<BotEntity | null> {
        this.access.assert(actor, "read", "Bot");

        return this.botsRepository.findOneById(botId);
    }

    async readWebhook(
        actor: UserEntity,
        botId: string,
    ): Promise<WebhookInfo | undefined> {
        this.access.assert(actor, "read", "Bot");

        const bot = this.telegramBots.find(botId);

        if (!bot) {
            return undefined;
        }

        try {
            return await this.telegramBotService.readWebhook(bot);
        } catch (err) {
            this.log.warn(
                { err, botId },
                "Failed to read the webhook of a bot",
            );
            return undefined;
        }
    }

    async add(actor: UserEntity, token: string): Promise<BotAddResult> {
        this.access.assert(actor, "create", "Bot");

        if (!this.botsRegistry.canStoreTokens) {
            return { status: "keyMissing" };
        }

        const profile = await this.readProfile(token);

        if (!profile) {
            return { status: "invalidToken" };
        }

        const bot = await this.botsRepository.createIfMissing({
            _id: profile.id,
            username: profile.username,
            token: this.botsRegistry.encrypt(token),
            createdBy: actor._id,
        });

        if (!bot) {
            return { status: "alreadyAdded", botId: profile.id };
        }

        this.botsRegistry.put(bot);
        await this.connect(bot._id);

        const ownerInvite = await this.invitesService.createOwnerInvite(
            bot._id,
        );

        this.log.info({ botId: bot._id, userId: actor._id }, "Bot added");
        await this.emitChanged(bot._id);

        return { status: "added", bot, ownerInvite };
    }

    async createOwnerInvite(
        actor: UserEntity,
        botId: string,
    ): Promise<InviteEntity | null> {
        this.access.assert(actor, "update", "Bot");

        if (this.isRoot(botId) || !this.isServed(botId)) {
            return null;
        }

        return this.invitesService.createOwnerInvite(botId);
    }

    async toggleModule(
        actor: UserEntity,
        botId: string,
        module: string,
    ): Promise<BotEntity | null> {
        this.access.assert(actor, "update", "Bot");

        if (!this.listModules().some(({ name }) => name === module)) {
            throw new Error(`Module "${module}" is not registered`);
        }

        const bot = await this.botsRepository.toggleModule(botId, module);

        if (!bot) {
            return null;
        }

        this.botsRegistry.put(bot);
        await this.refreshCommands(botId);
        this.log.info(
            { botId, modules: bot.modules, userId: actor._id },
            "Bot modules changed",
        );
        await this.emitChanged(botId);

        return bot;
    }

    async replaceToken(
        actor: UserEntity,
        botId: string,
        token: string,
    ): Promise<BotTokenResult> {
        this.access.assert(actor, "update", "Bot");
        this.assertNotRoot(botId);

        if (!this.botsRegistry.canStoreTokens) {
            return { status: "keyMissing" };
        }

        const profile = await this.readProfile(token);

        if (!profile) {
            return { status: "invalidToken" };
        }

        if (profile.id !== botId) {
            return { status: "otherBot" };
        }

        const bot = await this.botsRepository.updateToken(
            botId,
            this.botsRegistry.encrypt(token),
            profile.username,
        );

        if (!bot) {
            return { status: "otherBot" };
        }

        this.botsRegistry.put(bot);
        await this.connect(botId);
        this.log.info({ botId, userId: actor._id }, "Bot token replaced");
        await this.emitChanged(botId);

        return { status: "replaced", bot };
    }

    async reconnect(actor: UserEntity, botId: string): Promise<void> {
        this.access.assert(actor, "update", "Bot");
        await this.connect(botId);
        await this.emitChanged(botId);
    }

    async stop(actor: UserEntity, botId: string): Promise<BotEntity | null> {
        this.access.assert(actor, "update", "Bot");
        this.assertNotRoot(botId);

        const telegramBot = this.telegramBots.find(botId);

        if (telegramBot) {
            try {
                await this.telegramBotService.deleteWebhook(telegramBot);
            } catch (err) {
                this.log.warn(
                    { err, botId },
                    "Failed to delete the webhook of a stopped bot",
                );
            }
        }

        const bot = await this.botsRepository.disable(botId, new Date());

        if (bot) {
            this.botsRegistry.put(bot);
            this.log.info({ botId, userId: actor._id }, "Bot stopped");
            await this.emitChanged(botId);
        }

        return bot;
    }

    async start(actor: UserEntity, botId: string): Promise<BotEntity | null> {
        this.access.assert(actor, "update", "Bot");

        const bot = await this.botsRepository.enable(botId);

        if (bot) {
            this.botsRegistry.put(bot);
            await this.connect(botId);
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

    private async readProfile(token: string): Promise<BotProfile | undefined> {
        if (!isBotToken(token)) {
            return undefined;
        }

        const result = await this.telegramBots.connect(token).getMe();

        return result.ok
            ? { id: String(result.result.id), username: result.result.username }
            : undefined;
    }

    private async connect(botId: string): Promise<void> {
        const bot = this.telegramBots.find(botId);

        if (!bot) {
            return;
        }

        try {
            await this.telegramBotService.setWebhook(bot);
            await this.telegramCommandMenus.refresh(bot);
        } catch (err) {
            this.log.error(
                { err, botId },
                "Failed to connect the webhook of a bot",
            );
        }
    }

    private async refreshCommands(botId: string): Promise<void> {
        const bot = this.telegramBots.find(botId);

        if (!bot) {
            return;
        }

        try {
            await this.telegramCommandMenus.refresh(bot);
        } catch (err) {
            this.log.error(
                { err, botId },
                "Failed to refresh the commands of a bot",
            );
        }
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
                fastify.getDecorator<TelegramBots>("telegramBots"),
                fastify.getDecorator<TelegramBotService>("telegramBotService"),
                fastify.getDecorator<TelegramCommandMenus>(
                    "telegramCommandMenus",
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
            "bots-registry",
            "bots-repository",
            "emittery",
            "invites-service",
            "telegram-bot-service",
            "telegram-bots",
            "telegram-command-menus",
        ],
    },
);
