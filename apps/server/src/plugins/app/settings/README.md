# Settings

This directory keeps the values that people change in the chat with `/settings`. A setting of a bot is a value for everybody in the bot, such as the limit of participants in a poker room, and an admin changes it. A setting of a user is a value of one user, such as the language, and every user changes their own. A domain registers its own settings here and reads them; the directory does not know any feature domain.

## Constraints

- Several pods serve the bot, and an admin changes a value on one of them.

## Using a setting of a bot

A setting is a constant of the domain that owns it. There are three kinds:

| Kind      | Value      | Changed in the menu by                                            |
| --------- | ---------- | ----------------------------------------------------------------- |
| `flag`    | `boolean`  | one press on its button                                           |
| `number`  | an integer | a typed number between `min` and `max`, asked by a `numberStep`   |
| `choices` | `string[]` | checkboxes of `options()`, a function, so the options follow code |

The domain registers one section with its settings in its plugin and reads the value with `read`. `poker-rooms-service.ts` is the reference:

```ts
export const pokerMaxParticipantsSetting: NumberSetting = {
    kind: "number",
    name: "poker.maxParticipants",
    title: (t) => t("poker:maxParticipantsSetting"),
    emoji: "👥",
    defaultValue: 40,
    min: 2,
    max: 100,
};

settingsService.register({
    name: "poker",
    title: (t) => t("poker:section"),
    settings: [pokerMaxParticipantsSetting],
});

const maxParticipants = await settingsService.read(
    pokerMaxParticipantsSetting,
    room.botId,
);
```

- A section with the name of an access module, such as `poker`, shows in the menu only in the bots that have the module, see [Modules](../access/README.md#modules). `listSections(botId)` resolves to the sections of a bot, and `options(botId)` of a choices setting resolves to the options in a bot.
- Name a setting `<domain>.<name>` and keep its title in `<domain>-locales.ts`. The `emoji` starts the button of the setting in the menu, like the buttons of other screens; the line of the value shows the title without it.
- Make the default value the behaviour the code had before the setting, so a deploy changes nothing until an admin does. A setting that adds a new limit on purpose, such as `poker.maxParticipants`, is the exception; its domain README says what changes on the deploy.
- The plugin that registers a setting depends on `settings-service`. `settings-service` depends on `access-service`, so the default grants, a setting of the access domain, have a plugin of their own, `access/access-default-grants.ts`, which depends on both.

The settings of a bot in the code now are `users.autoBan`, `access.defaultGrants` and `poker.maxParticipants`.

## Reading and writing a value

**Problem.** An admin changes a value on one pod, and the other pods must use it. A copy of the values in the memory of a pod differs from the copies of the other pods until the pod reads the values again.

**Idea.** MongoDB keeps the values, and no pod keeps a copy. `read` asks MongoDB on every call and returns a promise, so every pod uses a new value at once. Every bot has its own values, so `read` takes the bot id, from the user or the entity at hand.

**Data.** One document per changed setting of a bot in `settings`, with a unique index on `botId` and `name`; a setting that nobody changed in a bot has no document there and reads its default.

```json
{
    "_id": "6710a3…",
    "botId": "6741c2f09a3b5d0012e4a7c1",
    "name": "poker.maxParticipants",
    "value": 12,
    "version": 3,
    "updatedBy": "66f1c2…",
    "updatedAt": "2026-10-17T12:00:00Z"
}
```

**Walk-through.** An admin sets the limit to 12 on pod A.

1. The number input of the `settings` scene calls `SettingsService.write`. It checks `update Setting`, which only `admin` has, and checks the value against the setting: the range of a number, the options of the choices.
2. `SettingsRepository.save` upserts the document, and the service logs `Setting changed`.
3. The service emits `settings.settingChanged` with the bot id. `settings-handlers.ts` publishes the topic `settings` in that bot, so the bot settings of every admin of the bot redraw. It also calls `TelegramCommandMenus.syncBotById`, because a setting such as the default grants changes the commands of the bot, see [Access and the command menu](../telegram/README.md#access-and-the-command-menu).
4. The next `read` on any pod finds the document and returns 12.

**Edge cases.**

- `read` checks the stored value against the setting. A value of the wrong type, or a number out of the range after a deploy changed it, reads the default; a choice that is no longer among the options is dropped.
- Every `read` is one query. Every update reads `users.autoBan` before it finds or creates its user, and reads `access.defaultGrants` when it builds an ability. A stored value of a choices setting costs one more read, of the bot, because `read` drops the choices that the bot does not offer. When MongoDB does not answer, `read` rejects and the update fails: there is no older value to fall back to.
- A flag and a choice change relative to the stored document: `toggle` and `toggleChoice` compute the new value inside one MongoDB update. So two presses that land on different pods do not undo each other. A number is a plain `write` of the typed value, and of two admins who type one at the same time the later write wins.

## A setting of a user

**Problem.** A value of one user, such as the language, has no place in the `settings` collection: its documents belong to a bot. A store of its own with one document per user would be read on every update, and a document that is saved as a whole loses a change when two settings change at once.

**Idea.** The user document keeps the settings of the user, each in its own field, and the transport loads that document for every update anyway. A write sets or removes one field, so two writes never overwrite each other.

**Data.** `settings.<domain>.<name>` of the user document; the name of a setting is that path, such as `users.language`. A setting at its default has no field.

```json
{
    "_id": "66f1c2…",
    "botId": "6741c2f09a3b5d0012e4a7c1",
    "telegramId": "42",
    "languageCode": "en",
    "settings": { "users": { "language": "uk" } }
}
```

A setting of a user has one kind, `choice`: one value among `options(botId)`, with a `defaultValue` that is one of them. The owner registers a section with `UserSettingsService.register` and reads the value with `readUserChoice(setting, user)`, a plain function that needs only the user. `user-language.ts` is the reference:

```ts
export const languageSetting: UserChoiceSetting = {
    kind: "choice",
    name: "users.language",
    title: (t) => t("users:languageSetting"),
    emoji: "🌐",
    defaultValue: "auto",
    options: () => [
        { value: "auto", title: (t) => t("users:languageAuto") },
        { value: "uk", title: () => "Українська" },
    ],
};

userSettingsService.register({
    name: "users",
    title: (t) => t("users:generalSection"),
    settings: [languageSetting],
});

const language = readUserChoice(languageSetting, user);
```

**Walk-through.** A user picks `Українська`.

1. The `pick` button of the `settings` scene calls `UserSettingsService.write(user, setting, "uk")`. It checks the value against the options.
2. `UsersRepository.setSetting` runs one update, `$set: { "settings.users.language": "uk" }`, and returns the stored user. The default value runs `$unset` of the same field.
3. The service logs `User setting changed` and emits `settings.userSettingChanged` with the stored user. `settings-handlers.ts` calls `TelegramCommandMenus.syncUser`, so the menu of the chat follows the language, see [Access and the command menu](../telegram/README.md#access-and-the-command-menu).
4. The handler passes the stored user to `ctx.refreshUser`, so the same update draws the screen in the new language.

**Edge cases.**

- `readUserChoice` reads the default for a stored value that is no longer an option, so a deploy that removes an option needs no migration.
- `register` refuses a name that is not `<domain>.<name>`, because the name is a path in the document. `SettingsRegistry` applies the same check to the settings of a bot.
- A section with the name of an access module shows only in the bots that have the module, like a section of bot settings.
- One person has a separate user in every bot, so a setting belongs to one bot.
- `languageOf(user)` in `user-language.ts` is the language of the texts: the picked language, or `languageCode` of the Telegram client when the setting is `auto`. Read the language through it and never from `languageCode`.

The only setting of a user in the code now is `users.language`.

## The menu

`/settings` starts the `settings` scene with the key `settings` for every user. The `list` screen shows the settings of the user with their values, one button per setting, and `⚙️ Bot settings` for a user who passes `update Setting`, which only `admin` has. A setting of the user pushes the `choice` screen with one row per option, and a press calls `UserSettingsService.write`.

`⚙️ Bot settings` pushes the `bot` screen. It shows every section with the value of each setting and under it one button per setting, each in its own row and named with the setting's `emoji` and title. The screens `bot` and `choices`, their buttons and the number input carry the guard `update Setting`, and only these two screens watch the topic `settings`. There is no dismiss button: a second `/settings` moves the same message to the bottom of the chat, and the scene expires 24 hours after its last use. A flag switches at once with `toggle`; a number asks for a whole number and asks again while it is out of the range, then calls `write`; choices push the `choices` screen with the name of the setting in its params, a checkbox per option and `‹ Back`, and each checkbox calls `toggleChoice`. The number input is not a screen, so it keeps the name of its setting in `numberSetting` of the state until the answer arrives. Every render reads the values from MongoDB, so the screen shows what MongoDB holds.

## Files

| File                                                              | Owns                                                                       | Section                                                     |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `settings-service.ts`                                             | The kinds of settings, their registration, `read` and `write`              | [Reading and writing a value](#reading-and-writing-a-value) |
| `user-settings-service.ts`                                        | The settings of a user: their registration, `readUserChoice` and `write`   | [A setting of a user](#a-setting-of-a-user)                 |
| `settings-repository.ts`                                          | The `settings` collection                                                  | [Reading and writing a value](#reading-and-writing-a-value) |
| `settings-registry.ts`                                            | The sections and the names of both kinds of settings                       |                                                             |
| `setting-entity.ts`                                               | `SettingEntity` and `SettingsSubjects`                                     |                                                             |
| `settings-handlers.ts`, `settings-scene.ts`, `settings-screen.ts` | `/settings`, the scene with its state and button schemas, its four screens | [The menu](#the-menu)                                       |
| `settings-events.ts`, `settings-locales.ts`                       | The two events, texts                                                      |                                                             |
