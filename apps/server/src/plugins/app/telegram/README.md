# Telegram

This directory is the Telegram transport and the scene engine of the bot. It turns a webhook request into a call of a command, a route or a scene, keeps the per-user state in Valkey, and draws the scene messages. It does not import feature domains: a domain registers its commands and scenes through `TelegramRouter`.

The rules for writing scenes, inputs, buttons and slots live in the root `AGENTS.md`. This file explains how the pieces fit together and why they exist.

## Map

```mermaid
flowchart TD
    route["routes/api/telegram<br/>POST /webhook"] --> handler[TelegramUpdateHandler]
    handler -->|"claim update_id"| lock[LockService]
    handler -->|"find or create user"| users[UsersRepository]
    handler -->|withUpdate| chats[TelegramChats]

    chats -->|"lock + load + save"| sessions[TelegramSessionStore]
    sessions --> session[TelegramSession]
    chats -->|"new context"| ctx[TelegramContext]
    chats -->|withScenes| engine[TelegramSceneEngine]
    chats -->|"handler(ctx)"| router[TelegramRouter]

    router -->|"middleware"| engine
    router -->|"command / on / when"| domain["Domain handlers"]

    engine --> storage[TelegramSceneStorage]
    engine --> buttons[TelegramSceneButtons]
    engine --> inputs[TelegramSceneInputs]
    engine --> slots[TelegramSceneSlots]
    inputs --> steps["telegram-steps.ts"]

    ctx --> responder[TelegramResponder]
    responder --> api[TelegramApiService]

    domainEvents["Domain events<br/>(emittery)"] -->|deliver| chats

    bot[TelegramBotService] -->|"setWebhook, setMyCommands"| api
    bot -->|listCommands| router
```

## An incoming update

```mermaid
sequenceDiagram
    participant R as POST /webhook
    participant H as TelegramUpdateHandler
    participant C as TelegramChats
    participant S as TelegramSessionStore
    participant E as TelegramSceneEngine
    participant Rt as TelegramRouter

    R->>H: handle(update)
    H->>H: claim update_id, check private chat
    H->>H: find user, accept invite if banned
    H->>C: withUpdate(update, user)
    C->>S: withSession(userId)
    Note over S: waits for the session lock
    S->>C: TelegramSession
    C->>C: new TelegramContext
    C->>E: withScenes(ctx)
    E->>Rt: dispatch(ctx)
    Rt->>E: handle(ctx, next)
    alt button press or input text
        E->>E: run the scene handler or the input step
    else nothing for the scenes
        E->>Rt: next()
        Rt->>Rt: command, then on/when routes
    end
    E->>E: render slots of touched scenes
    E->>E: save touched scenes (also on failure)
    S->>S: write changed fields if the lock is still held
    H->>H: answer callback, map errors to a reply and a metric
```

`TelegramUpdateHandler` turns every expected failure into a typed error from `telegram-errors.ts` and a result label of `telegram_updates_total`. For a request with a valid secret token the route always answers `200`, so Telegram does not retry an update that failed in the bot.

## An update for other users

Some data belongs to several users at once: a shared entity in a domain repository. Every user who works with it has their own scene instance, keyed by the entity id, that shows it. When one user changes the entity, the scenes of the other users must redraw. Nobody writes to the sessions of other users directly: the change goes through a domain event and a delivery.

```mermaid
sequenceDiagram
    participant D as Domain service
    participant Em as eventEmitter
    participant P as Domain plugin
    participant C as TelegramChats
    participant E as TelegramSceneEngine

    D->>D: save the shared entity
    D->>Em: emit("{domain}.{entity}Changed", entity)
    Em->>P: listener
    P->>C: deliver(scene, targets, handle?)
    Note over C: returns at once, runs in the background
    loop every target user
        C->>C: load user, skip banned
        C->>C: withChat: session lock + context without update
        C->>E: deliver(ctx, scene, key)
        E->>E: find the scene instance by key, run handle
        E->>E: render slots, save
    end
```

`targets` pairs every user id with the scene key, which is the entity id. Without `handle` the scene only redraws its slots from the repository; with `handle` it can also change its state or send a notification.

## Abstractions

| File                                                               | Owns                                         | Why it exists                                                                                                                                                                                      |
| ------------------------------------------------------------------ | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `telegram-update-handler.ts`                                       | One webhook update from start to end         | Keeps the transport rules (duplicates, private chats, bans, invites, error replies) out of the domain code.                                                                                        |
| `telegram-chats.ts`                                                | Running code inside one user's chat          | The only place that builds a `TelegramContext`: for an incoming update and for a delivery to other users. Both need the same session lock, context and scene saving.                               |
| `telegram-session-store.ts`, `telegram-session.ts`                 | The session hash `telegram:session:<userId>` | Reads fields lazily, collects changes, and writes them in one atomic call under the session lock. Every field has its own TTL.                                                                     |
| `telegram-context.ts`                                              | What a handler can do in the chat            | Reply, send, edit, delete, answer a callback. It emits `messageSent`, `messageEdited` and `messageRemoved`, so the engine can see which message got which buttons without the handlers telling it. |
| `telegram-responder.ts`                                            | Telegram API calls for one chat              | Works without a session, so the update handler can reply before the context exists (welcome, unknown command, error).                                                                              |
| `telegram-api-service.ts`                                          | HTTP calls to the Bot API                    | Plain `fetch` with a timeout, logs and metrics.                                                                                                                                                    |
| `telegram-router.ts`                                               | Commands, filters, middlewares               | Domains register here. The scene engine runs as a middleware before the routes, so a running input gets the text first. Registration closes on `onReady`.                                          |
| `telegram-scene.ts`                                                | The scene definition API                     | `defineScene` turns a typed definition into an erased `TelegramScene` that the engine stores by name.                                                                                              |
| `telegram-scene-engine.ts`                                         | The life of scene instances                  | Starts, finds, ends scenes; routes button presses and input text; tracks which instances an update touched, renders their slots after success and saves them always.                               |
| `telegram-scene-storage.ts`                                        | Scene records in the session                 | Ids, keyed scenes, the input focus, the blocking scene, TTL and `maxAge`. One storage object per session.                                                                                          |
| `telegram-scene-buttons.ts`                                        | Button values of an instance                 | `callback_data` carries only `<sceneId>:<buttonId>`; the values stay in the record. Reuses the id of an equal button so an edited message keeps working.                                           |
| `telegram-scene-inputs.ts`                                         | Named inputs and their steps                 | One input waits for text at a time. Applies transitions, tracks the messages to clean up, drops a failed input.                                                                                    |
| `telegram-scene-slots.ts`                                          | Messages that mirror the state               | Renders a slot, compares a hash and edits, replaces or deletes the message. Handlers only change the state.                                                                                        |
| `telegram-steps.ts`                                                | Reusable steps                               | `textStep`, `numberStep`, `dateStep`, `choiceStep`.                                                                                                                                                |
| `telegram-system-handlers.ts`                                      | Built-in commands                            | `/start`, `/cancel` and the `ping` text.                                                                                                                                                           |
| `telegram-bot-service.ts`                                          | Bot setup                                    | Sets the webhook once per hour across pods, sets localized commands, resolves the bot username.                                                                                                    |
| `telegram-filters.ts`, `telegram-extractors.ts`                    | Reading an `Update`                          | Type guards for routes and helpers that read the user, chat, command and type.                                                                                                                     |
| `telegram-metrics.ts`, `telegram-errors.ts`, `telegram-locales.ts` | Metrics, error types, texts                  |                                                                                                                                                                                                    |

The engine splits its work into storage, buttons, inputs and slots. The engine owns the per-update state (which instances were touched), and the other four are services without state that get the instance as an argument. Only `TelegramSceneButtons` keeps the buttons created in the current update, in a `WeakMap` by instance.

## State in Valkey

```mermaid
flowchart LR
    subgraph hash["telegram:session:{userId} (hash)"]
        f1["scene:{sceneId}<br/>name, state, buttons, slots, input"]
        f2["scene:{sceneId} ..."]
        focus["focus<br/>id of the scene whose input waits for text"]
        blocking["blocking<br/>id of the running blocking scene"]
    end
    lockKey["telegram:session:{userId}:lock<br/>token of the update that holds it"]
    claim["telegram:update:{update_id}<br/>24 h claim against duplicates"]
```

Every key also has the prefix `smart-assistant:<RESOURCE_NAME>:` from the ioredis client. A keyed scene has an id built from a hash of the scene name and the key, so a second `start` with the same key finds the running scene. A scene without a key gets a random id.

## Blocking scenes

A scene with `blocking: true` keeps the user inside it until it ends, expires or gets `/cancel`. The `blocking` field works like `focus`, but for the whole scene: it points to the scene and expires with it.

```mermaid
flowchart TD
    start["sceneEngine.start(ctx, scene, state)"] --> blocker{"another blocking<br/>scene runs?"}
    blocker -->|yes| refuse["reply sceneBlocked / sceneBlockedStart<br/>return false"]
    blocker -->|no| own{"scene is blocking and<br/>another input waits?"}
    own -->|yes| busy["reply inputBusy<br/>return false"]
    own -->|no| run["start or show again<br/>return true"]

    ask["scene.ask(name)"] --> askBlocker{"another blocking<br/>scene runs?"}
    askBlocker -->|yes| askRefuse["reply sceneBlocked"]
    askBlocker -->|no| askFocus["focus check as before"]

    cancel["/cancel"] --> hasBlocker{"blocking scene runs?"}
    hasBlocker -->|yes| endScene["cancel its input (runs the cancel hook),<br/>end it, remove slot buttons"]
    hasBlocker -->|no| cancelInput["cancel the waiting input"]
```

Buttons of other running scenes keep working: their `callback_data` names the scene, so a press does not need to wait for the blocking scene. A button handler that starts a scene still gets `false`, and its `scene.ask` gets a refusal, so the input focus belongs to the blocking scene while it runs. A blocking scene without a `key` gets a random id, so `start` reuses the id of the running blocking scene of the same scene definition and shows it again.

## Startup

```mermaid
flowchart LR
    reg["Plugins register:<br/>router.command / router.scene"] --> ready["onReady:<br/>router.lock()"] --> listen["onListen:<br/>setWebhook (production),<br/>setMyCommands"]
    close["onClose:<br/>telegramChats.idle()"]
```

## Where to start reading

1. `telegram-update-handler.ts`, `handle()`: the whole path of an update.
2. `telegram-chats.ts`, `withContext()`: how a context and the scenes get their session.
3. `telegram-scene-engine.ts`, `handle()` and `withScenes()`: how scenes get updates and when they are saved and drawn.
4. `telegram-chats.test.ts` and `telegram-scene-engine.test.ts`: small complete scenes that show the API in use.
