export interface RateLimitGrant {
    className: string | undefined;
    waitMilliseconds: number;
}

export type RateLimitTake = (
    waitingClasses: Set<string>,
) => Promise<RateLimitGrant>;

interface RateLimitWaiter {
    settle: (failure?: RateLimitFailure) => void;
}

interface RateLimitFailure {
    err: unknown;
}

export class RateLimitQueue {
    private readonly waiters = new Map<string, RateLimitWaiter[]>();
    private readonly take: RateLimitTake;
    private isDispatching = false;
    private isWakeRequested = false;
    private wakeSleep: (() => void) | undefined;

    constructor(classNames: string[], take: RateLimitTake) {
        for (const className of classNames) {
            this.waiters.set(className, []);
        }

        this.take = take;
    }

    async acquire(className: string, signal?: AbortSignal): Promise<number> {
        const queue = this.waiters.get(className);

        if (!queue) {
            throw new Error(`Rate limit class "${className}" is not defined`);
        }

        signal?.throwIfAborted();

        const startedAt = performance.now();
        const wasEmpty = queue.length === 0;

        const failure = await new Promise<RateLimitFailure | undefined>(
            (resolve) => {
                const onAbort = () => {
                    queue.splice(queue.indexOf(waiter), 1);
                    resolve({ err: signal?.reason });
                };
                const waiter: RateLimitWaiter = {
                    settle: (result) => {
                        signal?.removeEventListener("abort", onAbort);
                        resolve(result);
                    },
                };

                signal?.addEventListener("abort", onAbort, { once: true });
                queue.push(waiter);

                if (wasEmpty) {
                    this.requestWake();
                }

                this.dispatch();
            },
        );

        if (failure) {
            throw failure.err;
        }

        return performance.now() - startedAt;
    }

    private dispatch(): void {
        if (this.isDispatching) {
            return;
        }

        this.isDispatching = true;
        void this.grantWhileWaiting();
    }

    private async grantWhileWaiting(): Promise<void> {
        try {
            for (;;) {
                const waitingClasses = this.waitingClasses();
                const { className, waitMilliseconds } =
                    await this.take(waitingClasses);

                if (waitingClasses.size === 0) {
                    if (this.waitingClasses().size === 0) {
                        return;
                    }
                } else if (className === undefined) {
                    await this.sleep(waitMilliseconds);
                } else {
                    this.waiters.get(className)?.shift()?.settle();
                }
            }
        } catch (err) {
            this.failAll(err);
        } finally {
            this.isDispatching = false;
        }
    }

    private waitingClasses(): Set<string> {
        return new Set(
            [...this.waiters]
                .filter(([, queue]) => queue.length > 0)
                .map(([className]) => className),
        );
    }

    private requestWake(): void {
        this.isWakeRequested = true;
        this.wakeSleep?.();
    }

    private sleep(milliseconds: number): Promise<void> {
        if (this.isWakeRequested) {
            this.isWakeRequested = false;
            return Promise.resolve();
        }

        return new Promise((resolve) => {
            const done = () => {
                clearTimeout(timer);
                this.wakeSleep = undefined;
                this.isWakeRequested = false;
                resolve();
            };
            const timer = setTimeout(done, milliseconds);

            this.wakeSleep = done;
        });
    }

    private failAll(err: unknown): void {
        for (const queue of this.waiters.values()) {
            for (const waiter of queue.splice(0)) {
                waiter.settle({ err });
            }
        }
    }
}
