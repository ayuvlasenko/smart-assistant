export class NotFoundError extends Error {
    constructor(subject: string) {
        super(`${subject} not found`);
        this.name = "NotFoundError";
    }
}

export class EntityVersionMismatchError extends Error {
    constructor(subject: string) {
        super(`${subject} entity version mismatch`);
        this.name = "EntityVersionMismatchError";
    }
}
