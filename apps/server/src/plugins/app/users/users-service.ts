import Emittery from "emittery";
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { ObjectId } from "mongodb";
import { UserEntity } from "./user-entity.js";
import { UsersEvents } from "./users-events.js";
import { UsersRepository } from "./users-repository.js";

export class UsersService {
    private readonly usersRepository: UsersRepository;
    private readonly eventEmitter: Emittery<UsersEvents>;

    constructor(
        usersRepository: UsersRepository,
        eventEmitter: Emittery<UsersEvents>,
    ) {
        this.usersRepository = usersRepository;
        this.eventEmitter = eventEmitter;
    }

    async grantAccess(userId: ObjectId, grants: string[]): Promise<UserEntity> {
        const user = await this.usersRepository.grantAccess(userId, grants);

        await this.eventEmitter.emit("users.accessChanged", { user });

        return user;
    }
}

export default fp(
    async function (fastify: FastifyInstance) {
        fastify.decorate(
            "usersService",
            new UsersService(
                fastify.getDecorator<UsersRepository>("usersRepository"),
                fastify.getDecorator<Emittery<UsersEvents>>("eventEmitter"),
            ),
        );
    },
    {
        name: "users-service",
        dependencies: ["emittery", "users-repository"],
    },
);
