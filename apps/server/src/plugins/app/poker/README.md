# Poker

This directory is planning poker in the bot. A user with the right grant creates a room, shares its link, and the participants vote on rounds with cards. Every participant sees the room as one message that changes when anybody votes, reveals the cards or starts a round. The domain registers its own grants, command, deep link and scenes; no other domain imports it.

- [Constraints](#constraints)
- [Using the bot](#using-the-bot)
- [A room document](#a-room-document)
- [Joining a room](#joining-a-room)
- [Who counts in a round](#who-counts-in-a-round)
- [Leaving a room](#leaving-a-room)
- [Closed rooms](#closed-rooms)
- [Updates for the participants](#updates-for-the-participants)
- [The round summary](#the-round-summary)
- [Participant labels](#participant-labels)
- [Files](#files)

## Constraints

- Every participant has their own copy of the room message, and the bot can only edit a message, never share one. A vote changes the message of every participant.
- The engine never edits a `media` message into another kind, and we do not know whether Telegram edits a `text` message into a `rich` one, see [Screens and messages](../telegram/README.md#screens-and-messages). Every poker message is `text` with `parse_mode: "HTML"` on every screen, so a message keeps its kind and the engine edits it instead of deleting it and sending a new one.
- A `rich` message was tried first and dropped: Telegram clients stretch a rich table over the whole width and draw headings in a large serif font, so a small room looked sparse. HTML text keeps the room compact. The history uses plain lines too: a quote per round drew a heavy bar around each round and did not fold short rounds.
- The Bot API allows about one message per second in one chat, see [Rate limits](../telegram/README.md#rate-limits). A room of ten participants gets ten edits for one vote.
- A message holds at most 4096 characters of text after the HTML is parsed, and Telegram does not split a longer one: it refuses the message. A large room would reach the limit on its own, so a list of voters shows ten labels and `+N` for the rest, a history page holds only the rounds that fit, and `buildPokerMessage` drops the last lines of any text that is still too long and ends it with `…`. `measureTelegramHtml` counts the text without tags, in UTF-16 code units, the unit the Bot API uses for text entities, so an emoji counts as two.

## Using the bot

| Grant          | Gives                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `poker.join`   | `/poker`, the room links, voting, revealing, new rounds, round titles, auto reveal, roles, removing participants, and the user's rooms |
| `poker.create` | Everything of `poker.join`, the room form, closing the user's own rooms, and the rooms they closed                                     |

`poker.create` runs the rules of `poker.join` in its own `define`, so an invite needs only one of them. The rules are in `poker-handlers.ts`:

| Action and subject | Condition                                  | Grant          |
| ------------------ | ------------------------------------------ | -------------- |
| `use PokerRoom`    | none                                       | both           |
| `read PokerRoom`   | `participants: { $elemMatch: { userId } }` | both           |
| `create PokerRoom` | `createdBy: user._id`                      | `poker.create` |
| `update PokerRoom` | `createdBy: user._id`                      | `poker.create` |
| `read PokerRoom`   | `createdBy: user._id`                      | `poker.create` |

The flow of a user:

1. `/poker` starts the `poker` scene, which lives 7 days after its last use. It shows the open rooms of the user, five on a page. A user with `poker.create` also gets `➕ New room` and `🗄 Closed rooms`. The lists, the form and its deck choice are screens of the scene, and `‹ Back` returns to the page of the list the user left.
2. `➕ New room` opens the form. Its buttons `🃏 Deck`, `✏️ Title` and `⚡ Auto reveal` carry no values: the text of the form shows them. The form holds the deck, `fibonacciShort` by default, an optional title of at most 64 characters (a room without one shows its creation time, such as `31.12 19:15`, in the time zone of the viewer), and auto reveal, which `⚡ Auto reveal` switches between everyone, the default, and off. How many votes may be missing depends on who joins, so the room menu sets it, see [Who counts in a round](#who-counts-in-a-round). `✅ Create` creates the room and starts its `pokerRoom` scene below the list.
3. Another user opens the room link, `https://t.me/<bot>?start=poker_<token>`, and joins. `📋 Copy link` stands under the main action of the room, in one row with `⋯ More`, and copies this link to the clipboard of the participant through `copy_text`, so the participant pastes it into any chat.
4. A participant presses a card to vote and presses the same card again to take the vote back. The cards stand in even rows of at most six, so the six cards of `fibonacciShort` fit one row and the 11 cards of `fibonacci` take two. The own card is blue, without a mark in its text. The others see `✅` for a vote, `⏳` for a wait, `💤` for an idle participant and `👀` for an observer, never the card. An observer has no cards on the keyboard.
5. Any participant presses `👁 Reveal · 2/3`, which counts the votes against the active participants and turns green when everyone voted. With auto reveal the button reads `⚡ Reveal · 2/3` and counts against the number of votes that reveals the round; the round message says nothing about it. The message shows the cards and the [round summary](#the-round-summary). `🔁 Revote` starts a round with the same title; `➡️ Next round`, blue, starts a round without a title.
6. `⋯ More` switches the keyboard of the same message to a menu of the viewer only: `✏️ Round title` and `📜 History`, then `👀 Watch` and `👥 Participants`, then `⚡ Auto reveal`, then `‹ Back` with `🔒 Close` beside it for the creator. `👀 Watch` makes the viewer an observer, `🃏 Vote` in its place makes an observer vote again, and both return to the round. `⚡ Auto reveal` shows the current setting under the round and `➖` and `➕` to change it. `👥 Participants` lists the participants, eight on a page, one button each; an observer's button starts with `👀`. A press opens the card of the participant: `👀 Make observer` or `🃏 Make voter` switches the role, and `🚫 Remove` with a second press on `🚫 Sure?` [removes the participant](#leaving-a-room). The own card has `👀 Watch` or `🃏 Vote`, and `🚪 Leave`. After an action the card returns to the list. Any participant uses these screens. `✏️ Round title` returns to the round and asks for the title of the current round, at most 100 characters; `/skip` clears it. `📜 History` shows the revealed rounds that have votes, newest first, at most five on a page and fewer when their text does not fit into one message; its `‹ Back` returns to the menu. Each round is a bold line with its number, title, agreement and median, then one line per card with its voters.

The colours come from the `style` field of an inline button: `primary`, `success` and `danger`. A client without it shows plain buttons, and then the own card does not stand out.

The creator closes a room with the red `🔒 Close` and a second press on `🔒 Sure?`; otherwise the room [closes by itself](#closed-rooms). A participant [leaves the room](#leaving-a-room) from the own card, and a participant who only stops voting becomes [idle](#who-counts-in-a-round).

The decks are in `poker-decks.ts`. A deck has no `?` or `☕` card: every card is an estimate.

| Deck                | Cards                                |
| ------------------- | ------------------------------------ |
| `fibonacciShort`    | 1, 2, 3, 5, 8, 13                    |
| `fibonacciModified` | 0, ½, 1, 2, 3, 5, 8, 13, 20, 40, 100 |
| `fibonacci`         | 0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89 |
| `powersOfTwo`       | 0, 1, 2, 4, 8, 16, 32, 64            |
| `tShirt`            | XS, S, M, L, XL, XXL                 |

## A room document

**Problem.** Several participants press buttons at the same time, on different pods. A plain read, change and write loses the first of two presses, and two presses of `➡️ Next round` must not start two rounds. A change can also set off a rule of the room: with auto reveal, the last vote reveals the round. When the rule runs as a second write, the room changes between the two writes, and the round reveals on votes that are gone or never reveals.

**Idea.** One document holds the whole room. Every change is a pure function of the room in `poker-room-transitions.ts`: it checks what the change expects and returns the fields to write, or `null`. `PokerRoomsService` adds the auto reveal to the same fields and writes them only while the stored `version` is the one it read. A change that lost the race reads the room again and decides again. So every rule of the room is written once, in TypeScript, and no change can skip it or decide on an outdated room.

**Data.** One document per room in `pokerRooms`:

```json
{
    "_id": "6710a3…",
    "version": 17,
    "token": "2V0ICkuAaR3tX2xuOiiHow",
    "createdBy": "66f1c2…",
    "title": "Sprint 42",
    "deck": "fibonacciShort",
    "autoReveal": { "missingVotes": 1 },
    "lastActivityAt": "2026-10-16T12:00:00Z",
    "participants": [
        {
            "userId": "66f1c2…",
            "emoji": "🦊",
            "role": "voter",
            "joinedAt": "…"
        },
        {
            "userId": "66f1d7…",
            "emoji": "🐼",
            "role": "observer",
            "joinedAt": "…"
        }
    ],
    "round": {
        "number": 3,
        "title": "PROJ-123",
        "status": "voting",
        "votes": { "66f1c2…": "8" },
        "startedAt": "…"
    },
    "rounds": [{ "number": 1, "status": "revealed", "votes": {}, "…": "…" }]
}
```

The current round is the field `round`, and `rounds` holds the finished rounds for the history. The migration `20261016120000-add-poker-rooms-indexes.js` adds a unique index on `token` and the indexes of the two lists. Both list indexes end with `lastActivityAt: -1, _id: -1`, the sort of `findPage`, so MongoDB reads a page from the index without a sort in memory.

A change names the round the user saw, never the round of a fresh load. Every round button carries it in its value: `vote` holds `{ round, card }`, `reveal` and `askTitle` hold the round, and `startRound` holds `{ round, repeat }`. `askTitle` keeps the round in the scene state as `titleRound` until the title arrives, because typing takes seconds and the round can change in between.

**Walk-through.** Two participants press `➡️ Next round` on round 3 at the same time.

1. Each press loads the room at version 17 and calls `PokerRoomsService.startRound` with round number 3 from its button.
2. `startPokerRound` finds round 3 revealed in the loaded room and returns the new `rounds` and round 4. A revote copies the title of the loaded round.
3. `PokerRoomsRepository.save` writes the fields with the filter `version: 17` and increments `version`. The first write matches.
4. The second write matches nothing. The service reads the room again, `startPokerRound` finds round 4 and returns `null`. The service returns `null` and emits nothing, and the press only redraws the screen of the user.

A title sent for round 3 after round 4 started returns `null` in the same way, and so does a press on a message that the redraw has not reached yet.

Every change expects an open room and the user among its participants; `PokerRoomsService` checks both before it calls the function of the change:

| Change      | Function                 | Expects                                          | Writes                                                                      |
| ----------- | ------------------------ | ------------------------------------------------ | --------------------------------------------------------------------------- |
| Vote        | `votePokerRound`         | the round of the button is `voting`, a voter     | the card in `round.votes`, or no vote for the same card                     |
| Reveal      | `revealPokerRound`       | the round of the button is `voting`              | `round.status: "revealed"`, `round.revealedAt`                              |
| Next round  | `startPokerRound`        | the round of the button is `revealed`            | `round` appended to `rounds`, a new `round`                                 |
| Round title | `renamePokerRound`       | the round of the button is the current one       | `round.title`, or none                                                      |
| Auto reveal | none                     | nothing more                                     | `autoReveal`                                                                |
| Role        | `changePokerRole`        | the other user is a participant                  | the `role`; for an observer, no vote in a `voting` round                    |
| Remove      | `removePokerParticipant` | the other user is a participant, not the creator | the participant moved to `removedParticipants`, no vote in a `voting` round |
| Close       | none                     | `update PokerRoom`                               | `closedAt`                                                                  |

Before the write, the service runs `revealPokerRoundIfDue` on the changed room and adds the reveal to the same write, see [Who counts in a round](#who-counts-in-a-round). Every write also sets `lastActivityAt` and `updatedAt` and increments `version`.

**Edge cases.**

- A vote with a card that is not in the deck throws: the value comes from a button that the scene drew from the same deck.
- The service decides first on the room that the caller loaded. Only a room that the service read itself can refuse a change: when the caller's room refuses it, the service reads the room once more and decides again.
- A conflict means that another change was written between the read and the write, so presses that start at the same moment need at most as many attempts as there are presses. After 20 attempts the service throws.
- The service checks `access.assert(actor, "use", subject("PokerRoom", room))` on the room of every attempt; membership is a business rule, so it is a plain check next to it.

## Joining a room

**Problem.** Two users can open the link at the same moment, and both must get different emojis while the pool has a free one. One user can open the link twice. A room also has a limit of participants, and two users who race for its last place must not both get it.

**Idea.** The join is a change of the room like any other, see [A room document](#a-room-document). The service checks the place and picks the emoji on the room it read, and writes the participant only while the `version` is the same. On a conflict it reads the room again.

**Walk-through.**

1. The deep link `poker` calls `PokerRoomsService.join` with the token. The guard of the link is `use PokerRoom`, so a user without a poker grant gets the `/start` answer.
2. The service loads the room by token. No room gives `notFound`; a user who is already a participant gets `alreadyJoined`; a [closed room](#closed-rooms) gives `closed`; a room with as many participants as the setting `poker.maxParticipants` gives `full`.
3. It picks a random emoji that no participant has, from a pool of 40 in `poker-participant-emojis.ts`.
4. It writes `participants` with the new participant through `PokerRoomsRepository.save`. A match gives `joined` and emits `poker.roomChanged`.
5. A conflict goes back to step 2. After 20 attempts the service throws.

`poker.maxParticipants` is 40 by default, from 2 to 100, and an admin changes it in `/settings`, see [Settings](../settings/README.md). Before the setting a room had no limit, so the deploy that added it refuses the 41st user of a room. A lower limit does not remove anybody: the participants stay, and only a new user gets `This room is full.` Only a limit above 40 lets all 40 emojis be taken; then `pickPokerParticipantEmoji` picks any emoji, so the room repeats emojis instead of refusing a user. The handler starts the `pokerRoom` scene for `joined` and `alreadyJoined`, and checks nothing after `sceneEngine.start`, because the engine already answers a refusal of a blocking scene.

## Who counts in a round

**Problem.** The vote counter of `👁 Reveal · 2/3` and auto reveal wait for every participant. A participant who opened the link and left the meeting would block both forever, and so would a product owner or a scrum master who only watches. A team also often reveals when most of it voted, without waiting for the last estimate.

**Idea.** Only active participants count: voters who are not idle. An observer says so with one button, and anybody can switch another participant. A voter who stops voting becomes idle by itself. Auto reveal waits for every active participant except a number that the participants choose, so the setting follows joins, observers and idle participants without a new press.

**Data.**

- `role` of a participant is `"voter"` or `"observer"`; a new participant is a voter. Any participant changes any role through `PokerRoomsService.changeRole`. An observer has no cards, and `votePokerRound` refuses an observer, so a press that raced the change stores nothing.
- Idle is computed from the document and never stored. A voter is idle after no vote in the last two revealed rounds that started after the join. `isPokerParticipantIdle` in `poker-room-entity.ts` decides it, and `listActivePokerParticipants` drops observers and idle voters.
- `autoReveal` is `null` for off or `{ "missingVotes": N }`, where `0` means everyone. `readPokerAutoRevealTarget` turns it into the votes that reveal the round: the active participants minus `N`, at least 1. A room starts with `{ "missingVotes": 0 }` or `null` from the form.

The migration `20261110120000-add-poker-rooms-missing-votes-and-roles.js` turned the earlier `autoReveal: true` into `{ "missingVotes": 0 }` and `false` into `null`, and gave every participant `role: "voter"`.

**Walk-through of an idle voter.**

1. A participant joins during round 1. Round 1 does not count, because it started before the join.
2. The participant skips rounds 2 and 3. Both are revealed, so the participant gets `💤` and leaves the counter of `👁 Reveal`.
3. A vote in round 4 makes the participant active again at once: a voter with a vote in the current round is never idle.

With auto reveal, the round reveals when the active participants with a vote reach the target. The service checks it with `revealPokerRoundIfDue` on the room as every change leaves it, and writes the reveal together with the change, see [A room document](#a-room-document). So the last vote reveals the round, and so does a role change that makes the last voter without a vote an observer, or a lower target that is already reached. No change can skip the check. The check also never reads votes that another change removed: a write on an outdated room matches nothing, and the change decides again.

**Changing auto reveal.** The `⚡ Auto reveal` screen steps the target with `stepPokerAutoReveal`, and the text shows both forms, such as `everyone but 1 (3 of 4 votes)`:

1. A room of four active participants starts with everyone. `➖` sets `missingVotes: 1`, a target of 3.
2. `➖` again sets 2, then 3, a target of 1. `➖` on a target of 1 sets off, and `➖` on off keeps it.
3. `➕` goes the other way: from off to a target of 1, and from a target of 3 to everyone.

Each button carries the value it sets, not a step, so two participants who press `➕` at the same time set the same value. A role button carries the role it sets in the same way.

**Edge cases.**

- Switching a voter to observer while the round is open drops the vote, so the vote of somebody who does not count never decides the round. A revealed round keeps every vote, because the history shows it.
- When `missingVotes` is not below the active participants, the target stays at 1 instead of 0: the first vote reveals the round.
- When every participant is idle or an observer, the target is 1 as well, and the first vote reveals the round. Two revealed rounds without votes make everybody idle.

## Leaving a room

**Problem.** A room had no way out. A user who joined the wrong room stayed in its list of participants, and the room stayed in the `/poker` of that user. Taking a participant out must not rewrite the history: the rounds keep the votes of that participant.

**Idea.** Any participant removes any other one, and leaves the room in the same way; only the creator stays. The participant moves from `participants` to `removedParticipants`. So every count and every list reads `participants` as before, and the room still knows the name and the emoji for the history.

**Data.** `removedParticipants` is an optional array of the same participant records, in the order of the removals. A room without a removal has no such field. `listKnownPokerParticipants` in `poker-room-entity.ts` joins both arrays for the labels.

**Walk-through.** A participant removes another one.

1. `👥 Participants` opens the list, and a press on a participant opens the card: the label, the role, and `💤 Idle` with its reason for an idle voter.
2. `🚫 Remove` is a button with `confirm: true`, so the second press on `🚫 Sure?` calls `PokerRoomsService.removeParticipant`.
3. `removePokerParticipant` moves the participant to `removedParticipants` and drops the vote of a `voting` round. The write is a change like any other, see [A room document](#a-room-document), so a removal of the last voter without a vote reveals the round.
4. The service emits `poker.roomChanged` with the removed user among `userIds`, so the `/poker` list of that user redraws without the room.
5. The room scene of the removed user redraws too. `PokerRoomsService.find` gives nothing, because the user has no `read PokerRoom` any more, and `PokerRoomsService.isRemoved` tells the removal from a missing room. The message turns into `You were removed from this room. Open its link to join again.` with `✖️ Hide`.

**Edge cases.**

- The creator cannot be removed and cannot leave: `removePokerParticipant` refuses `createdBy`, and the card of the creator has no such button. The creator closes the room instead.
- On the own card the button reads `🚪 Leave`. After the second press the scene ends with `scene.end({ messages: "delete" })`, so the room message leaves the chat.
- A removed user joins again by the link. `addPokerParticipant` drops the record from `removedParticipants`, and the user gets a new emoji and a new `joinedAt`.
- A card of a participant who was removed in the meantime shows `This participant is no longer in the room.` and `‹ Back`.

## Closed rooms

**Problem.** Without an end, the list of `/poker` grows forever and an old link keeps working.

**Idea.** A room is closed when its creator set `closedAt`, or one day (`pokerRoomIdleMilliseconds`) after its last change, through `lastActivityAt`. The idle part is computed, never stored, so no job closes rooms. `readPokerRoomStatus` computes the status in code, and `statusFilter` in the repository builds the same condition for MongoDB.

**Walk-through.** The creator presses `🔒 Close`.

1. `close` is a button with `confirm: true`, so the first press only marks it in the scene record, and the button turns into `🔒 Sure?`. Any other button of the room and any move cancel it.
2. The second press calls `PokerRoomsService.close`. It checks `update PokerRoom` on the loaded room, then writes `closedAt` like any other change, see [A room document](#a-room-document).
3. The service emits `poker.roomChanged`, and the screen of every participant redraws as the history of a closed room.

**Edge cases.**

- Every change expects an open room, so nobody can vote in a closed room.
- A closed room leaves the open list of every participant and moves to `🗄 Closed rooms` of its creator.
- The `pokerRoom` scene of a closed room shows only the history on any screen, without cards and without a back button. Its page buttons replace the current screen with the history, so the pages work from the round and the menu too. `✖️ Hide` ends the scene of that user with `scene.end({ messages: "delete" })`, so the message leaves the chat; opening the room again from `🗄 Closed rooms` brings it back.
- The link of a closed room answers `This room is closed.` to a new user. A participant who opens it gets the history.
- The `pokerRoom` scene has a TTL of one day as well, so its record expires with an idle room.

## Updates for the participants

**Problem.** A vote of one participant must redraw the room message of every other participant, and a closed or new room must redraw their room lists. A handler may not write to the sessions of other users.

**Idea.** The room scene watches the topic `poker.room:<roomId>`, and the list scene watches `poker.rooms:<userId>` of its own user. Every change emits `poker.roomChanged` with the room id, the ids of the creator and the participants, and the kind of the change, and `poker-handlers.ts` publishes the room topic and the list topic of each of them. The engine redraws the screen of every scene that watches one of them, see [Updates for other users](../telegram/README.md#updates-for-other-users). A redraw whose content did not change costs no API call, so a vote reads the list from MongoDB but does not edit it.

**Data.** The scene keeps only the user's view; the votes and the participants stay in MongoDB. The state holds the room and the round that waits for its title, and the record holds the screen: `round`, `menu` or `autoReveal`, `participants` or `history` with its page, or `participant` with the user id.

```json
{
    "state": { "roomId": "6710a3…", "titleRound": null },
    "screen": { "name": "history", "params": { "page": 1 } },
    "stack": [
        { "name": "round", "params": {} },
        { "name": "menu", "params": {} }
    ]
}
```

**Walk-through.** A participant votes in a room of three.

1. The button handler loads the room, calls `PokerRoomsService.vote`, and the update stores the vote.
2. The service emits `poker.roomChanged`. The handlers plugin publishes `poker.room:<roomId>`.
3. The engine of the voter draws the screen of the voter at the end of the update.
4. The background run takes the session lock of each of the other two participants, loads the room again and edits their screens.

**Edge cases.** The redraw reads the room under the session lock of each participant, after the lock is free. When several votes come while an edit waits for the rate limiter, the next redraw already shows all of them, and the redraws after it find the same content hash and call no API. So each chat gets at most about one edit per second, whatever the number of votes. Two large active rooms can still reach the limit of the bot, see `docs/backlog/background-delivery-waits-for-rate-limit-under-session-lock.md`.

**Metrics.** `poker-handlers.ts` counts every event in `poker_room_changes_total{change}`, such as `created`, `joined` or `voted`, and observes the number of participants after each join in `poker_room_participants`.

## The round summary

`summarizePokerRound` in `poker-round-summary.ts` turns the votes of a round into the numbers of the revealed screen and the history. It knows nothing about Telegram.

| Field          | Meaning                                                                                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `distribution` | Every card with votes, in the order of the deck, with its voters. A vote for a card that is not in the deck is skipped.                                           |
| `agreement`    | `none` without estimates, `unanimous` for one card, `close` for two neighbouring cards of the deck, `spread` otherwise.                                           |
| `outliers`     | For `spread` only: the voters of the lowest and the highest card. The screen asks them to discuss.                                                                |
| `median`       | The middle vote. For an even count, a numeric deck gives the mean of the two middle values, shown as a card when one matches; `tShirt` gives both, such as `M–L`. |
| `mode`         | The most frequent cards. Empty when two or more votes are all different.                                                                                          |
| `range`        | The lowest and the highest card.                                                                                                                                  |

The screen shows no mean. One outlier moves the mean far, and planning poker aims at agreement, not at an average: 3, 3, 3, 5 and 100 have a median of 3.

## Participant labels

`describePokerParticipants` in `poker-format.ts` builds the label of every participant for the viewer:

1. The name is `firstName`, else `@username`, else `Participant`, cut to 20 graphemes with `…`. `Intl.Segmenter` cuts by graphemes, so an emoji or a letter with a diacritic stays whole.
2. When two participants have the same name, the label adds `(@username)` of each one who has it.
3. The label of the viewer ends with `(you)`. The screen of each participant is drawn for that participant, so every user finds their own line.

A [removed participant](#leaving-a-room) keeps the label, so the history names every voter of a round.

A label is plain text. Names and titles come from users, so every screen passes them through `escapeTelegramHtml` before it puts them into the HTML of the message.

The emoji is unique in a room of up to 40 participants, so it tells them apart also when the names and the usernames do not. A room above 40, which needs a higher `poker.maxParticipants`, repeats emojis, see [Joining a room](#joining-a-room).

## Files

| File                                                                      | Owns                                                                                                         | Section                                                       |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `poker-room-entity.ts`                                                    | `PokerRoomEntity`, `PokerSubjects`, the room status, roles, idle participants, auto reveal                   | [A room document](#a-room-document)                           |
| `poker-room-transitions.ts`                                               | The changes of a room as pure functions                                                                      | [A room document](#a-room-document)                           |
| `poker-decks.ts`                                                          | The decks                                                                                                    | [Using the bot](#using-the-bot)                               |
| `poker-rooms-repository.ts`                                               | The `pokerRooms` collection and the save by `version`                                                        | [A room document](#a-room-document)                           |
| `poker-rooms-service.ts`                                                  | Create, join, vote, reveal, rounds, round titles, auto reveal, roles, removals, lists; the participant limit | [Joining a room](#joining-a-room)                             |
| `poker-participant-emojis.ts`                                             | The emoji pool                                                                                               | [Joining a room](#joining-a-room)                             |
| `poker-round-summary.ts`                                                  | `summarizePokerRound`                                                                                        | [The round summary](#the-round-summary)                       |
| `poker-handlers.ts`                                                       | The grants, `/poker`, the `poker` deep link, the scenes, the event subscription                              | [Using the bot](#using-the-bot)                               |
| `poker-scene.ts`, `poker-list-screen.ts`, `poker-form-screen.ts`          | The `poker` scene: the room lists and the form                                                               | [Using the bot](#using-the-bot)                               |
| `poker-room-scene.ts`, `poker-round-screen.ts`, `poker-history-screen.ts` | The `pokerRoom` scene: voting, the revealed round, the history                                               | [Updates for the participants](#updates-for-the-participants) |
| `poker-participants-screen.ts`                                            | The list of the participants and the card of one                                                             | [Leaving a room](#leaving-a-room)                             |
| `poker-format.ts`                                                         | HTML message parts, participant labels, the texts of a summary                                               | [Participant labels](#participant-labels)                     |
| `poker-schemas.ts`, `poker-events.ts`, `poker-locales.ts`                 | Scene states and button values, `poker.roomChanged`, texts                                                   |                                                               |
