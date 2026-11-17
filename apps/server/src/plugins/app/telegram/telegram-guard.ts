import { UserEntity } from "../users/user-entity.js";

export type TelegramGuard = (user: UserEntity) => boolean | Promise<boolean>;

export async function isAllowed(
    guard: TelegramGuard | undefined,
    user: UserEntity,
): Promise<boolean> {
    return !guard || (await guard(user));
}
