# Bots

This directory keeps the bots that the server serves. A bot is a tenant: its users, invites, settings and the data of its modules belong to it, see [Rules stay inside the bot](../access/README.md#rules-stay-inside-the-bot). The Telegram transport reads the token of a bot through `BotsRegistry`, and access reads the modules of a bot from it.

## Constraints

- A bot token is a password: whoever has it controls the bot.
- The id of a bot is the number before `:` in its token. It stays when the owner revokes the token in BotFather and gets a new one.
- Several pods serve the bots, and a bot changes on one of them.

## The root bot

The root bot is the bot of `TELEGRAM_BOT_TOKEN`. Its token lives only in the server secret; its record in `bots` keeps its modules. Every other bot keeps its token in MongoDB, encrypted. The module `bots` is on only in the root bot.

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

**Edge cases.** A stopped bot, one with `disabledAt`, is not in the snapshot: an update of it gets `200` and is skipped, and a delivery to its users is skipped. Without `BOTS_ENCRYPTION_KEY`, or with another key, a stored token can't be decrypted: the registry logs `Bot token can't be decrypted` with the bot id and skips the bot. The root bot does not depend on the key, so its admin can fix the key. A failed refresh logs `Failed to refresh bots` and keeps the old snapshot.

## Modules

A bot runs the core and the modules in its `modules`. A module is a feature domain that registers its access section with the subjects it owns, and access closes those subjects in the bots that do not have the module, see [Modules](../access/README.md#modules). The core is on in every bot: `access`, `users`, `settings` and `invites`.

## Files

| File                  | Owns                                                            | Section                       |
| --------------------- | --------------------------------------------------------------- | ----------------------------- |
| `bot-entity.ts`       | The bot document, the subject `Bot`, the bot id of a token      | [The registry](#the-registry) |
| `bot-token-cipher.ts` | The encryption of a stored token                                | [The registry](#the-registry) |
| `bots-repository.ts`  | The `bots` collection                                           | [The registry](#the-registry) |
| `bots-registry.ts`    | The snapshot of the active bots, their tokens and their modules | [The registry](#the-registry) |
