# Poker

This directory is planning poker in the bot. A user with the right grant creates a room, shares its link, and the participants vote on rounds with cards. Every participant sees the room as one message that changes when anybody votes, reveals the cards or starts a round. The domain registers its own grants, command, deep link and scenes; no other domain imports it.

- [Constraints](#constraints)
- [Using the bot](#using-the-bot)
- [A room document](#a-room-document)
- [Joining a room](#joining-a-room)
- [Idle participants and auto reveal](#idle-participants-and-auto-reveal)
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

| Grant          | Gives                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| `poker.join`   | `/poker`, the room links, voting, revealing, new rounds, round titles, and the list of the user's rooms |
| `poker.create` | Everything of `poker.join`, the room form, closing the user's own rooms, and the rooms they closed      |

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
2. `➕ New room` opens the form. Its buttons `🃏 Deck`, `✏️ Title` and `⚡ Auto reveal` carry no values: the text of the form shows them. The form holds the deck, `fibonacciShort` by default, an optional title of at most 64 characters (a room without one shows its creation time, such as `31.12 19:15`, in the time zone of the viewer), and auto reveal, on by default. `✅ Create` creates the room and hands the list message over to its `pokerRoom` scene, so the list message becomes the room. A room button of the list opens a running room the same way. `/poker` shows the list again.
3. Another user opens the room link, `https://t.me/<bot>?start=poker_<token>`, and joins. `📋 Copy link` stands under the main action of the room, in one row with `⋯ More`, and copies this link to the clipboard of the participant through `copy_text`, so the participant pastes it into any chat.
4. A participant presses a card to vote and presses the same card again to take the vote back. The cards stand in even rows of at most six, so the six cards of `fibonacciShort` fit one row and the 11 cards of `fibonacci` take two. The own card is blue, without a mark in its text. The others see `✅` for a vote, `⏳` for a wait, and `💤` for an idle participant, never the card.
5. Any participant presses `👁 Reveal · 2/3`, which counts the votes against the active participants and turns green when everyone voted. With auto reveal the button reads `⚡ Reveal · 2/3`; the message text says nothing about it. The message shows the cards and the [round summary](#the-round-summary). `🔁 Revote` starts a round with the same title; `➡️ Next round`, blue, starts a round without a title.
6. `⋯ More` switches the keyboard of the same message to a menu of the viewer only: `✏️ Round title` and `📜 History`, then `‹ Back` with `🔒 Close` beside it for the creator. `✏️ Round title` returns to the round and asks for the title of the current round, at most 100 characters; `/skip` clears it. `📜 History` shows the revealed rounds that have votes, newest first, at most five on a page and fewer when their text does not fit into one message; its `‹ Back` returns to the menu. Each round is a bold line with its number, title, agreement and median, then one line per card with its voters.

The colours come from the `style` field of an inline button: `primary`, `success` and `danger`. A client without it shows plain buttons, and then the own card does not stand out.

The creator closes a room with the red `🔒 Close` and a second press on `🔒 Sure?`; otherwise the room [closes by itself](#closed-rooms). A room has no leave button: a participant who stops voting becomes [idle](#idle-participants-and-auto-reveal).

The decks are in `poker-decks.ts`. A deck has no `?` or `☕` card: every card is an estimate.

| Deck                | Cards                                |
| ------------------- | ------------------------------------ |
| `fibonacciShort`    | 1, 2, 3, 5, 8, 13                    |
| `fibonacciModified` | 0, ½, 1, 2, 3, 5, 8, 13, 20, 40, 100 |
| `fibonacci`         | 0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89 |
| `powersOfTwo`       | 0, 1, 2, 4, 8, 16, 32, 64            |
| `tShirt`            | XS, S, M, L, XL, XXL                 |

## A room document

**Problem.** Several participants press buttons at the same time, on different pods. When the service reads a room, changes it in memory and writes it back, a second press overwrites the first one. Two presses of `➡️ Next round` must not start two rounds.

**Idea.** One document holds the whole room, and every change is one `findOneAndUpdate` whose filter states what the change expects: the round number, the round status, and that the user is a participant of an open room. A press that comes too late matches nothing and changes nothing.

**Data.** One document per room in `pokerRooms`:

```json
{
    "_id": "6710a3…",
    "token": "2V0ICkuAaR3tX2xuOiiHow",
    "createdBy": "66f1c2…",
    "title": "Sprint 42",
    "deck": "fibonacciShort",
    "autoReveal": false,
    "lastActivityAt": "2026-10-16T12:00:00Z",
    "participants": [
        { "userId": "66f1c2…", "emoji": "🦊", "joinedAt": "…" },
        { "userId": "66f1d7…", "emoji": "🐼", "joinedAt": "…" }
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

The current round is the field `round`, not the last item of `rounds`, so every filter can name it directly. `rounds` holds the finished rounds for the history. The migration `20261016120000-add-poker-rooms-indexes.js` adds a unique index on `token` and the indexes of the two lists. Both list indexes end with `lastActivityAt: -1, _id: -1`, the sort of `findPage`, so MongoDB reads a page from the index without a sort in memory.

The round number in the filter is the round the user saw, never the round of a fresh load. Every round button carries it in its value: `vote` holds `{ round, card }`, `reveal` and `askTitle` hold the round, and `startRound` holds `{ round, repeat }`. `askTitle` keeps the round in the scene state as `titleRound` until the title arrives, because typing takes seconds and the round can change in between.

**Walk-through.** Two participants press `➡️ Next round` on round 3 at the same time.

1. Each press loads the room and calls `PokerRoomsService.startRound` with round number 3 from its button.
2. `PokerRoomsRepository.startRound` runs an update pipeline with the filter `round.number: 3`, `round.status: "revealed"`, the user in `participants`, and an open room.
3. The first update matches. Its pipeline appends `$round` to `rounds` and sets a new `round` with number 4, so the round that moves into the history is the stored one, with its last title. A revote copies `$round.title` inside the same pipeline, so a rename between the load and the update is not lost.
4. The second update finds `round.number: 4` and matches nothing. The service returns `null`, emits nothing, and the press only redraws the screen of the user.

A title sent for round 3 after round 4 started matches nothing in the same way, and so does a press on a message that the redraw has not reached yet.

The other changes follow the same pattern:

| Change      | Filter on the round                  | Update                                                     |
| ----------- | ------------------------------------ | ---------------------------------------------------------- |
| Vote        | `round.number`, `status: "voting"`   | `$set round.votes.<userId>`, or `$unset` for the same card |
| Reveal      | `round.number`, `status: "voting"`   | `$set round.status: "revealed"`, `round.revealedAt`        |
| Next round  | `round.number`, `status: "revealed"` | pipeline: append `round` to `rounds`, new `round`          |
| Round title | `round.number`                       | `$set` or `$unset round.title`                             |

Every change also sets `lastActivityAt` and increments `version`.

**Edge cases.** A vote with a card that is not in the deck throws: the value comes from a button that the scene drew from the same deck. A vote after the reveal, or by a user who is not a participant, returns `null`. The service checks `access.assert(actor, "use", subject("PokerRoom", room))` before every change; membership is a business rule, so it stays in the filter.

## Joining a room

**Problem.** Two users can open the link at the same moment, and both must get different emojis while the pool has a free one. One user can open the link twice. A room also has a limit of participants, and two users who race for its last place must not both get it.

**Idea.** The join is one `findOneAndUpdate` that pushes the participant only when the user is not in the room yet, the room has a free place and the chosen emoji is still free. On a miss the service reads the room again and tries another emoji.

**Walk-through.**

1. The deep link `poker` calls `PokerRoomsService.join` with the token. The guard of the link is `use PokerRoom`, so a user without a poker grant gets the `/start` answer.
2. The service loads the room by token. No room gives `notFound`; a user who is already a participant gets `alreadyJoined`; a [closed room](#closed-rooms) gives `closed`; a room with as many participants as the setting `poker.maxParticipants` gives `full`.
3. It picks a random emoji that no participant has, from a pool of 40 in `poker-participant-emojis.ts`.
4. The update filter requires an open room, `participants.userId` without the user, no element at the index `maxParticipants - 1` of `participants`, and `participants.emoji` without the emoji. A match gives `joined` and emits `poker.roomChanged`.
5. A miss goes back to step 2. After 41 attempts, one more than the pool, the service throws.

`poker.maxParticipants` is 40 by default, from 2 to 100, and an admin changes it in `/settings`, see [Settings](../settings/README.md). Before the setting a room had no limit, so the deploy that added it refuses the 41st user of a room. A lower limit does not remove anybody: the participants stay, and only a new user gets `This room is full.` Only a limit above 40 lets all 40 emojis be taken; then the service picks any emoji and drops the emoji condition, so the room repeats emojis instead of refusing a user. The handler starts the `pokerRoom` scene for `joined` and `alreadyJoined`, and checks nothing after `sceneEngine.start`, because the engine already answers a refusal of a blocking scene.

## Idle participants and auto reveal

**Problem.** The vote counter of `👁 Reveal · 2/3` and auto reveal wait for every participant. A participant who opened the link and left the meeting would block both forever, and so would an observer who never votes.

**Idea.** A participant who did not vote in the last two revealed rounds that started after the participant joined is idle. Idle is computed from the document and never stored. `isPokerParticipantIdle` in `poker-room-entity.ts` decides it.

**Walk-through.**

1. A participant joins during round 1. Round 1 does not count, because it started before the join.
2. The participant skips rounds 2 and 3. Both are revealed, so the participant gets `💤` and leaves the counter of `👁 Reveal`.
3. A vote in round 4 makes the participant active again at once: a participant with a vote in the current round is never idle.

With `autoReveal`, `PokerRoomsService.vote` reveals the round when every active participant has a vote. It calls the same reveal as the button, with the same filter, so two last votes at the same time reveal the round once.

## Closed rooms

**Problem.** Without an end, the list of `/poker` grows forever and an old link keeps working.

**Idea.** A room is closed when its creator set `closedAt`, or one day (`pokerRoomIdleMilliseconds`) after its last change, through `lastActivityAt`. The idle part is computed, never stored, so no job closes rooms. `readPokerRoomStatus` computes the status in code, and `statusFilter` in the repository builds the same condition for MongoDB.

**Walk-through.** The creator presses `🔒 Close`.

1. `close` is a button with `confirm: true`, so the first press only marks it in the scene record, and the button turns into `🔒 Sure?`. Any other button of the room and any move cancel it.
2. The second press calls `PokerRoomsService.close`. It checks `update PokerRoom` on the loaded room, then `PokerRoomsRepository.close` sets `closedAt` with the filter `createdBy` and an open room.
3. The service emits `poker.roomChanged`, and the screen of every participant redraws as the history of a closed room.

**Edge cases.**

- Every update filter requires an open room, so nobody can vote in a closed room.
- A closed room leaves the open list of every participant and moves to `🗄 Closed rooms` of its creator.
- The `pokerRoom` scene of a closed room shows only the history on any screen, without cards and without a back button. Its page buttons replace the current screen with the history, so the pages work from the round and the menu too. `✖️ Hide` ends the scene of that user with `scene.end({ messages: "delete" })`, so the message leaves the chat; opening the room again from `🗄 Closed rooms` brings it back.
- The link of a closed room answers `This room is closed.` to a new user. A participant who opens it gets the history.
- The `pokerRoom` scene has a TTL of one day as well, so its record expires with an idle room.

## Updates for the participants

**Problem.** A vote of one participant must redraw the room message of every other participant, and a closed or new room must redraw their room lists. A handler may not write to the sessions of other users.

**Idea.** The room scene watches the topic `poker.room:<roomId>`, and the list scene watches `poker.rooms:<userId>` of its own user. Every change emits `poker.roomChanged` with the room id, the ids of the creator and the participants, and the kind of the change, and `poker-handlers.ts` publishes the room topic and the list topic of each of them. The engine redraws the screen of every scene that watches one of them, see [Updates for other users](../telegram/README.md#updates-for-other-users). A redraw whose content did not change costs no API call, so a vote reads the list from MongoDB but does not edit it.

**Data.** The scene keeps only the user's view; the votes and the participants stay in MongoDB. The state holds the room and the round that waits for its title, and the record holds the screen: `round`, `menu` or `history` with its page.

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

A label is plain text. Names and titles come from users, so every screen passes them through `escapeTelegramHtml` before it puts them into the HTML of the message.

The emoji is unique in a room of up to 40 participants, so it tells them apart also when the names and the usernames do not. A room above 40, which needs a higher `poker.maxParticipants`, repeats emojis, see [Joining a room](#joining-a-room).

## Files

| File                                                                      | Owns                                                                            | Section                                                       |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `poker-room-entity.ts`                                                    | `PokerRoomEntity`, `PokerSubjects`, the room status, idle participants          | [A room document](#a-room-document)                           |
| `poker-decks.ts`                                                          | The decks                                                                       | [Using the bot](#using-the-bot)                               |
| `poker-rooms-repository.ts`                                               | The `pokerRooms` collection and its conditional updates                         | [A room document](#a-room-document)                           |
| `poker-rooms-service.ts`                                                  | Create, join, vote, reveal, rounds, round titles, lists; the participant limit  | [Joining a room](#joining-a-room)                             |
| `poker-participant-emojis.ts`                                             | The emoji pool                                                                  | [Joining a room](#joining-a-room)                             |
| `poker-round-summary.ts`                                                  | `summarizePokerRound`                                                           | [The round summary](#the-round-summary)                       |
| `poker-handlers.ts`                                                       | The grants, `/poker`, the `poker` deep link, the scenes, the event subscription | [Using the bot](#using-the-bot)                               |
| `poker-scene.ts`, `poker-list-screen.ts`, `poker-form-screen.ts`          | The `poker` scene: the room lists and the form                                  | [Using the bot](#using-the-bot)                               |
| `poker-room-scene.ts`, `poker-round-screen.ts`, `poker-history-screen.ts` | The `pokerRoom` scene: voting, the revealed round, the history                  | [Updates for the participants](#updates-for-the-participants) |
| `poker-format.ts`                                                         | HTML message parts, participant labels, the texts of a summary                  | [Participant labels](#participant-labels)                     |
| `poker-schemas.ts`, `poker-events.ts`, `poker-locales.ts`                 | Scene states and button values, `poker.roomChanged`, texts                      |                                                               |
