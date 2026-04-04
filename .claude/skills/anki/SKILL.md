---
name: anki
description: >
  Create, browse, edit, and manage Anki flashcards and decks via AnkiConnect.
  Use when the user wants to study material, create flashcards, review existing
  decks, or manage their Anki collection. Applies evidence-based flashcard
  science automatically.
argument-hint: "[text, file path, or deck name]"
allowed-tools: Bash(curl *) Read
---

# Anki Skill

Manage Anki flashcards and decks through AnkiConnect's REST API. This skill applies evidence-based flashcard science to every card it creates.

## Prerequisites

- Anki desktop must be running
- AnkiConnect plugin installed (Tools > Add-ons > Get Add-ons > code `2055492159`)
- AnkiConnect listens on `http://localhost:8765`

## AnkiConnect Communication

All API calls use this pattern:

```bash
curl -s localhost:8765 -X POST -d '{"action":"<action>","version":6,"params":{...}}'
```

Every response has `{"result": ..., "error": ...}`. Check `error` first — if non-null, the operation failed.

### Health Check

Before any operation, verify AnkiConnect is reachable:

```bash
curl -s localhost:8765 -X POST -d '{"action":"version","version":6}'
```

If this fails, tell the user: "Anki desktop needs to be open with AnkiConnect installed (add-on code 2055492159). Start Anki and try again."

## Entry Points

Determine the mode from how the user invokes the skill:

| Invocation | Mode |
|------------|------|
| `/anki` | Ask what they want to do |
| `/anki <text or topic>` | Card creation from that material |
| `/anki review <deck>` | Browse existing cards in that deck |
| `/anki add <deck>` | Create new cards targeting that deck |

## Workflows

### Card Creation Session

This is the primary workflow. Read `reference/card-science.md` before generating any cards.

1. **Health check** — verify AnkiConnect is reachable
2. **Determine target deck** — ask user or infer from arguments
   - Use hierarchical naming: `Parent::Child::Grandchild`
   - If deck doesn't exist, offer to create it (including parent decks)
3. **Ingest source material** — read file, accept pasted text, or build from conversation
4. **Determine note type** — check what models exist in Anki:
   ```bash
   curl -s localhost:8765 -X POST -d '{"action":"modelNames","version":6}'
   ```
   Use the user's existing note types when possible. Default to `Basic`, `Basic (and reversed card)`, or `Cloze` as appropriate.
5. **Get model fields** — before creating notes, check the field names:
   ```bash
   curl -s localhost:8765 -X POST -d '{"action":"modelFieldNames","version":6,"params":{"modelName":"Basic"}}'
   ```
6. **Generate candidate cards** — apply the 7 Laws from card-science.md. Produce 5-10 cards per batch.
7. **Present cards for review** — display clearly:
   ```
   Card 1 [Basic] — Deck: Python::Data Structures
   Q: What is the time complexity of Python dict lookup?
   A: O(1) average case — dict uses a hash table internally
   Tags: python, data-structures, complexity

   Card 2 [Cloze] — Deck: Python::Data Structures
   {{c1::Hash collisions}} cause dict lookup to degrade to O(n) in the worst case
   Tags: python, data-structures, complexity
   ```
8. **Process user feedback** — accept these response patterns:
   - "accept all" / "looks good" / "send them" → add all cards
   - "reject 3" / "drop 3 and 5" → remove specific cards
   - "edit 2: change question to ..." → modify before adding
   - Per-card feedback in any natural format
9. **Push approved cards to Anki**:
   ```bash
   curl -s localhost:8765 -X POST -d '{
     "action": "addNote",
     "version": 6,
     "params": {
       "note": {
         "deckName": "Python::Data Structures",
         "modelName": "Basic",
         "fields": {"Front": "...", "Back": "..."},
         "tags": ["python", "data-structures"]
       }
     }
   }'
   ```
   For bulk adds, use `addNotes` with an array.
10. **Report results** — "Added 8 cards to Python::Data Structures. 1 duplicate skipped."
11. **Continue or finish** — "More cards from this material, or done?"

### Deck Management

- **List decks**: `deckNames`
- **Create deck**: `createDeck` with params `{"deck": "Parent::Child"}`
  - AnkiConnect auto-creates parent decks
- **Delete deck**: `deleteDecks` with params `{"decks": ["name"], "cardsToo": true}`
  - ALWAYS confirm with user before deleting
- **Move cards**: `changeDeck` with params `{"cards": [id,...], "deck": "target"}`

### Browse & Search

- **Find notes**: `findNotes` with query params (uses Anki's search syntax)
  - `"deck:Python"` — all notes in deck
  - `"tag:algorithms"` — by tag
  - `"front:*hash*"` — by content
- **Get note details**: `notesInfo` with array of note IDs
- **Find cards**: `findCards` with query, then `cardsInfo` for details
- Present results in a readable table format

### Edit & Maintain

- **Update fields**: `updateNoteFields` with note ID and new field values
- **Add/remove tags**: `addTags` / `removeTags` with note IDs and space-separated tags
- **Suspend/unsuspend**: `suspend` / `unsuspend` with card IDs
- When editing, show the current card content first, then apply changes

### Media

Read `reference/card-templates.md` for media formatting details.

- **Store media**: `storeMediaFile` with filename and base64-encoded data
- **Reference in cards**:
  - Images: `<img src="filename.jpg">`
  - Audio: `[sound:filename.mp3]`
- Media filenames must be unique across the collection

## Error Handling

| Error | Response |
|-------|----------|
| Connection refused | "Anki desktop needs to be running with AnkiConnect installed." |
| Deck not found | "Deck 'X' doesn't exist. Create it?" |
| Duplicate note | Report which cards were skipped, continue with the rest |
| Model not found | List available models, ask user to pick one |
| Empty fields | Don't send — fix the card first |

## Quality Rules (Summary)

When generating cards, always apply these rules. Full details in `reference/card-science.md`:

1. **Understand First** — parse the material fully before creating cards
2. **One Atom Per Card** — one fact, one concept, one connection
3. **No Orphans** — every card connects to something the user cares about
4. **Precise Cues** — one unambiguous answer per card
5. **No Enumerations** — break lists into individual cards
6. **Context-Free** — each card stands alone, use topic prefixes
7. **Cloze When Possible** — prefer cloze for factual knowledge

Self-review every card against these rules before presenting to the user.
