---
worth: later
where: apps/server/src/plugins/app/users/user-entity.ts:11
added: 2026-10-15
---

# the time zone of a user is never set

`UserEntity.timeZone` exists, but nothing sets it, so every user gets `TIME_ZONE` (`UTC` by default). For users far from `TIME_ZONE`, Today, Yesterday and partial dates in `dateStep` use the wrong calendar day for some hours of the day.

Options:

- A `/timezone` command with a scene and a `choiceStep` of common zones.
- Derive the zone from a shared location.
- Set `TIME_ZONE` to the zone of most users and add a per-user setting later.

The value is unsettled until a feature stores user dates: decide when the first such feature ships. Moved from `docs/open-decisions.md`.
