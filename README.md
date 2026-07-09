# anki-claude-code-skill

Claude Code skills for creating, managing, and deduplicating Anki flashcards via [AnkiConnect](https://github.com/FooSoft/anki-connect). Applies evidence-based flashcard science (Wozniak's 20 Rules, Matuschak's prompt-writing principles) to every card it generates.

Two skills ship here:

- **`anki`** — create, browse, edit, and manage cards and decks.
- **`dedupe`** — vector-index a deck and find duplicate cards above a similarity target.

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

/dedupe Python::Basics         # find duplicate cards in a deck
/dedupe Python::Basics 0.85    # find dupes at a similarity target of 0.85
```

The `dedupe` skill additionally needs [Deno](https://deno.land) installed to run its vector-indexing script.

## What it does

- **Creates flashcards** from any source material with automatic quality checks
- **Interactive review** — approve, edit, or reject cards before they're added
- **Full deck management** — create, list, delete, reorganize decks with hierarchical naming
- **Browse & search** — find cards by deck, tag, or content
- **Edit & maintain** — update cards, manage tags, suspend/unsuspend
- **Media support** — images and audio on cards
- **Syncs naturally** — cards go directly into your Anki desktop app via AnkiConnect

## Deduplicating a deck

The `dedupe` skill finds repeated cards. A [Deno](https://deno.land) script vector-indexes the deck, computes pairwise cosine similarity, and surfaces every note pair scoring at or above a **target** you choose (default `0.80`). Claude then reads each candidate pair and makes the final call — true duplicate, intentional reverse card, overlapping-but-distinct, or false positive — and offers to delete, suspend, or merge the redundant note (never without your confirmation).

- **Local by default** — TF-IDF vectorization runs entirely on your machine, no API key, no model download.
- **Vendor-agnostic semantic mode** — for paraphrases that share few literal words, switch to real embeddings via the [Vercel AI SDK](https://www.npmjs.com/package/ai). Pick your provider:
  - `--method ollama` — local, private, no key ([Ollama](https://ollama.com), default model `nomic-embed-text`)
  - `--method openai` — needs `OPENAI_API_KEY`
  - `--method openrouter` — needs `OPENROUTER_API_KEY`
  - or any other OpenAI-compatible endpoint via `--base-url` / `--api-key-env` / `--model`
- **Cached** — embeddings are cached on disk keyed by note text, so re-auditing a deck only embeds new or changed cards (fast, and nearly free on paid APIs). `--no-cache` to disable.
- **Markup-aware** — HTML, cloze `{{c1::…}}`, and media refs are stripped before comparison, so cards match on meaning.

```
/dedupe Spanish::Vocab 0.85          # local TF-IDF
# semantic, local via Ollama:
deno run -A .claude/skills/dedupe/scripts/dedupe.ts --deck Spanish::Vocab --method ollama --target 0.88
```

## How it works

The `anki` skill talks to Anki's REST API (AnkiConnect on `localhost:8765`) using `curl`. No Python packages, no CLI binary, no dependencies beyond Anki + AnkiConnect. The `dedupe` skill adds one dependency — Deno — to run its indexing script.

Cards are generated following evidence-based principles:

- **One atom per card** — each card tests exactly one thing
- **Precise cues** — every question has one unambiguous answer
- **Cloze-first** — cloze deletions for factual knowledge, basic Q&A for conceptual
- **Context-free** — every card stands alone with topic tags
- **No enumerations** — lists are broken into individual connected cards

## Skill structure

```
.claude/skills/
├── anki/
│   ├── SKILL.md                 # Workflow logic and entry points
│   └── reference/
│       ├── ankiconnect-api.md   # Full AnkiConnect API reference
│       ├── card-science.md      # Flashcard quality rules and principles
│       └── card-templates.md    # HTML/CSS templates and media handling
└── dedupe/
    ├── SKILL.md                 # Dedup workflow and inspection logic
    └── scripts/
        └── dedupe.ts            # Deno vector-index + similarity script
```

## Requirements

- [Anki desktop](https://apps.ankiweb.net/) (running)
- [AnkiConnect](https://ankiweb.net/shared/info/2055492159) plugin installed
- [Claude Code](https://claude.ai/claude-code)
- [Deno](https://deno.land) — only for the `dedupe` skill

## License

MIT
