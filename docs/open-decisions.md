# Open decisions

Known gaps that need a decision before they matter. Remove an entry when it is resolved, and record the decision in the commit message.

## Setting the user's time zone

- **Problem:** `UserEntity.timeZone` exists, but nothing sets it. Every user gets `TIME_ZONE` (`UTC` by default).
- **Impact:** for users far from `TIME_ZONE`, Today, Yesterday and partial dates in `dateStep` use the wrong calendar day for some hours of the day.
- **Options:**
    - A `/timezone` command with a scene and a `choiceStep` of common zones.
    - Derive the zone from a shared location.
    - Set `TIME_ZONE` to the zone of most users and add a per-user setting later.
- **Decide when:** the first feature that stores user dates ships.
