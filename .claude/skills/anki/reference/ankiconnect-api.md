# AnkiConnect API Reference

AnkiConnect exposes Anki's functionality via a REST API on `http://localhost:8765`. All requests are HTTP POST with JSON body.

## Request Format

```bash
curl -s localhost:8765 -X POST -d '{
  "action": "<action_name>",
  "version": 6,
  "params": { ... }
}'
```

Always use `"version": 6`.

## Response Format

```json
{"result": <value>, "error": <null or error string>}
```

Always check `error` first. If non-null, the operation failed.

---

## Connection & Status

### version
Check if AnkiConnect is running.
```bash
curl -s localhost:8765 -X POST -d '{"action":"version","version":6}'
```
Returns: `{"result": 6, "error": null}`

### sync
Trigger AnkiWeb sync.
```bash
curl -s localhost:8765 -X POST -d '{"action":"sync","version":6}'
```

---

## Deck Operations

### deckNames
List all deck names.
```bash
curl -s localhost:8765 -X POST -d '{"action":"deckNames","version":6}'
```
Returns: `{"result": ["Default", "Python::Basics", "Python::Advanced"], "error": null}`

### deckNamesAndIds
List deck names with their IDs.
```bash
curl -s localhost:8765 -X POST -d '{"action":"deckNamesAndIds","version":6}'
```
Returns: `{"result": {"Default": 1, "Python::Basics": 1234567890}, "error": null}`

### createDeck
Create a new deck. Parent decks are auto-created.
```bash
curl -s localhost:8765 -X POST -d '{
  "action": "createDeck",
  "version": 6,
  "params": {"deck": "Python::Data Structures::Trees"}
}'
```
Returns: deck ID

### deleteDecks
Delete decks and optionally their cards.
```bash
curl -s localhost:8765 -X POST -d '{
  "action": "deleteDecks",
  "version": 6,
  "params": {"decks": ["Python::Old"], "cardsToo": true}
}'
```

### changeDeck
Move cards to a different deck.
```bash
curl -s localhost:8765 -X POST -d '{
  "action": "changeDeck",
  "version": 6,
  "params": {"cards": [1502098034, 1502098035], "deck": "Python::Advanced"}
}'
```

### getDeckConfig
Get configuration for a deck.
```bash
curl -s localhost:8765 -X POST -d '{
  "action": "getDeckConfig",
  "version": 6,
  "params": {"deck": "Python::Basics"}
}'
```

---

## Model (Note Type) Operations

### modelNames
List all available note types.
```bash
curl -s localhost:8765 -X POST -d '{"action":"modelNames","version":6}'
```
Returns: `{"result": ["Basic", "Basic (and reversed card)", "Cloze"], "error": null}`

### modelFieldNames
Get field names for a note type.
```bash
curl -s localhost:8765 -X POST -d '{
  "action": "modelFieldNames",
  "version": 6,
  "params": {"modelName": "Basic"}
}'
```
Returns: `{"result": ["Front", "Back"], "error": null}`

**Common field names by model:**
- `Basic`: Front, Back
- `Basic (and reversed card)`: Front, Back
- `Cloze`: Text, Extra

### modelNamesAndIds
List note types with their IDs.
```bash
curl -s localhost:8765 -X POST -d '{"action":"modelNamesAndIds","version":6}'
```

### modelFieldsOnTemplates
Get which fields are used on which card templates.
```bash
curl -s localhost:8765 -X POST -d '{
  "action": "modelFieldsOnTemplates",
  "version": 6,
  "params": {"modelName": "Basic"}
}'
```

---

## Note Operations

### addNote
Add a single note. Returns note ID or null if duplicate.
```bash
curl -s localhost:8765 -X POST -d '{
  "action": "addNote",
  "version": 6,
  "params": {
    "note": {
      "deckName": "Python::Basics",
      "modelName": "Basic",
      "fields": {
        "Front": "What is a list comprehension in Python?",
        "Back": "A concise syntax for creating lists: <code>[expr for item in iterable if condition]</code>"
      },
      "tags": ["python", "syntax"],
      "options": {
        "allowDuplicate": false,
        "duplicateScope": "deck"
      }
    }
  }
}'
```

**Cloze note example:**
```bash
curl -s localhost:8765 -X POST -d '{
  "action": "addNote",
  "version": 6,
  "params": {
    "note": {
      "deckName": "Python::Basics",
      "modelName": "Cloze",
      "fields": {
        "Text": "In Python, {{c1::list comprehensions}} provide a concise way to create lists from iterables",
        "Extra": "Example: [x**2 for x in range(10)]"
      },
      "tags": ["python", "syntax"]
    }
  }
}'
```

**Reversed card example:**
```bash
curl -s localhost:8765 -X POST -d '{
  "action": "addNote",
  "version": 6,
  "params": {
    "note": {
      "deckName": "Python::Basics",
      "modelName": "Basic (and reversed card)",
      "fields": {
        "Front": "What is memoization?",
        "Back": "Caching the results of expensive function calls and returning the cached result for repeated inputs"
      },
      "tags": ["python", "optimization"]
    }
  }
}'
```

### addNotes
Add multiple notes at once. Returns array of note IDs (null for failures).
```bash
curl -s localhost:8765 -X POST -d '{
  "action": "addNotes",
  "version": 6,
  "params": {
    "notes": [
      {
        "deckName": "Python::Basics",
        "modelName": "Basic",
        "fields": {"Front": "Q1", "Back": "A1"},
        "tags": ["python"]
      },
      {
        "deckName": "Python::Basics",
        "modelName": "Basic",
        "fields": {"Front": "Q2", "Back": "A2"},
        "tags": ["python"]
      }
    ]
  }
}'
```

### canAddNotes
Check if notes can be added (useful for duplicate detection before bulk add).
```bash
curl -s localhost:8765 -X POST -d '{
  "action": "canAddNotes",
  "version": 6,
  "params": {
    "notes": [
      {"deckName": "Default", "modelName": "Basic", "fields": {"Front": "Q1", "Back": "A1"}}
    ]
  }
}'
```
Returns: `{"result": [true], "error": null}`

### findNotes
Search for notes using Anki's search syntax.
```bash
curl -s localhost:8765 -X POST -d '{
  "action": "findNotes",
  "version": 6,
  "params": {"query": "deck:Python tag:syntax"}
}'
```
Returns array of note IDs.

**Common search queries:**
- `deck:Python` — all notes in Python deck
- `deck:Python::Basics` — specific subdeck
- `tag:syntax` — by tag
- `"list comprehension"` — by content (searches all fields)
- `front:*hash*` — search specific field with wildcard
- `added:7` — added in last 7 days
- `is:due` — cards due for review
- `is:suspended` — suspended cards
- `-tag:easy` — notes NOT tagged "easy"
- `deck:Python (tag:syntax OR tag:functions)` — combined queries

### notesInfo
Get full details for notes.
```bash
curl -s localhost:8765 -X POST -d '{
  "action": "notesInfo",
  "version": 6,
  "params": {"notes": [1502098029]}
}'
```
Returns array of note objects with fields, tags, modelName, cards, etc.

### updateNoteFields
Update fields on an existing note.
```bash
curl -s localhost:8765 -X POST -d '{
  "action": "updateNoteFields",
  "version": 6,
  "params": {
    "note": {
      "id": 1502098029,
      "fields": {
        "Front": "Updated question text",
        "Back": "Updated answer text"
      }
    }
  }
}'
```

### deleteNotes
Delete notes by ID.
```bash
curl -s localhost:8765 -X POST -d '{
  "action": "deleteNotes",
  "version": 6,
  "params": {"notes": [1502098029, 1502098030]}
}'
```

---

## Tag Operations

### getTags
List all tags.
```bash
curl -s localhost:8765 -X POST -d '{"action":"getTags","version":6}'
```

### addTags
Add tags to notes.
```bash
curl -s localhost:8765 -X POST -d '{
  "action": "addTags",
  "version": 6,
  "params": {"notes": [1502098029], "tags": "python advanced"}
}'
```
Tags are space-separated in a single string.

### removeTags
Remove tags from notes.
```bash
curl -s localhost:8765 -X POST -d '{
  "action": "removeTags",
  "version": 6,
  "params": {"notes": [1502098029], "tags": "beginner"}
}'
```

---

## Card Operations

### findCards
Search for cards (similar to findNotes but returns card IDs).
```bash
curl -s localhost:8765 -X POST -d '{
  "action": "findCards",
  "version": 6,
  "params": {"query": "deck:Python is:due"}
}'
```

### cardsInfo
Get card details including intervals, due dates, ease.
```bash
curl -s localhost:8765 -X POST -d '{
  "action": "cardsInfo",
  "version": 6,
  "params": {"cards": [1498938915662]}
}'
```

### suspend / unsuspend
Temporarily disable/enable cards.
```bash
curl -s localhost:8765 -X POST -d '{
  "action": "suspend",
  "version": 6,
  "params": {"cards": [1498938915662]}
}'
```

### cardsToNotes
Get note IDs from card IDs.
```bash
curl -s localhost:8765 -X POST -d '{
  "action": "cardsToNotes",
  "version": 6,
  "params": {"cards": [1498938915662]}
}'
```

---

## Media Operations

### storeMediaFile
Upload a media file (image, audio) to Anki's media folder.

**From base64:**
```bash
curl -s localhost:8765 -X POST -d '{
  "action": "storeMediaFile",
  "version": 6,
  "params": {
    "filename": "diagram.png",
    "data": "<base64-encoded-data>"
  }
}'
```

**From file path:**
```bash
curl -s localhost:8765 -X POST -d '{
  "action": "storeMediaFile",
  "version": 6,
  "params": {
    "filename": "diagram.png",
    "path": "/absolute/path/to/diagram.png"
  }
}'
```

**From URL:**
```bash
curl -s localhost:8765 -X POST -d '{
  "action": "storeMediaFile",
  "version": 6,
  "params": {
    "filename": "diagram.png",
    "url": "https://example.com/diagram.png"
  }
}'
```

### retrieveMediaFile
Get a media file as base64.
```bash
curl -s localhost:8765 -X POST -d '{
  "action": "retrieveMediaFile",
  "version": 6,
  "params": {"filename": "diagram.png"}
}'
```

### deleteMediaFile
Remove a media file.
```bash
curl -s localhost:8765 -X POST -d '{
  "action": "deleteMediaFile",
  "version": 6,
  "params": {"filename": "diagram.png"}
}'
```

### Referencing Media in Cards

In card fields:
- Images: `<img src="diagram.png">`
- Audio: `[sound:pronunciation.mp3]`

Filenames must be unique across the entire Anki collection.

---

## Batch Operations

### multi
Execute multiple actions in a single request.
```bash
curl -s localhost:8765 -X POST -d '{
  "action": "multi",
  "version": 6,
  "params": {
    "actions": [
      {"action": "deckNames", "version": 6},
      {"action": "modelNames", "version": 6}
    ]
  }
}'
```

---

## GUI Operations

### guiBrowse
Open Anki's card browser with a search query.
```bash
curl -s localhost:8765 -X POST -d '{
  "action": "guiBrowse",
  "version": 6,
  "params": {"query": "deck:Python"}
}'
```

### guiDeckOverview
Navigate to deck overview screen.
```bash
curl -s localhost:8765 -X POST -d '{
  "action": "guiDeckOverview",
  "version": 6,
  "params": {"name": "Python::Basics"}
}'
```

---

## HTML Encoding in Fields

Card field values are HTML. Special characters must be encoded:
- `<` → `&lt;`
- `>` → `&gt;`
- `&` → `&amp;`

Use `<br>` for line breaks. Use `<code>` for inline code. Use `<pre>` for code blocks.

Example field with code:
```
"Front": "What does this Python code output?<br><pre><code>print([x**2 for x in range(3)])</code></pre>",
"Back": "<code>[0, 1, 4]</code>"
```
