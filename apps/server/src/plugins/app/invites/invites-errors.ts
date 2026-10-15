export class InviteWithoutGrantsError extends Error {
    constructor() {
        super("Invite has no grants");
        this.name = "InviteWithoutGrantsError";
    }
}

export class InviteGrantNotAllowedError extends Error {
    readonly grant: string;

    constructor(grant: string) {
        super(`Invite grant "${grant}" is not allowed`);
        this.name = "InviteGrantNotAllowedError";
        this.grant = grant;
    }
}
