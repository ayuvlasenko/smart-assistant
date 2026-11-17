type StartDelivery = () => void;

export class TelegramDeliveryPermits {
    private readonly taken = new Map<string, number>();
    private readonly waiters = new Map<string, StartDelivery[]>();
    private readonly limit: number;

    constructor(limit: number) {
        this.limit = limit;
    }

    async run<T>(botId: string, deliver: () => Promise<T>): Promise<T> {
        await this.take(botId);

        try {
            return await deliver();
        } finally {
            this.giveBack(botId);
        }
    }

    private take(botId: string): Promise<void> {
        const taken = this.taken.get(botId) ?? 0;

        if (taken < this.limit) {
            this.taken.set(botId, taken + 1);
            return Promise.resolve();
        }

        return new Promise((resolve) => {
            this.waiters.set(botId, [
                ...(this.waiters.get(botId) ?? []),
                resolve,
            ]);
        });
    }

    private giveBack(botId: string): void {
        const [next, ...waiters] = this.waiters.get(botId) ?? [];

        if (next) {
            this.waiters.set(botId, waiters);
            next();
            return;
        }

        const taken = (this.taken.get(botId) ?? 1) - 1;

        this.waiters.delete(botId);

        if (taken > 0) {
            this.taken.set(botId, taken);
        } else {
            this.taken.delete(botId);
        }
    }
}
