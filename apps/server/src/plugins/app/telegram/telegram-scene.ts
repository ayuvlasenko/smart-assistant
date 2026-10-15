import { InlineKeyboardButton, Update } from "@grammyjs/types";
import {
    type Static,
    type StaticDecode,
    type TObject,
    type TSchema,
} from "@sinclair/typebox";
import { Translate } from "../i18n-service.js";
import { TelegramContext } from "./telegram-context.js";
import { TelegramUpdateFilter } from "./telegram-filters.js";
import { TelegramGuard } from "./telegram-guard.js";
import { TelegramMessageContent } from "./telegram-responder.js";
import { TelegramSlotMessages } from "./telegram-scene-slots.js";

export type TelegramTransition<TPayload> =
    | { type: "next"; patch?: Partial<TPayload> }
    | { type: "stay"; patch?: Partial<TPayload> }
    | { type: "goto"; step: string; patch?: Partial<TPayload> }
    | { type: "back" }
    | { type: "cancel"; silent?: boolean }
    | { type: "complete"; patch?: Partial<TPayload> };

export type TelegramSceneButtonSchemas = Record<string, TSchema>;
export type TelegramSceneInputSchemas = Record<string, TObject>;

export interface TelegramSceneControl<
    TState,
    TButtons extends TelegramSceneButtonSchemas = TelegramSceneButtonSchemas,
    TInputs extends TelegramSceneInputSchemas = TelegramSceneInputSchemas,
> {
    readonly id: string;
    readonly name: string;
    readonly state: TState;
    button<TName extends keyof TButtons & string>(
        text: string,
        name: TName,
        value: Static<TButtons[TName]>,
    ): InlineKeyboardButton.CallbackButton;
    ask(name: keyof TInputs & string): Promise<void>;
    end(options?: { messages?: TelegramSlotMessages }): Promise<void>;
}

export interface TelegramInputControl<TPayload> {
    readonly name: string;
    readonly step: string;
    readonly payload: Partial<TPayload>;
    readonly pressed: unknown;
    button(text: string, value: unknown): InlineKeyboardButton.CallbackButton;
}

export interface TelegramStep<TPayload, TUpdate extends Update = Update> {
    name: string;
    accepts: TelegramUpdateFilter<TUpdate>;
    hint?(t: Translate): string;
    enter(
        ctx: TelegramContext,
        input: TelegramInputControl<TPayload>,
    ): Promise<void | TelegramTransition<TPayload>>;
    handle(
        ctx: TelegramContext<TUpdate>,
        input: TelegramInputControl<TPayload>,
    ): Promise<TelegramTransition<TPayload>>;
}

export type TelegramStepOptions<TPayload, TUpdate extends Update> = Omit<
    TelegramStep<TPayload, TUpdate>,
    "name" | "accepts"
>;

export type TelegramStepFactory<TPayload> = <TUpdate extends Update>(
    name: string,
    accepts: TelegramUpdateFilter<TUpdate>,
    options: TelegramStepOptions<TPayload, TUpdate>,
) => TelegramStep<TPayload>;

export type TelegramSceneTitle = (t: Translate) => string;

export type TelegramSceneBlocking =
    | { readonly blocking: true; readonly title: TelegramSceneTitle }
    | { readonly blocking?: false; readonly title?: TelegramSceneTitle };

export interface TelegramSceneDefinition<
    TStateSchema extends TObject,
    TButtons extends TelegramSceneButtonSchemas,
    TInputs extends TelegramSceneInputSchemas,
> {
    name: string;
    state: TStateSchema;
    ttl: number;
    maxAge?: number;
    guard?: TelegramGuard;
    buttons?: {
        [TName in keyof TButtons]: {
            value: TButtons[TName];
            guard?: TelegramGuard;
            handle(
                ctx: TelegramContext<Update>,
                scene: TelegramSceneControl<
                    Static<TStateSchema>,
                    TButtons,
                    TInputs
                >,
                value: Static<TButtons[TName]>,
            ): Promise<unknown>;
        };
    };
    slots?: Record<
        string,
        (
            ctx: TelegramContext,
            scene: TelegramSceneControl<
                Static<TStateSchema>,
                TButtons,
                TInputs
            >,
        ) => Promise<TelegramMessageContent | undefined>
    >;
    inputs?: {
        [TName in keyof TInputs]: {
            payload: TInputs[TName];
            guard?: TelegramGuard;
            cleanup?: boolean;
            steps(
                step: TelegramStepFactory<Static<TInputs[TName]>>,
            ): TelegramStep<Static<TInputs[TName]>>[];
            complete(
                ctx: TelegramContext,
                scene: TelegramSceneControl<
                    Static<TStateSchema>,
                    TButtons,
                    TInputs
                >,
                payload: StaticDecode<TInputs[TName]>,
            ): Promise<unknown>;
            cancel?(
                ctx: TelegramContext,
                scene: TelegramSceneControl<
                    Static<TStateSchema>,
                    TButtons,
                    TInputs
                >,
            ): Promise<unknown>;
        };
    };
    key?(state: Static<TStateSchema>): string;
    watch?(state: Static<TStateSchema>): string[];
    start?(
        ctx: TelegramContext,
        scene: TelegramSceneControl<Static<TStateSchema>, TButtons, TInputs>,
    ): Promise<unknown>;
}

type ErasedSceneControl = TelegramSceneControl<Record<string, unknown>>;

export interface TelegramSceneButton {
    value: TSchema;
    guard?: TelegramGuard;
    handle(
        ctx: TelegramContext<Update>,
        scene: ErasedSceneControl,
        value: unknown,
    ): Promise<unknown>;
}

export interface TelegramSceneInput {
    payload: TObject;
    guard?: TelegramGuard;
    steps: TelegramStep<Record<string, unknown>>[];
    cleanup: boolean;
    complete(
        ctx: TelegramContext,
        scene: ErasedSceneControl,
        payload: Record<string, unknown>,
    ): Promise<unknown>;
    cancel?(ctx: TelegramContext, scene: ErasedSceneControl): Promise<unknown>;
}

export type TelegramSceneSlot = (
    ctx: TelegramContext,
    scene: ErasedSceneControl,
) => Promise<TelegramMessageContent | undefined>;

export type TelegramScene<TStateSchema extends TObject = TObject> =
    TelegramSceneShape<TStateSchema> & TelegramSceneBlocking;

interface TelegramSceneShape<TStateSchema extends TObject> {
    readonly name: string;
    readonly state: TStateSchema;
    readonly ttl: number;
    readonly maxAge: number | undefined;
    readonly guard: TelegramGuard | undefined;
    readonly buttons: Readonly<Record<string, TelegramSceneButton>>;
    readonly inputs: Readonly<Record<string, TelegramSceneInput>>;
    readonly slots: Readonly<Record<string, TelegramSceneSlot>>;
    key(state: Record<string, unknown>): string | undefined;
    watch(state: Record<string, unknown>): string[];
    start(ctx: TelegramContext, scene: ErasedSceneControl): Promise<unknown>;
}

export function defineScene<
    TStateSchema extends TObject,
    TButtons extends TelegramSceneButtonSchemas = Record<never, TSchema>,
    TInputs extends TelegramSceneInputSchemas = Record<never, TObject>,
>(
    definition: TelegramSceneDefinition<TStateSchema, TButtons, TInputs> &
        TelegramSceneBlocking,
): TelegramScene<TStateSchema> {
    const inputs = Object.entries(
        (definition.inputs ?? {}) as Record<
            string,
            Omit<TelegramSceneInput, "steps" | "cleanup"> & {
                cleanup?: boolean;
                steps(
                    step: TelegramStepFactory<Record<string, unknown>>,
                ): TelegramStep<Record<string, unknown>>[];
            }
        >,
    ).map(([name, input]) => [
        name,
        {
            ...input,
            cleanup: input.cleanup ?? false,
            steps: input.steps((stepName, accepts, options) => ({
                name: stepName,
                accepts,
                ...options,
            })),
        },
    ]);

    return {
        name: definition.name,
        ...(definition.blocking
            ? { blocking: true, title: definition.title }
            : { title: definition.title }),
        state: definition.state,
        ttl: definition.ttl,
        maxAge: definition.maxAge,
        guard: definition.guard,
        buttons: definition.buttons ?? {},
        slots: definition.slots ?? {},
        inputs: Object.fromEntries(inputs) as Record<
            string,
            TelegramSceneInput
        >,
        key(state) {
            return definition.key?.(state);
        },
        watch(state) {
            return definition.watch?.(state) ?? [];
        },
        async start(ctx, scene) {
            await definition.start?.(ctx, scene);
        },
    };
}

export function next<TPayload>(
    patch?: Partial<TPayload>,
): TelegramTransition<TPayload> {
    return { type: "next", patch };
}

export function stay<TPayload>(
    patch?: Partial<TPayload>,
): TelegramTransition<TPayload> {
    return { type: "stay", patch };
}

export function goto<TPayload>(
    stepName: string,
    patch?: Partial<TPayload>,
): TelegramTransition<TPayload> {
    return { type: "goto", step: stepName, patch };
}

export function back<TPayload>(): TelegramTransition<TPayload> {
    return { type: "back" };
}

export function cancel<TPayload>({
    silent = false,
}: { silent?: boolean } = {}): TelegramTransition<TPayload> {
    return { type: "cancel", silent };
}

export function complete<TPayload>(
    patch?: Partial<TPayload>,
): TelegramTransition<TPayload> {
    return { type: "complete", patch };
}
