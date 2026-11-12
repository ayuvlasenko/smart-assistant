import { subject } from "@casl/ability";
import Emittery from "emittery";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { ObjectId } from "mongodb";
import { randomBytes } from "node:crypto";
import { AccessControl, AccessService } from "../access/access-service.js";
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
    PokerAutoReveal,
    PokerParticipant,
    PokerRoomEntity,
    PokerRoomStatus,
    PokerSubjects,
    readPokerRoomStatus,
} from "./poker-room-entity.js";
import {
    changePokerRole,
    PokerRoleChange,
    PokerRoomPatch,
    PokerRoundRename,
    PokerRoundStart,
    PokerVote,
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

        this.access.assert(actor, "create", subject("PokerRoom", data));

        const room = await this.pokerRoomsRepository.create(data, now);

        await this.emitChanged(room, "created");

        return room;
    }

    async join(actor: UserEntity, token: string): Promise<PokerJoinResult> {
        for (let attempt = 0; attempt < saveAttempts; attempt += 1) {
            const room = await this.pokerRoomsRepository.findOneByToken(token);

            if (!room) {
                return { status: "notFound" };
            }

            this.access.assert(actor, "use", subject("PokerRoom", room));

            if (findPokerParticipant(room, actor._id)) {
                return { status: "alreadyJoined", room };
            }

            const now = new Date();

            if (readPokerRoomStatus(room, now) === "closed") {
                return { status: "closed" };
            }

            const maxParticipants = this.settingsService.read(
                pokerMaxParticipantsSetting,
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
                { participants: [...room.participants, participant] },
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

    find(actor: UserEntity, roomId: ObjectId): Promise<PokerRoomEntity | null> {
        return this.pokerRoomsRepository.findOne({
            $and: [
                { _id: roomId },
                this.access.accessibleBy(actor, "read", "PokerRoom"),
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
                    this.access.accessibleBy(actor, "read", "PokerRoom"),
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

    findUsers(room: PokerRoomEntity): Promise<UserEntity[]> {
        return this.usersRepository.findManyByIds(
            room.participants.map(({ userId }) => userId),
        );
    }

    async vote(
        actor: UserEntity,
        room: PokerRoomEntity,
        vote: PokerVote,
    ): Promise<PokerRoomEntity | null> {
        if (!readPokerDeck(room.deck).cards.includes(vote.card)) {
            throw new Error(`Poker card "${vote.card}" is not in the deck`);
        }

        return this.change(actor, room, "voted", (current) =>
            votePokerRound(current, actor._id, vote),
        );
    }

    async reveal(
        actor: UserEntity,
        room: PokerRoomEntity,
        round: number,
    ): Promise<PokerRoomEntity | null> {
        return this.change(actor, room, "revealed", (current, now) =>
            revealPokerRound(current, round, now),
        );
    }

    async startRound(
        actor: UserEntity,
        room: PokerRoomEntity,
        start: PokerRoundStart,
    ): Promise<PokerRoomEntity | null> {
        return this.change(actor, room, "roundStarted", (current, now) =>
            startPokerRound(current, start, now),
        );
    }

    async renameRound(
        actor: UserEntity,
        room: PokerRoomEntity,
        rename: PokerRoundRename,
    ): Promise<PokerRoomEntity | null> {
        return this.change(actor, room, "roundRenamed", (current) =>
            renamePokerRound(current, rename),
        );
    }

    async changeAutoReveal(
        actor: UserEntity,
        room: PokerRoomEntity,
        autoReveal: PokerAutoReveal,
    ): Promise<PokerRoomEntity | null> {
        return this.change(actor, room, "autoRevealChanged", () => ({
            autoReveal,
        }));
    }

    async changeRole(
        actor: UserEntity,
        room: PokerRoomEntity,
        roleChange: PokerRoleChange,
    ): Promise<PokerRoomEntity | null> {
        return this.change(actor, room, "roleChanged", (current) =>
            changePokerRole(current, roleChange),
        );
    }

    async close(
        actor: UserEntity,
        room: PokerRoomEntity,
    ): Promise<PokerRoomEntity | null> {
        this.access.assert(actor, "update", subject("PokerRoom", room));

        return this.change(actor, room, "closed", (current, now) => ({
            closedAt: now,
        }));
    }

    private async change(
        actor: UserEntity,
        room: PokerRoomEntity,
        change: PokerRoomChange,
        transition: PokerRoomTransition,
    ): Promise<PokerRoomEntity | null> {
        let current: PokerRoomEntity | null = room;
        let isReloaded = false;

        for (let attempt = 0; attempt < saveAttempts; attempt += 1) {
            if (!current) {
                return null;
            }

            this.access.assert(actor, "use", subject("PokerRoom", current));

            const now = new Date();
            const patch =
                readPokerRoomStatus(current, now) === "open" &&
                findPokerParticipant(current, actor._id)
                    ? transition(current, now)
                    : null;
            const saved =
                patch && (await this.save(current, patch, { now, change }));

            if (saved || (!patch && isReloaded)) {
                return saved;
            }

            current = await this.find(actor, room._id);
            isReloaded = true;
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
            await this.emitChanged(saved, reveal.round ? "revealed" : change);
        }

        return saved;
    }

    private async emitChanged(
        room: PokerRoomEntity,
        change: PokerRoomChange,
    ): Promise<void> {
        await this.eventEmitter.emit("poker.roomChanged", {
            roomId: room._id,
            change,
            userIds: [
                room.createdBy,
                ...room.participants
                    .map(({ userId }) => userId)
                    .filter((userId) => !userId.equals(room.createdBy)),
            ],
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
