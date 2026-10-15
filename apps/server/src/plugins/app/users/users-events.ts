import { UserEntity } from "./user-entity.js";

export interface UsersEvents {
    "users.accessChanged": {
        user: UserEntity;
    };
}
