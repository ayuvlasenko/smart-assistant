import { subject } from "@casl/ability";
import Emittery from "emittery";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { ObjectId } from "mongodb";
import { randomBytes } from "node:crypto";
import {
    AccessAction,
    AccessControl,
    AccessService,
} from "../access/access-service.js";
import {
    NumberSetting,
    SettingsService,
} from "../settings/settings-service.js";
import { UserEntity } from "../users/user-entity.js";
import { UsersRepository } from "../users/users-repository.js";
import { PokerDeckName, readPokerDeck } from "./poker-decks.js";
import { PokerEvents, PokerRoomChange } from "./poker-events.js";
import { pickPokerParticipantEmoji } from "./poker-participant-emojis.js";
import {
    findPokerParticipant,
    listKnownPokerParticipants,
    PokerAutoReveal,
    PokerParticipant,
    PokerRoomEntity,
    PokerRoomStatus,
    PokerSubjects,
    readPokerRoomStatus,
} from "./poker-room-entity.js";
import {
    addPokerParticipant,
    changePokerRole,
    PokerRoleChange,
    PokerRoomPatch,
    PokerRoundRename,
    PokerRoundStart,
    PokerVote,
    removePokerParticipant,
    renamePokerRound,
    revealPokerRound,
    revealPokerRoundIfDue,
    startPokerRound,
    votePokerRound,
} from "./poker-room-transitions.js";
import { PokerRoomsRepository } from "./poker-rooms-repository.js";

export interface PokerRoomDraft {
    title?: string;
    deck: PokerDeckName;
    autoReveal: boolean;
}

export type PokerJoinResult =
    | { status: "joined" | "alreadyJoined"; room: PokerRoomEntity }
    | { status: "notFound" }
    | { status: "closed" }
    | { status: "full" };

export interface PokerRoomsPageRequest {
    status: PokerRoomStatus;
    skip: number;
    limit: number;
}

export interface PokerRoomsPage {
    items: PokerRoomEntity[];
    total: number;
}

type PokerRoomTransition = (
    room: PokerRoomEntity,
    now: Date,
) => PokerRoomPatch | null;

const roomTokenBytes = 16;

const saveAttempts = 20;

export const pokerMaxParticipantsSetting: NumberSetting = {
    kind: "number",
    name: "poker.maxParticipants",
    title: (t) => t("poker:maxParticipantsSetting"),
    emoji: "👥",
    defaultValue: 40,
    min: 2,
    max: 100,
};

export class PokerRoomsService {
    private readonly pokerRoomsRepository: PokerRoomsRepository;
    private readonly usersRepository: UsersRepository;
    private readonly access: AccessControl<PokerSubjects>;
    private readonly settingsService: SettingsService;
    private readonly eventEmitter: Emittery<PokerEvents>;

    constructor(
        pokerRoomsRepository: PokerRoomsRepository,
        usersRepository: UsersRepository,
        access: AccessControl<PokerSubjects>,
        settingsService: SettingsService,
        eventEmitter: Emittery<PokerEvents>,
    ) {
        this.pokerRoomsRepository = pokerRoomsRepository;
        this.usersRepository = usersRepository;
        this.access = access;
        this.settingsService = settingsService;
        this.eventEmitter = eventEmitter;
    }

    async create(
        actor: UserEntity,
        draft: PokerRoomDraft,
    ): Promise<PokerRoomEntity> {
        const now = new Date();
        const data = {
            botId: actor.botId,
            token: randomBytes(roomTokenBytes).toString("base64url"),
            createdBy: actor._id,
            ...(draft.title === undefined ? {} : { title: draft.title }),
            deck: draft.deck,
            autoReveal: draft.autoReveal ? { missingVotes: 0 } : null,
            participants: [
                {
                    userId: actor._id,
                    emoji: pickPokerParticipantEmoji([]),
                    role: "voter" as const,
                    joinedAt: now,
                },
            ],
        };

        await this.access.assert(actor, "create", subject("PokerRoom", data));

        const room = await this.pokerRoomsRepository.create(data, now);

        await this.emitChanged(room, "created");

        return room;
    }

    async join(actor: UserEntity, token: string): Promise<PokerJoinResult> {
        for (let attempt = 0; attempt < saveAttempts; attempt += 1) {
            const room = await this.pokerRoomsRepository.findOneByToken(
                actor.botId,
                token,
            );

            if (!room) {
                return { status: "notFound" };
            }

            await this.access.assert(actor, "use", subject("PokerRoom", room));

            if (findPokerParticipant(room, actor._id)) {
                return { status: "alreadyJoined", room };
            }

            const now = new Date();

            if (readPokerRoomStatus(room, now) === "closed") {
                return { status: "closed" };
            }

            const maxParticipants = await this.settingsService.read(
                pokerMaxParticipantsSetting,
                room.botId,
            );

            if (room.participants.length >= maxParticipants) {
                return { status: "full" };
            }

            const participant: PokerParticipant = {
                userId: actor._id,
                emoji: pickPokerParticipantEmoji(
                    room.participants.map(({ emoji }) => emoji),
                ),
                role: "voter",
                joinedAt: now,
            };
            const joined = await this.save(
                room,
                addPokerParticipant(room, participant),
                { now, change: "joined" },
            );

            if (joined) {
                return { status: "joined", room: joined };
            }
        }

        throw new Error(
            `Failed to join a poker room after ${saveAttempts} attempts`,
        );
    }

    async find(
        actor: UserEntity,
        roomId: ObjectId,
    ): Promise<PokerRoomEntity | null> {
        return this.pokerRoomsRepository.findOne({
            $and: [
                { _id: roomId },
                await this.access.accessibleBy(actor, "read", "PokerRoom"),
            ],
        });
    }

    async list(
        actor: UserEntity,
        { status, skip, limit }: PokerRoomsPageRequest,
    ): Promise<PokerRoomsPage> {
        const query = {
            filter: {
                $and: [
                    await this.access.accessibleBy(actor, "read", "PokerRoom"),
                    status === "open"
                        ? { "participants.userId": actor._id }
                        : { createdBy: actor._id },
                ],
            },
            status,
            now: new Date(),
        };
        const [items, total] = await Promise.all([
            this.pokerRoomsRepository.findPage({ ...query, skip, limit }),
            this.pokerRoomsRepository.count(query),
        ]);

        return { items, total };
    }

    async isRemoved(actor: UserEntity, roomId: ObjectId): Promise<boolean> {
        const room = await this.pokerRoomsRepository.findOne({
            _id: roomId,
            botId: actor.botId,
            "removedParticipants.userId": actor._id,
        });

        return room !== null;
    }

    findUsers(room: PokerRoomEntity): Promise<UserEntity[]> {
        return this.usersRepository.findManyByIds(
            listKnownPokerParticipants(room).map(({ userId }) => userId),
        );
    }

    vote(
        actor: UserEntity,
        roomId: ObjectId,
        vote: PokerVote,
    ): Promise<PokerRoomEntity | null> {
        return this.change(actor, roomId, "voted", (room) => {
            if (!readPokerDeck(room.deck).cards.includes(vote.card)) {
                throw new Error(`Poker card "${vote.card}" is not in the deck`);
            }

            return votePokerRound(room, actor._id, vote);
        });
    }

    reveal(
        actor: UserEntity,
        roomId: ObjectId,
        round: number,
    ): Promise<PokerRoomEntity | null> {
        return this.change(actor, roomId, "revealed", (room, now) =>
            revealPokerRound(room, round, now),
        );
    }

    startRound(
        actor: UserEntity,
        roomId: ObjectId,
        start: PokerRoundStart,
    ): Promise<PokerRoomEntity | null> {
        return this.change(actor, roomId, "roundStarted", (room, now) =>
            startPokerRound(room, start, now),
        );
    }

    renameRound(
        actor: UserEntity,
        roomId: ObjectId,
        rename: PokerRoundRename,
    ): Promise<PokerRoomEntity | null> {
        return this.change(actor, roomId, "roundRenamed", (room) =>
            renamePokerRound(room, rename),
        );
    }

    changeAutoReveal(
        actor: UserEntity,
        roomId: ObjectId,
        autoReveal: PokerAutoReveal,
    ): Promise<PokerRoomEntity | null> {
        return this.change(actor, roomId, "autoRevealChanged", () => ({
            autoReveal,
        }));
    }

    changeRole(
        actor: UserEntity,
        roomId: ObjectId,
        roleChange: PokerRoleChange,
    ): Promise<PokerRoomEntity | null> {
        return this.change(actor, roomId, "roleChanged", (room) =>
            changePokerRole(room, roleChange),
        );
    }

    removeParticipant(
        actor: UserEntity,
        roomId: ObjectId,
        userId: ObjectId,
    ): Promise<PokerRoomEntity | null> {
        return this.change(
            actor,
            roomId,
            userId.equals(actor._id) ? "left" : "removed",
            (room) => removePokerParticipant(room, userId),
        );
    }

    close(
        actor: UserEntity,
        roomId: ObjectId,
    ): Promise<PokerRoomEntity | null> {
        return this.change(
            actor,
            roomId,
            "closed",
            (room, now) => ({ closedAt: now }),
            ["use", "update"],
        );
    }

    private async change(
        actor: UserEntity,
        roomId: ObjectId,
        change: PokerRoomChange,
        transition: PokerRoomTransition,
        actions: AccessAction[] = ["use"],
    ): Promise<PokerRoomEntity | null> {
        for (let attempt = 0; attempt < saveAttempts; attempt += 1) {
            const room = await this.find(actor, roomId);

            if (!room) {
                return null;
            }

            for (const action of actions) {
                await this.access.assert(
                    actor,
                    action,
                    subject("PokerRoom", room),
                );
            }

            const now = new Date();

            if (
                readPokerRoomStatus(room, now) !== "open" ||
                !findPokerParticipant(room, actor._id)
            ) {
                return null;
            }

            const patch = transition(room, now);

            if (!patch) {
                return null;
            }

            const saved = await this.save(room, patch, { now, change });

            if (saved) {
                return saved;
            }
        }

        throw new Error(
            `Failed to change a poker room after ${saveAttempts} attempts`,
        );
    }

    private async save(
        room: PokerRoomEntity,
        patch: PokerRoomPatch,
        { now, change }: { now: Date; change: PokerRoomChange },
    ): Promise<PokerRoomEntity | null> {
        const reveal = revealPokerRoundIfDue({ ...room, ...patch }, now);
        const saved = await this.pokerRoomsRepository.save(
            room,
            { ...patch, ...reveal },
            now,
        );

        if (saved) {
            await this.emitChanged(
                saved,
                reveal.round ? "revealed" : change,
                room,
            );
        }

        return saved;
    }

    private async emitChanged(
        room: PokerRoomEntity,
        change: PokerRoomChange,
        previous?: PokerRoomEntity,
    ): Promise<void> {
        const userIds = new Map(
            [
                room.createdBy,
                ...room.participants.map(({ userId }) => userId),
                ...(previous?.participants ?? []).map(({ userId }) => userId),
            ].map((userId) => [userId.toHexString(), userId]),
        );

        await this.eventEmitter.emit("poker.roomChanged", {
            botId: room.botId,
            roomId: room._id,
            change,
            userIds: [...userIds.values()],
        });
    }
}

export default fp(
    async function (fastify: FastifyInstance) {
        const settingsService =
            fastify.getDecorator<SettingsService>("settingsService");

        settingsService.register({
            name: "poker",
            title: (t) => t("poker:section"),
            settings: [pokerMaxParticipantsSetting],
        });

        fastify.decorate(
            "pokerRoomsService",
            new PokerRoomsService(
                fastify.getDecorator<PokerRoomsRepository>(
                    "pokerRoomsRepository",
                ),
                fastify.getDecorator<UsersRepository>("usersRepository"),
                fastify
                    .getDecorator<AccessService>("accessService")
                    .subjects<PokerSubjects>(),
                settingsService,
                fastify.getDecorator<Emittery<PokerEvents>>("eventEmitter"),
            ),
        );
    },
    {
        name: "poker-rooms-service",
        dependencies: [
            "access-service",
            "emittery",
            "poker-rooms-repository",
            "settings-service",
            "users-repository",
        ],
    },
);
