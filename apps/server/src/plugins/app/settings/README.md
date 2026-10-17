# Settings

This directory keeps the values that an admin changes in the chat with `/settings`, such as the limit of participants in a poker room. A domain registers its own settings here and reads them; the directory does not know any feature domain.

## Constraints

- A guard and a CASL ability are synchronous, `(user) => boolean`, and the default grants are a setting, so a setting must be readable without a call to MongoDB or Valkey.
- Several pods serve the bot, and an admin changes a value on one of them.

## Using a setting

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

const maxParticipants = settingsService.read(pokerMaxParticipantsSetting);
```

- Name a setting `<domain>.<name>` and keep its title in `<domain>-locales.ts`. The `emoji` starts the button of the setting in the menu, like the buttons of other screens; the line of the value shows the title without it.
- Make the default value the behaviour the code had before the setting, so a deploy changes nothing until an admin does. A setting that adds a new limit on purpose, such as `poker.maxParticipants`, is the exception; its domain README says what changes on the deploy.
- The plugin that registers a setting depends on `settings-service`. `settings-service` depends on `access-service`, so `AccessService` cannot register a setting itself; `access/access-default-grants.ts` does it for the default grants.

The settings in the code now are `users.autoBan`, `access.defaultGrants` and `poker.maxParticipants`.

## Values on every pod

**Problem.** `read` runs inside guards, on every update, and must not wait for a database. A value that only lives in the memory of one pod would differ between the pods.

**Idea.** MongoDB keeps the values, and every pod keeps a snapshot of all of them in memory. `read` takes the value from the snapshot, and the pod reads the snapshot again every 10 seconds.

**Data.** One document per changed setting in `settings`; a setting that nobody changed has no document and reads its default.

```json
{
    "_id": "poker.maxParticipants",
    "value": 12,
    "version": 3,
    "updatedBy": "66f1c2…",
    "updatedAt": "2026-10-17T12:00:00Z"
}
```

**Walk-through.** An admin sets the limit to 12 on pod A.

1. The number input of the `settings` scene calls `SettingsService.write`. It checks `update Setting`, which only `admin` has, and checks the value against the setting: the range of a number, the options of the choices.
2. `SettingsRepository.save` upserts the document, and the service logs `Setting changed`.
3. Pod A puts the value into its snapshot at once and emits `settings.settingChanged`. `settings-handlers.ts` publishes the topic `settings`, so the menu of every admin redraws.
4. Pod B reads all documents on its next refresh, at most 10 seconds later, and replaces its snapshot.

**Edge cases.**

- `read` checks the stored value against the setting. A value of the wrong type, or a number out of the range after a deploy changed it, reads the default; a choice that is no longer among the options is dropped.
- The first snapshot is read while the plugin loads, so the server does not start with defaults instead of the stored values; when MongoDB fails then, the server does not start. A failed refresh later logs `Failed to refresh settings` and keeps the old snapshot.
- A flag and a choice change relative to the stored document: `toggle` and `toggleChoice` compute the new value inside one MongoDB update and put the stored result into the snapshot. So a second press that lands on a pod with a stale snapshot does not undo the first one. A number is a plain `write` of the typed value, and of two admins who type one at the same time the later write wins.

## The menu

`/settings` starts the `settings` scene with the key `settings` and the guard `update Setting`, so only an admin sees the command. One slot shows every section with the value of each setting and under it one button per setting, each in its own row and named with the setting's `emoji` and title, then `✖️ Hide`. A flag switches at once with `toggle`; a number asks for a whole number and asks again while it is out of the range, then calls `write`; choices open a second screen with a checkbox per option and `‹ Back`, and each checkbox calls `toggleChoice`. Every change puts the stored value into the snapshot, so the screen shows what MongoDB holds.

## Files

| File                                                               | Owns                                                                        | Section                                     |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------- |
| `settings-service.ts`                                              | The kinds of settings, their registration, the snapshot, `read` and `write` | [Values on every pod](#values-on-every-pod) |
| `settings-repository.ts`                                           | The `settings` collection                                                   | [Values on every pod](#values-on-every-pod) |
| `setting-entity.ts`                                                | `SettingEntity` and `SettingsSubjects`                                      |                                             |
| `settings-handlers.ts`, `settings-scene.ts`, `settings-screen.ts`  | `/settings`, the scene and its two screens                                  | [The menu](#the-menu)                       |
| `settings-schemas.ts`, `settings-events.ts`, `settings-locales.ts` | The scene state and button values, `settings.settingChanged`, texts         |                                             |
