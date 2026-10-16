---
worth: later
where: apps/server/src/plugins/app/telegram/telegram-scene-engine.ts:383
added: 2026-10-16
---

# a scene cannot hand its slot message to the next scene

When one scene ends and starts another, the new scene always sends a new message. The planning poker flow creates a room from the `/poker` list: the list message stays, and the room appears as a second message below it. Editing the list message into the room would keep the chat shorter.

The engine has no way to do it. A slot keeps `messageId`, `kind` and `hash` only in the record of its own instance, and `end` releases or deletes the slot messages; `slotMessageId` in `TelegramSceneUpdate` serves only the reuse of button ids. A fix would be an option such as `sceneEngine.start(ctx, scene, state, { takeSlotOf: current })` that moves the slot record of the current instance into the slot of the new one with an empty `hash`, so the render edits the message, then ends the current instance without touching that message and forgets its buttons there.

The hard case is a scene with a `key`: the target instance can already run with its own slot message, and the engine then needs a rule for two messages, such as falling back to a new message or deleting the old one. Both slots must also keep one `kind`, since the engine never edits `media` into another kind.

Surfaced while designing the planning poker scenes. The value decision is open: it saves one message per created room. It becomes worth it when the extra message proves annoying in use, or when a second flow wants the same handover.
