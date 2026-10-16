export class LockLostError extends Error {
    constructor(name: string) {
        super(`Lock "${name}" was lost before the write`);
        this.name = "LockLostError";
    }
}

export class LockHoldTimeoutError extends Error {
    constructor(name: string, maxHoldMilliseconds: number) {
        super(`Lock "${name}" was held longer than ${maxHoldMilliseconds}ms`);
        this.name = "LockHoldTimeoutError";
    }
}
