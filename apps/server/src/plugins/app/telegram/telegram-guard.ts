import { UserEntity } from "../users/user-entity.js";

export type TelegramGuard = (user: UserEntity) => boolean;

export function isAllowed(
    guard: TelegramGuard | undefined,
    user: UserEntity,
): boolean {
    return !guard || guard(user);
}
