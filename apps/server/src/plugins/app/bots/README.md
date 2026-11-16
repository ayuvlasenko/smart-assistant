# Bots

This directory keeps the bots that the server serves. A bot is a tenant: its users, invites, settings and the data of its modules belong to it, see [Rules stay inside the bot](../access/README.md#rules-stay-inside-the-bot). The Telegram transport reads the token of a bot through `BotsRegistry`, and access reads the modules of a bot from it.

## Constraints

- A bot token is a password: whoever has it controls the bot.
- The id of a bot is the number before `:` in its token. It stays when the owner revokes the token in BotFather and gets a new one.
- Several pods serve the bots, and a bot changes on one of them.

## The root bot

The root bot is the bot of `TELEGRAM_BOT_TOKEN`. Its token lives only in the server secret; its record in `bots` keeps its modules. Every other bot keeps its token in MongoDB, encrypted. The module `bots` is on only in the root bot, so only an admin of the root bot reaches `/bots`: the subject `Bot` is closed in every other bot, see [Modules](../access/README.md#modules). `Bot` is checked against the subject name only, because a bot document has no `botId` of its own.

## Managing bots

`/bots` in the root bot starts the `bots` scene with the key `bots`, a TTL of 24 h and the guard `read Bot`. Every change emits `bots.botChanged`, and `bots-handlers.ts` publishes the topic `bots` in the root bot, so the screens of every admin redraw.

| Screen        | Params           | Shows                                                                                                          | Leads to                           |
| ------------- | ---------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `list`        |                  | Every bot with its status and modules; `➕ Add bot`                                                            | `bot`, the token input             |
| `bot`         | `botId`          | Id, status, modules and the webhook from `getWebhookInfo`; the root bot shows only its modules and its webhook | `modules`, `ownerInvite`, `‹ Back` |
| `modules`     | `botId`          | A checkbox per module; a press toggles the module                                                              | `‹ Back`                           |
| `ownerInvite` | `botId`, `token` | The owner link of the bot and `📋 Copy link`                                                                   | `‹ Back`                           |

The input `token` asks for a token with `cleanup: true`, so the message with the token is deleted once the step accepts it. `tokenBotId` in the state tells a new bot from a new token of a stopped or revoked one.

## Adding a bot

**Problem.** A new bot needs its webhook, its menu and its first admin, and nobody in it can create an invite yet. A token in the chat is a secret that stays in the history.

**Idea.** The root admin sends the token once; the service checks it with Telegram, stores it encrypted, connects the bot and creates a single-use admin invite of the new bot, the owner link.

**Walk-through.**

1. The admin presses `➕ Add bot` and sends the token. The step checks its form with `isBotToken`, and the engine deletes the message.
2. `BotsService.add` calls `getMe` with the token. Telegram returns the id and the username of the bot, or refuses the token.
3. The repository inserts the bot with `createIfMissing`, so a second admin who sends the same token gets `alreadyAdded` and a link to the bot.
4. The registry takes the bot at once; the other pods take it on their next refresh or on its first update.
5. The service sets the webhook and the default menu of the bot, then creates the owner link: an invite of the new bot with `admin` and `maxUses: 1`, see [Invites](../invites/README.md#bootstrap).
6. The scene shows the link. The owner opens it in the new bot and becomes its admin; from then on the owner manages invites, settings and the users of that bot alone.

**Edge cases.** Without `BOTS_ENCRYPTION_KEY` the service refuses with `keyMissing` before it calls Telegram. A failed `setWebhook` logs `Failed to connect the webhook of a bot` and keeps the bot: its screen shows the webhook as not connected, and `🔁 Webhook` tries again, as does every production start. `🔑 Owner link` creates a new owner link when the first one is lost. Only a bot that the registry serves has the button: a stopped bot and a bot whose token can't be decrypted get none, and `createOwnerInvite` creates no invite for them. The screen builds the owner link from the stored `username` of the bot with `buildTelegramDeepLinkUrl`, so it sends no request to Telegram and shows the link also when Telegram can't be reached. An open owner link shows that the link is unavailable once the bot stops or its token can't be decrypted. Only `add` and `🔄 Token` store the `username`: if the owner changes it, the label of the bot and the owner link keep the old one until `🔄 Token`. `🔄 Token` takes a new token of the same bot after the owner revoked the old one in BotFather; a token of another bot gets `otherBot`. Never log the token: it arrives as message text.

## Stopping a bot

`⏸ Stop` asks for a second press, removes the webhook with `deleteWebhook` and sets `disabledAt`. The registry drops the bot, so a late update gets `200` and is skipped, and a delivery to its users is skipped. The data of the bot stays. `▶️ Start` clears `disabledAt` and sets the webhook again. The root bot can't be stopped: its token lives in the server secret.

## The registry

**Problem.** Every update and every delivery needs the token of its bot, and an access check needs the modules of a bot without a call to MongoDB, because a guard is synchronous. A value in the memory of one pod would differ between the pods.

**Idea.** Every pod keeps a snapshot of the active bots with their decrypted tokens and modules, and reads it again every 10 seconds, like the [settings](../settings/README.md#values-on-every-pod).

**Data.** One document per bot in `bots`, with the bot id as `_id`:

```json
{
    "_id": "8123456789",
    "username": "poker_team_bot",
    "token": { "iv": "…", "tag": "…", "data": "…" },
    "modules": ["poker"],
    "createdBy": "66f1c2…",
    "version": 3,
    "createdAt": "2026-11-03T12:00:00Z",
    "updatedAt": "2026-11-03T12:05:00Z"
}
```

The root record has no `token` and no `username`. `BotTokenCipher` encrypts a token with AES-256-GCM and `BOTS_ENCRYPTION_KEY`: 32 random bytes in base64, such as the output of `openssl rand -base64 32`. The key lives in the server secret and never in MongoDB, so a dump of the database does not give the bots away.

**Walk-through.**

1. On start, `BotsRegistry.start` makes sure that the root record exists, with no modules, and reads every bot.
2. It takes the token of the root bot from `TELEGRAM_BOT_TOKEN` and adds `bots` to its modules. It decrypts the token of every other bot.
3. Every 10 seconds it reads all bots again and replaces the snapshot.
4. An update for a bot that is not in the snapshot yet, such as a bot created on another pod a second ago, calls `load`, which reads that bot from MongoDB.

**Edge cases.** A stopped bot, one with `disabledAt`, is not in the snapshot: an update of it gets `200` and is skipped, and a delivery to its users is skipped. Without `BOTS_ENCRYPTION_KEY`, or with another key, a stored token can't be decrypted: the registry logs `Bot token can't be decrypted` with the bot id and skips the bot. A decrypted token whose bot id differs from the `_id` of its document logs `Bot token belongs to another bot`, and the registry skips that bot too. The root bot does not depend on the key, so its admin can fix the key. A failed refresh logs `Failed to refresh bots` and keeps the old snapshot.

## Modules

A bot runs the core and the modules in its `modules`. A module is a feature domain that registers its access section with the subjects it owns, and access closes those subjects in the bots that do not have the module, see [Modules](../access/README.md#modules). The core is on in every bot: `access`, `users`, `settings` and `invites`.

## Files

| File                                                 | Owns                                                                       | Section                         |
| ---------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------- |
| `bot-entity.ts`                                      | The bot document, the subject `Bot`, the bot id of a token                 | [The registry](#the-registry)   |
| `bot-token-cipher.ts`                                | The encryption of a stored token                                           | [The registry](#the-registry)   |
| `bots-repository.ts`                                 | The `bots` collection                                                      | [The registry](#the-registry)   |
| `bots-registry.ts`                                   | The snapshot of the active bots, their tokens and their modules            | [The registry](#the-registry)   |
| `bots-service.ts`                                    | Adding, stopping and starting a bot, its modules and its token             | [Adding a bot](#adding-a-bot)   |
| `bots-scene.ts`, `bots-screen.ts`, `bots-schemas.ts` | The `/bots` scene and its screens                                          | [Managing bots](#managing-bots) |
| `bots-handlers.ts`                                   | The `bots` module, the `/bots` command and the redraw on `bots.botChanged` | [Managing bots](#managing-bots) |
| `bots-events.ts`, `bots-locales.ts`                  | The events and the texts of the domain                                     |                                 |
