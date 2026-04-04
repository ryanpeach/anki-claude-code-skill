# anki-claude-code-skill

A Claude Code skill for creating and managing Anki flashcards via [AnkiConnect](https://github.com/FooSoft/anki-connect). Applies evidence-based flashcard science (Wozniak's 20 Rules, Matuschak's prompt-writing principles) to every card it generates.

## Setup

### 1. Install AnkiConnect

1. Open Anki desktop ([download](https://apps.ankiweb.net/))
2. Go to **Tools > Add-ons > Get Add-ons**
3. Enter code: `2055492159`
4. Restart Anki

### 2. Use the skill

Make sure Anki is running, then invoke the skill in Claude Code from this repo:

```
/anki                          # interactive — asks what you want to do
/anki <text or topic>          # generate cards from material
/anki review Python::Basics    # browse existing cards
/anki add Python::Algorithms   # add cards to a specific deck
```

## What it does

- **Creates flashcards** from any source material with automatic quality checks
- **Interactive review** — approve, edit, or reject cards before they're added
- **Full deck management** — create, list, delete, reorganize decks with hierarchical naming
- **Browse & search** — find cards by deck, tag, or content
- **Edit & maintain** — update cards, manage tags, suspend/unsuspend
- **Media support** — images and audio on cards
- **Syncs naturally** — cards go directly into your Anki desktop app via AnkiConnect

## How it works

The skill talks to Anki's REST API (AnkiConnect on `localhost:8765`) using `curl`. No Python packages, no CLI binary, no dependencies beyond Anki + AnkiConnect.

Cards are generated following evidence-based principles:

- **One atom per card** — each card tests exactly one thing
- **Precise cues** — every question has one unambiguous answer
- **Cloze-first** — cloze deletions for factual knowledge, basic Q&A for conceptual
- **Context-free** — every card stands alone with topic tags
- **No enumerations** — lists are broken into individual connected cards

## Skill structure

```
.claude/skills/anki/
├── SKILL.md                     # Workflow logic and entry points
└── reference/
    ├── ankiconnect-api.md       # Full AnkiConnect API reference
    ├── card-science.md          # Flashcard quality rules and principles
    └── card-templates.md        # HTML/CSS templates and media handling
```

## Requirements

- [Anki desktop](https://apps.ankiweb.net/) (running)
- [AnkiConnect](https://ankiweb.net/shared/info/2055492159) plugin installed
- [Claude Code](https://claude.ai/claude-code)

## License

MIT
