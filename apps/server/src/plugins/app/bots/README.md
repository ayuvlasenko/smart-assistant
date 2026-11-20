# Bots

This directory keeps the bots that the server serves. A bot is a tenant: its users, invites, settings and the data of its modules belong to it, see [Rules stay inside the bot](../access/README.md#rules-stay-inside-the-bot). The Telegram transport reads the token of a bot through `BotsRegistry`, and access reads the modules of a bot from it.

## Constraints

- A bot token is a password: whoever has it controls the bot.
- Telegram identifies a bot by the number before `:` in its token. The number stays when the owner revokes the token in BotFather and gets a new one. A lost or deleted Telegram bot never comes back: its service needs another Telegram bot, with another number.
- Several pods serve the bots, and a bot changes on one of them.

## The id of a bot

**Problem.** The users, the invites, the settings and the data of the modules carry the `botId` of their bot. With the number of the token as that id, a bot that moves to another Telegram bot loses all of them.

**Idea.** The `_id` of a bot document is an internal id that never changes, and `telegramId` keeps the number of the token. MongoDB uses the internal id: the `botId` of the users, the invites, the settings and the data of the modules. Everything that belongs to the Telegram bot uses `telegramId`: the webhook path and its secret, the Valkey keys `telegram:<telegramId>:…` with the sessions, the claims and the caches, the buckets of the [rate limits](../telegram/README.md#rate-limits) and the label `bot` of the metrics. So a move takes the data along and leaves the state of the old Telegram bot behind.

**Data.** `BotsRepository` gives a new bot a generated id, such as `6741c2f09a3b5d0012e4a7c1`, and a new root bot the id `root`. A unique index keeps one document per `telegramId`. The flag `isRoot` marks the root bot.

**Edge cases.** Never read an `_id` as a Telegram number. The migration `20261117140000-give-bots-internal-ids.js` gave new ids to the bots that had the number of their token as `_id`, and wrote the new id to the `botId` of their users, invites, settings and poker rooms. It changed MongoDB only, and nothing else had to change: the Valkey keys and the webhook path carry the Telegram id, as before.

## The root bot

The root bot is the bot of `TELEGRAM_BOT_TOKEN`. Its token lives only in the server secret; its record in `bots`, the one with `isRoot`, keeps its modules. Every other bot keeps its token in MongoDB, encrypted. The module `bots` is on only in the root bot, so only an admin of the root bot reaches `/bots`: the subject `Bot` is closed in every other bot, see [Modules](../access/README.md#modules). `Bot` is checked against the subject name only, because a bot document has no `botId` of its own.

## Managing bots

`/bots` in the root bot starts the `bots` scene with the key `bots`, a TTL of 24 h and the guard `read Bot`. Every change emits `bots.botChanged`, and `bots-handlers.ts` publishes the topic `bots` in the root bot, so the screens of every admin redraw.

| Screen        | Params           | Shows                                                                                                                       | Leads to                                                            |
| ------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `list`        |                  | Every bot with its status and modules; `➕ Add bot`                                                                         | `bot`, the token input                                              |
| `bot`         | `botId`          | `telegramId`, status, modules and the webhook from `getWebhookInfo`; the root bot has no `🔄 Token`, `🔀 Move` and `⏸ Stop` | `modules`, `startModule`, `ownerInvite`, the token inputs, `‹ Back` |
| `modules`     | `botId`          | A checkbox per module; a press toggles the module                                                                           | `‹ Back`                                                            |
| `startModule` | `botId`          | The modules of the bot that have a start entry, and `Welcome message`; a press picks what `/start` opens                    | `‹ Back`                                                            |
| `ownerInvite` | `botId`, `token` | The owner link of the bot and `📋 Copy link`                                                                                | `‹ Back`                                                            |

The inputs `token` and `moveToken` ask for a token with `cleanup: true`, so the message with the token is deleted once the step accepts it. `tokenBotId` in the state keeps the bot that the token is for; without it, `token` adds a new bot.

## Adding a bot

**Problem.** A new bot needs its webhook, its menu and its first admin, and nobody in it can create an invite yet. A token in the chat is a secret that stays in the history.

**Idea.** The root admin sends the token once; the service checks it with Telegram, stores it encrypted, connects the bot and creates a single-use admin invite of the new bot, the owner link.

**Walk-through.**

1. The admin presses `➕ Add bot` and sends the token. The step checks its form with `isBotToken`, and the engine deletes the message.
2. `BotsService.add` reads the profile of the bot through `BotsConnector`, which calls `getMe` with the token. Telegram returns the id and the username of the bot, or refuses the token.
3. The repository inserts the bot with `createIfMissing`, an upsert by `telegramId`, so a second admin who sends a token of the same Telegram bot gets `alreadyAdded` and the screen of that bot.
4. No pod keeps a copy of the bots, so every pod finds the new bot in MongoDB on its first update.
5. The service sets the webhook and the default menu of the bot, then creates the owner link: an invite of the new bot with `admin` and `maxUses: 1`, see [Invites](../invites/README.md#bootstrap).
6. The scene shows the link. The owner opens it in the new bot and becomes its admin; from then on the owner manages invites, settings and the users of that bot alone.

**Edge cases.** Without `BOTS_ENCRYPTION_KEY` the service refuses with `keyMissing` before it calls Telegram. A failed `setWebhook` logs `Failed to connect the webhook of a bot` and keeps the bot: its screen shows the webhook as not connected, and `🔁 Webhook` tries again, as does every production start. `🔑 Owner link` creates a new owner link when the first one is lost, and revokes every older owner link of the bot, so a lost link stops working once a new one exists; `InvitesService` logs `Owner invite created` with the number of revoked links. Only a bot that the registry serves has the button: a stopped bot and a bot whose token can't be decrypted get none, and `replaceOwnerInvite` creates no invite for them. The screen builds the owner link from the stored `username` of the bot with `buildTelegramDeepLinkUrl`, so it sends no request to Telegram and shows the link also when Telegram can't be reached. An open owner link shows that the link is unavailable once the bot stops or its token can't be decrypted. Only `add`, `🔄 Token` and `🔀 Move` store the `username`: if the owner changes it, the label of the bot and the owner link keep the old one until `🔄 Token`. `🔄 Token` takes a new token of the same Telegram bot after the owner revoked the old one in BotFather; a token of another Telegram bot gets `otherBot`, which points to [`🔀 Move`](#moving-a-bot-to-another-telegram-bot). `replaceToken` of the repository writes only to a document that still has the `telegramId` of the token, so a replacement that races with a move of the same bot gets `otherBot` and leaves the moved bot as it is. Never log the token: it arrives as message text.

## Moving a bot to another Telegram bot

**Problem.** The owner loses the Telegram bot, or wants a bot with another username. A new bot added with `➕ Add bot` starts empty: the users, their grants and the data of the modules stay with the old one.

**Idea.** `🔀 Move` puts the token of another Telegram bot into the same document. The `_id` stays, so everything that carries the `botId` stays with the bot.

**Walk-through.**

1. The admin presses `🔀 Move`, presses it again to confirm, and sends the token of the other Telegram bot.
2. `BotsService.move` calls `getMe` with the token. A token of the same Telegram bot gets `sameBot`, and a Telegram bot that another document has gets `alreadyAdded` and the screen of that bot.
3. The service reads the bot with its old token. Then `moveToTelegramBot` stores the new `telegramId`, the token and the username. When another document took the Telegram bot after step 2, the unique index `telegramId_unique` refuses the write: the repository throws `BotTelegramIdTakenError`, the move answers `alreadyAdded`, and the bot keeps its Telegram bot and its webhook.
4. The service removes the webhook of the old Telegram bot with `deleteWebhook` and the token it read in step 3, so the old bot sends no more updates.
5. The service sets the webhook and the default menu of the new Telegram bot.

**Edge cases.** Telegram refuses a message to a user who has not opened the bot, so every user opens the new Telegram bot once: until then a delivery to the user fails with `403`. The scenes of a user stay under the old Telegram id and expire there, because their message ids belong to the chat with the old bot; the user starts again in the new one. The command menus are set again for the new Telegram bot, see [Access and the command menu](../telegram/README.md#access-and-the-command-menu). Every pod reads the bot from MongoDB on each update, so all of them use the new token at once. A failed `deleteWebhook` logs `Failed to delete the webhook of a bot` and the move goes on: the old Telegram bot then keeps sending updates to the path of its own Telegram id, which no bot has any more, so the server skips them.

The root bot moves without the scene. When `TELEGRAM_BOT_TOKEN` holds a token of a Telegram bot that no document has, `BotsRepository.ensureRoot` writes its number to the root document on start, and the registry logs `Root bot moved to another Telegram bot`. The server does not have the old token, so the webhook of the old Telegram bot stays until its owner removes it; its updates name the old Telegram id and are skipped. Production sets the webhook of the new Telegram bot on the same start, because the stored webhook `telegram:<telegramId>:webhook` belongs to the Telegram bot. A server with another root token that starts against the same database moves the root bot too, so keep one root token per database. When the token belongs to a Telegram bot that a document already has, that document becomes the root bot, and the old root document stays without a token and is not served.

## Stopping a bot

`⏸ Stop` asks for a second press, removes the webhook with `deleteWebhook` and sets `disabledAt`. The registry does not return a bot with `disabledAt`, so a late update gets `200` and is skipped, and a delivery to its users is skipped. The data of the bot stays. `▶️ Start` clears `disabledAt` and sets the webhook again. The root bot can't be stopped: its token lives in the server secret.

## The registry

**Problem.** Every update and every delivery needs the token of its bot, and an access check needs its modules. An admin changes a bot on one pod, and a copy of the bots in the memory of a pod differs from the copies of the other pods until the pod reads the bots again.

**Idea.** No pod keeps a copy of the bots. `BotsRegistry` reads a bot from MongoDB on every call, by its id or by its Telegram id, and decrypts its token, so every pod uses a change at once. Like the [settings](../settings/README.md#reading-and-writing-a-value), its methods return a promise.

**Data.** One document per bot in `bots`, see [The id of a bot](#the-id-of-a-bot):

```json
{
    "_id": "6741c2f09a3b5d0012e4a7c1",
    "telegramId": "8123456789",
    "username": "poker_team_bot",
    "token": { "iv": "…", "tag": "…", "data": "…" },
    "modules": ["poker"],
    "startModule": "poker",
    "createdBy": "66f1c2…",
    "version": 3,
    "createdAt": "2026-11-03T12:00:00Z",
    "updatedAt": "2026-11-03T12:05:00Z"
}
```

The root record has `isRoot` and the `telegramId` of `TELEGRAM_BOT_TOKEN`, and no `token` and no `username`. `BotTokenCipher` encrypts a token with AES-256-GCM and `BOTS_ENCRYPTION_KEY`: 32 random bytes in base64, such as the output of `openssl rand -base64 32`. The key lives in the server secret and never in MongoDB, so a dump of the database does not give the bots away.

**Walk-through.**

1. On start, `BotsRegistry.start` calls `ensureRoot` with the number of `TELEGRAM_BOT_TOKEN`. It marks the document with that `telegramId` as the root bot, or writes the number to the root document, or creates the root document with no modules. Then the registry reads every bot once and logs `Bots loaded`.
2. An update calls `findByTelegramId` with the Telegram id from the webhook path, and a delivery calls `find` with the bot id. Each reads one document.
3. For the root bot the registry takes the token from `TELEGRAM_BOT_TOKEN` and adds `bots` to the modules. For every other bot it decrypts the stored token.
4. `TelegramBots` keeps one Bot API client per bot and makes a new one when the token of the bot changes, so the rate limit queues of a bot live as long as its token.

**Edge cases.** A stopped bot, one with `disabledAt`, is not returned: an update of it gets `200` and is skipped, and a delivery to its users is skipped. Without `BOTS_ENCRYPTION_KEY`, or with another key, a stored token can't be decrypted: the registry logs `Bot token can't be decrypted` with the bot id on every read and skips the bot. A decrypted token whose number differs from the `telegramId` of its document logs `Bot token belongs to another bot`, and the registry skips that bot too. The root bot does not depend on the key, so its admin can fix the key. `modulesOf`, which the access service reads for every ability, reads only the stored modules and decrypts nothing, so a stopped bot or a bot with an unreadable token keeps its modules there. Every read is one query, and when MongoDB does not answer, the update fails: there is no older copy to fall back to. A failed read of the bots on start logs `Failed to read the bots on start`, and the pod sets no webhook and no menu then.

## Modules

A bot runs the core and the modules in its `modules`. A module is a feature domain that registers its access section with the subjects it owns, and access closes those subjects in the bots that do not have the module, see [Modules](../access/README.md#modules). The core is on in every bot: `access`, `users`, `settings` and `invites`.

## What start opens

`🏁 On /start` picks the start module of a bot: `/start` then opens the start entry of that module instead of the welcome text, see [The start module](../telegram/README.md#the-start-module). The screen offers the modules that are on in the bot and have a start entry, and `Welcome message`, which removes the choice. `BotsService.setStartModule` ignores any other module. A change sets the menus of the bot again, because the menu shows `/start` with the description of the entry. `toggleModule` removes `startModule` in the same update that turns the module off, and `BotsRepository.setStartModule` writes a module only while the bot has it, so a bot never points to a module it does not have, even when one admin turns the module off while another picks it.

## Files

| File                                | Owns                                                                       | Section                             |
| ----------------------------------- | -------------------------------------------------------------------------- | ----------------------------------- |
| `bot-entity.ts`                     | The bot document, the subject `Bot`, the Telegram id of a token            | [The id of a bot](#the-id-of-a-bot) |
| `bot-token-cipher.ts`               | The encryption of a stored token                                           | [The registry](#the-registry)       |
| `bots-repository.ts`                | The `bots` collection                                                      | [The registry](#the-registry)       |
| `bots-registry.ts`                  | Reading the active bots, their tokens and their modules                    | [The registry](#the-registry)       |
| `bots-service.ts`                   | Adding, moving, stopping and starting a bot, its modules and its token     | [Adding a bot](#adding-a-bot)       |
| `bots-connector.ts`                 | The calls of a bot to Telegram: `getMe`, the webhook and the menus         | [Adding a bot](#adding-a-bot)       |
| `bots-scene.ts`, `bots-screen.ts`   | The `/bots` scene with its state and button schemas, and its screens       | [Managing bots](#managing-bots)     |
| `bots-handlers.ts`                  | The `bots` module, the `/bots` command and the redraw on `bots.botChanged` | [Managing bots](#managing-bots)     |
| `bots-events.ts`, `bots-locales.ts` | The events and the texts of the domain                                     |                                     |
