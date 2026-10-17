import { subject } from "@casl/ability";
import Emittery from "emittery";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { ObjectId } from "mongodb";
import { randomBytes, randomInt } from "node:crypto";
import { AccessControl, AccessService } from "../access/access-service.js";
import { UserEntity } from "../users/user-entity.js";
import { UsersRepository } from "../users/users-repository.js";
import { PokerDeckName, readPokerDeck } from "./poker-decks.js";
import { PokerEvents, PokerRoomChange } from "./poker-events.js";
import {
    listActivePokerParticipants,
    PokerParticipant,
    PokerRoomEntity,
    PokerRoomStatus,
    PokerSubjects,
    readPokerRoomStatus,
} from "./poker-room-entity.js";
import {
    PokerRoomsRepository,
    PokerRoundTarget,
} from "./poker-rooms-repository.js";

export interface PokerRoomDraft {
    title?: string;
    deck: PokerDeckName;
    autoReveal: boolean;
}

export type PokerJoinResult =
    | { status: "joined" | "alreadyJoined"; room: PokerRoomEntity }
    | { status: "notFound" }
    | { status: "closed" };

export interface PokerRoomsPageRequest {
    status: PokerRoomStatus;
    skip: number;
    limit: number;
}

export interface PokerRoomsPage {
    items: PokerRoomEntity[];
    total: number;
}

const roomTokenBytes = 16;

const participantEmojis = [
    "🦊",
    "🐼",
    "🐙",
    "🐻",
    "🐸",
    "🦉",
    "🐨",
    "🐧",
    "🐯",
    "🦁",
    "🐮",
    "🐷",
    "🐵",
    "🐰",
    "🐹",
    "🐶",
    "🐱",
    "🐭",
    "🦄",
    "🐝",
    "🦋",
    "🐢",
    "🦖",
    "🐳",
    "🐬",
    "🦀",
    "🦔",
    "🦦",
    "🦥",
    "🦩",
    "🦜",
    "🐿️",
    "🦘",
    "🦒",
    "🦓",
    "🐘",
    "🦛",
    "🐊",
    "🦭",
    "🐌",
];

export class PokerRoomsService {
    private readonly pokerRoomsRepository: PokerRoomsRepository;
    private readonly usersRepository: UsersRepository;
    private readonly access: AccessControl<PokerSubjects>;
    private readonly eventEmitter: Emittery<PokerEvents>;

    constructor(
        pokerRoomsRepository: PokerRoomsRepository,
        usersRepository: UsersRepository,
        access: AccessControl<PokerSubjects>,
        eventEmitter: Emittery<PokerEvents>,
    ) {
        this.pokerRoomsRepository = pokerRoomsRepository;
        this.usersRepository = usersRepository;
        this.access = access;
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
            autoReveal: draft.autoReveal,
            participants: [
                { userId: actor._id, emoji: pickEmoji([]), joinedAt: now },
            ],
        };

        this.access.assert(actor, "create", subject("PokerRoom", data));

        const room = await this.pokerRoomsRepository.create(data, now);

        await this.emitChanged(room, "created");

        return room;
    }

    async join(actor: UserEntity, token: string): Promise<PokerJoinResult> {
        for (
            let attempt = 0;
            attempt <= participantEmojis.length;
            attempt += 1
        ) {
            const room = await this.pokerRoomsRepository.findOneByToken(token);

            if (!room) {
                return { status: "notFound" };
            }

            this.access.assert(actor, "use", subject("PokerRoom", room));

            if (findParticipant(room, actor._id)) {
                return { status: "alreadyJoined", room };
            }

            const now = new Date();

            if (readPokerRoomStatus(room, now) === "closed") {
                return { status: "closed" };
            }

            const taken = room.participants.map(({ emoji }) => emoji);
            const participant: PokerParticipant = {
                userId: actor._id,
                emoji: pickEmoji(taken),
                joinedAt: now,
            };
            const joined = await this.pokerRoomsRepository.join(
                token,
                participant,
                taken.length < participantEmojis.length,
            );

            if (joined) {
                await this.emitChanged(joined, "joined");

                return { status: "joined", room: joined };
            }
        }

        throw new Error("Failed to join a poker room after every emoji");
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
        { round, card }: { round: number; card: string },
    ): Promise<PokerRoomEntity | null> {
        if (!readPokerDeck(room.deck).cards.includes(card)) {
            throw new Error(`Poker card "${card}" is not in the deck`);
        }

        const isSameCard = room.round.votes[actor._id.toHexString()] === card;
        const voted = await this.pokerRoomsRepository.vote(
            this.targetOf(actor, room, round),
            isSameCard ? undefined : card,
        );

        if (!voted) {
            return null;
        }

        if (voted.autoReveal && hasEveryoneVoted(voted)) {
            return (await this.reveal(actor, voted, round)) ?? voted;
        }

        await this.emitChanged(voted, "voted");

        return voted;
    }

    async reveal(
        actor: UserEntity,
        room: PokerRoomEntity,
        round: number,
    ): Promise<PokerRoomEntity | null> {
        const revealed = await this.pokerRoomsRepository.reveal(
            this.targetOf(actor, room, round),
        );

        if (revealed) {
            await this.emitChanged(revealed, "revealed");
        }

        return revealed;
    }

    async startRound(
        actor: UserEntity,
        room: PokerRoomEntity,
        { round, repeat }: { round: number; repeat: boolean },
    ): Promise<PokerRoomEntity | null> {
        const started = await this.pokerRoomsRepository.startRound(
            this.targetOf(actor, room, round),
            { repeat },
        );

        if (started) {
            await this.emitChanged(started, "roundStarted");
        }

        return started;
    }

    async renameRound(
        actor: UserEntity,
        room: PokerRoomEntity,
        { round, title }: { round: number; title: string | undefined },
    ): Promise<PokerRoomEntity | null> {
        const renamed = await this.pokerRoomsRepository.renameRound(
            this.targetOf(actor, room, round),
            title,
        );

        if (renamed) {
            await this.emitChanged(renamed, "roundRenamed");
        }

        return renamed;
    }

    async close(
        actor: UserEntity,
        room: PokerRoomEntity,
    ): Promise<PokerRoomEntity | null> {
        this.access.assert(actor, "update", subject("PokerRoom", room));

        const closed = await this.pokerRoomsRepository.close({
            roomId: room._id,
            userId: actor._id,
            now: new Date(),
        });

        if (closed) {
            await this.emitChanged(closed, "closed");
        }

        return closed;
    }

    private targetOf(
        actor: UserEntity,
        room: PokerRoomEntity,
        roundNumber: number,
    ): PokerRoundTarget {
        this.access.assert(actor, "use", subject("PokerRoom", room));

        return {
            roomId: room._id,
            roundNumber,
            userId: actor._id,
            now: new Date(),
        };
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

function pickEmoji(taken: string[]): string {
    const free = participantEmojis.filter((emoji) => !taken.includes(emoji));
    const pool = free.length ? free : participantEmojis;

    return pool[randomInt(pool.length)] ?? "🙂";
}

function findParticipant(
    room: PokerRoomEntity,
    userId: ObjectId,
): PokerParticipant | undefined {
    return room.participants.find((participant) =>
        participant.userId.equals(userId),
    );
}

function hasEveryoneVoted(room: PokerRoomEntity): boolean {
    const active = listActivePokerParticipants(room);

    return (
        active.length > 0 &&
        active.every(({ userId }) => room.round.votes[userId.toHexString()])
    );
}

export default fp(
    async function (fastify: FastifyInstance) {
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
            "users-repository",
        ],
    },
);
