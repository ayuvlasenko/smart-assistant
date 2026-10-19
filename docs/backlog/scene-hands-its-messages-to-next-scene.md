---
worth: later
where: apps/server/src/plugins/app/telegram/telegram-scene-engine.ts:360
added: 2026-10-16
---

# a scene cannot hand its messages to the next scene

When one scene ends and starts another, the new scene always sends new messages. The planning poker flow creates a room from the `/poker` list: the list message stays, and the room appears as a second message below it. Editing the list message into the room would keep the chat shorter.

The engine has no way to do it. The `messages` of a scene record keep `messageId`, `kind` and `hash` per position only for their own instance, and `end` releases or deletes them. A fix would be an option such as `sceneEngine.start(ctx, scene, state, { takeMessagesOf: current })` that moves the `messages` of the current instance into the new one with empty hashes, so the render edits them by position, then ends the current instance without touching those messages and forgets its buttons there.

The hard case is a scene with a `key`: the target instance can already run with its own messages, and the engine then needs a rule for two sets, such as falling back to new messages or deleting the old ones. A message at the same position must also keep one `kind`, since the engine never edits `media` into another kind.

Surfaced while designing the planning poker scenes. The value decision is open: it saves one message per created room. It becomes worth it when the extra message proves annoying in use, or when a second flow wants the same handover.
