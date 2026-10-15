export class LockTimeoutError extends Error {
    constructor(name: string, waitedSeconds: number) {
        super(
            `Lock "${name}" was not acquired in ${waitedSeconds.toFixed(1)}s`,
        );
        this.name = "LockTimeoutError";
    }
}

export class LockLostError extends Error {
    constructor(name: string) {
        super(`Lock "${name}" was lost before the write`);
        this.name = "LockLostError";
    }
}
