import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { FastifyBaseLogger } from "fastify";
import { createHash, randomBytes } from "node:crypto";
import { telegramButtonsStateSchema } from "./telegram-scene-buttons.js";
import { telegramInputStateSchema } from "./telegram-scene-inputs.js";
import { telegramSlotsStateSchema } from "./telegram-scene-slots.js";
import { TelegramScene } from "./telegram-scene.js";
import { TelegramSession } from "./telegram-session.js";

const sceneRecordSchema = Type.Object({
    name: Type.String(),
    startedAt: Type.Number(),
    state: Type.Record(Type.String(), Type.Unknown()),
    buttons: telegramButtonsStateSchema,
    slots: telegramSlotsStateSchema,
    input: Type.Optional(telegramInputStateSchema),
});

export type TelegramSceneRecord = Static<typeof sceneRecordSchema>;

export interface TelegramSceneInstance {
    readonly id: string;
    readonly scene: TelegramScene;
    readonly record: TelegramSceneRecord;
}

const focusField = "focus";
const blockingField = "blocking";
const sceneIdSchema = Type.String();

export class TelegramSceneStorage {
    private readonly instances = new Map<
        string,
        TelegramSceneInstance | undefined
    >();
    private focus: { id: string | undefined } | undefined;
    private blocker: { id: string | undefined } | undefined;
    private readonly session: TelegramSession;
    private readonly findScene: (name: string) => TelegramScene | undefined;
    private readonly log: FastifyBaseLogger;

    constructor(
        session: TelegramSession,
        findScene: (name: string) => TelegramScene | undefined,
        log: FastifyBaseLogger,
    ) {
        this.session = session;
        this.findScene = findScene;
        this.log = log;
    }

    get loaded(): TelegramSceneInstance[] {
        return [...this.instances.values()].filter((instance) => !!instance);
    }

    idFor(scene: TelegramScene, state: Record<string, unknown>): string {
        const key = scene.key(state);

        return key === undefined
            ? randomBytes(8).toString("base64url")
            : this.idForKey(scene, key);
    }

    idForKey(scene: TelegramScene, key: string): string {
        return createHash("sha256")
            .update(`${scene.name}:${key}`)
            .digest("base64url")
            .slice(0, 12);
    }

    async load(id: string): Promise<TelegramSceneInstance | undefined> {
        if (!this.instances.has(id)) {
            const record = await this.session.read(
                sceneField(id),
                sceneRecordSchema,
            );

            this.instances.set(id, record && this.restore(id, record));
        }

        return this.instances.get(id);
    }

    create(
        id: string,
        scene: TelegramScene,
        state: Record<string, unknown>,
    ): TelegramSceneInstance {
        const record: TelegramSceneRecord = {
            name: scene.name,
            startedAt: Date.now(),
            state,
            buttons: { nextId: 1, messages: [] },
            slots: {},
        };
        const instance = this.toInstance(id, scene, record);

        this.instances.set(id, instance);

        return instance;
    }

    async focused(): Promise<TelegramSceneInstance | undefined> {
        const asking = this.loaded.find((instance) => instance.record.input);

        if (asking) {
            return asking;
        }

        const id = await this.readFocus();
        const instance = id === undefined ? undefined : await this.load(id);

        if (id !== undefined && !instance?.record.input) {
            this.clearFocus();
            return;
        }

        return instance;
    }

    async blocking(): Promise<TelegramSceneInstance | undefined> {
        const started = this.loaded.find((instance) => instance.scene.blocking);

        if (started) {
            return started;
        }

        const id = await this.readBlocker();
        const instance = id === undefined ? undefined : await this.load(id);

        if (id !== undefined && !instance?.scene.blocking) {
            this.clearBlocker();
            return;
        }

        return instance;
    }

    save(instance: TelegramSceneInstance): void {
        if (!this.has(instance)) {
            return;
        }

        const ttlMilliseconds = remainingTtl(instance);

        if (ttlMilliseconds <= 0) {
            this.remove(instance);
            return;
        }

        this.session.write(
            sceneField(instance.id),
            instance.record,
            ttlMilliseconds,
        );

        if (instance.record.input) {
            this.session.write(focusField, instance.id, ttlMilliseconds);
            this.focus = { id: instance.id };
        } else if (this.focus?.id === instance.id) {
            this.clearFocus();
        }

        if (instance.scene.blocking) {
            this.session.write(blockingField, instance.id, ttlMilliseconds);
            this.blocker = { id: instance.id };
        }
    }

    has(instance: TelegramSceneInstance): boolean {
        return this.instances.get(instance.id) === instance;
    }

    remove(instance: TelegramSceneInstance): void {
        this.instances.set(instance.id, undefined);
        this.session.remove(sceneField(instance.id));

        if (this.focus?.id === instance.id) {
            this.clearFocus();
        }

        if (instance.scene.blocking) {
            this.clearBlocker();
        }
    }

    private async readFocus(): Promise<string | undefined> {
        this.focus ??= {
            id: await this.session.read(focusField, sceneIdSchema),
        };

        return this.focus.id;
    }

    private clearFocus(): void {
        this.focus = { id: undefined };
        this.session.remove(focusField);
    }

    private async readBlocker(): Promise<string | undefined> {
        this.blocker ??= {
            id: await this.session.read(blockingField, sceneIdSchema),
        };

        return this.blocker.id;
    }

    private clearBlocker(): void {
        this.blocker = { id: undefined };
        this.session.remove(blockingField);
    }

    private restore(
        id: string,
        record: TelegramSceneRecord,
    ): TelegramSceneInstance | undefined {
        const scene = this.findScene(record.name);

        if (scene && Value.Check(scene.state, record.state)) {
            return this.toInstance(id, scene, record);
        }

        this.log.warn(
            { scene: record.name, sceneId: id },
            "Telegram scene is not registered or its state is outdated, removing it",
        );
        this.session.remove(sceneField(id));
    }

    private toInstance(
        id: string,
        scene: TelegramScene,
        record: TelegramSceneRecord,
    ): TelegramSceneInstance {
        return {
            id,
            scene,
            record,
        };
    }
}

function sceneField(id: string): string {
    return `scene:${id}`;
}

function remainingTtl({ scene, record }: TelegramSceneInstance): number {
    const untilMaxAge =
        scene.maxAge === undefined
            ? scene.ttl
            : record.startedAt + scene.maxAge - Date.now();

    return Math.floor(Math.min(scene.ttl, untilMaxAge));
}
