---
name: dedupe
description: >
  Find and resolve duplicate flashcards in an Anki deck. Vector-indexes a deck
  with a Deno script, surfaces note pairs whose similarity is at or above a
  target threshold, then inspects each candidate to confirm true duplicates and
  recommend a fix. Use when the user wants to clean up, deduplicate, or audit an
  Anki deck for repeated cards.
argument-hint: "[deck name] [target similarity, e.g. 0.85]"
allowed-tools: Bash(deno run *) Bash(curl *) Read
---

# Dedupe Skill

Find duplicate (and near-duplicate) notes in an Anki deck. A Deno script does
the heavy lifting — pulling notes from AnkiConnect, vectorizing them, and
computing pairwise cosine similarity — and returns every pair scoring at or
above a **target** threshold. Claude then reads each surfaced pair and makes the
final judgment: true duplicate, overlapping-but-distinct, or unrelated.

The script is a *coarse filter*. It is deliberately generous: it errs toward
surfacing borderline pairs so nothing is missed, and leaves the semantic call to
Claude.

## Prerequisites

- **Anki desktop running** with the AnkiConnect add-on (code `2055492159`),
  listening on `http://localhost:8765`.
- **Deno installed** (`https://deno.land`) to run the indexing script. On first
  run Deno auto-downloads its dependencies — [Cliffy](https://cliffy.io) (arg
  parsing), [yanki-connect](https://github.com/kitschpatrol/yanki-connect)
  (AnkiConnect client), and the [Vercel AI SDK](https://www.npmjs.com/package/ai)
  with its provider packages — this needs network access once and is then cached.
- For a semantic method, one of:
  - **`ollama`** — [Ollama](https://ollama.com) running locally with an
    embedding model pulled (`ollama pull nomic-embed-text`). No API key.
  - **`openai`** — `OPENAI_API_KEY` in the environment.
  - **`openrouter`** — `OPENROUTER_API_KEY` in the environment.

## The Script

`scripts/dedupe.ts` (relative to this skill). Run it with:

```bash
deno run -A \
  .claude/skills/dedupe/scripts/dedupe.ts \
  --deck "<DeckName>" --target <0..1>
```

Key flags (`--help` for the full list):

| Flag | Meaning | Default |
|------|---------|---------|
| `--deck <name>` | Deck to scan (quoted). | — |
| `--query <query>` | Raw Anki search query, overrides `--deck`. | — |
| `--target <float>` | Similarity threshold in `[0,1]`. Report pairs `≥` this. | `0.80` |
| `--method <name>` | `tfidf` \| `ollama` \| `openai` \| `openrouter`. | `tfidf` |
| `--model <name>` | Embedding model (semantic methods). | per method |
| `--base-url <url>` | Override the provider base URL. | per method |
| `--api-key-env <var>` | Env var holding the API key. | per method |
| `--cache-file <path>` | Embedding cache file. | `~/.cache/anki-dedupe/…` |
| `--no-cache` | Disable the embedding cache. | off |
| `--top <int>` | Cap output to the N highest-scoring pairs. | all |
| `--json` | Emit JSON only. | off |

**Methods** — semantic embeddings go through the [Vercel AI SDK](https://www.npmjs.com/package/ai)
(`ai`), with a dedicated provider package per backend
([`ai-sdk-ollama`](https://github.com/jagreehal/ai-sdk-ollama),
[`@ai-sdk/openai`](https://www.npmjs.com/package/@ai-sdk/openai),
[`@openrouter/ai-sdk-provider`](https://www.npmjs.com/package/@openrouter/ai-sdk-provider)).
Each provider owns its own base URL and API-key handling:

- **`tfidf`** (default) — TF-IDF over word uni/bigrams, fully local, no API key,
  no model download. Excellent at catching reworded or near-identical cards.
  The right default for almost every deck.
- **`ollama`** — local semantic embeddings, no API key, nothing leaves the
  machine. Best privacy-preserving semantic option. Default model
  `nomic-embed-text`.
- **`openai`** — semantic embeddings via the OpenAI API. Default model
  `text-embedding-3-small`.
- **`openrouter`** — semantic embeddings via OpenRouter. Default model
  `openai/text-embedding-3-small`.

Use a semantic method (`ollama`/`openai`/`openrouter`) to catch *paraphrases*
that share few literal words (e.g. "What ends a cell's life?" vs. "Define
apoptosis"). Prefer `ollama` when the user cares about privacy or cost; the
hosted methods need a key.

Per-method defaults (base URL is the provider's own default; override with
`--base-url` / `--model` / `--api-key-env`, or the `<METHOD>_BASE_URL` env vars):

| Method | Key env | Default model |
|--------|---------|---------------|
| `ollama` | (none) | `nomic-embed-text` |
| `openai` | `OPENAI_API_KEY` | `text-embedding-3-small` |
| `openrouter` | `OPENROUTER_API_KEY` | `openai/text-embedding-3-small` |

**Caching.** Semantic embeddings are cached on disk (default
`~/.cache/anki-dedupe/embeddings.json`), keyed by a hash of `<method>:<model>`
plus each note's text. Re-running a deck only embeds notes that are new or
changed — so repeat audits are fast and (for paid APIs) nearly free. Cards whose
text is unchanged reuse their cached vector; edit a card and only it re-embeds.
Switching model or provider uses a separate cache namespace automatically. Pass
`--no-cache` to force a fresh embed of everything.

### Output

The script prints a human-readable report, then a machine-readable block:

```
JSON_RESULT_BEGIN
{"deck":"...","method":"tfidf","target":0.8,"noteCount":N,"pairCount":M,"pairs":[
  {"similarity":0.91,"a":{"noteId":...,"text":"..."},"b":{"noteId":...,"text":"..."}},
  ...
]}
JSON_RESULT_END
```

Progress logs go to **stderr**; parse the JSON between the markers on stdout.

## Choosing a Target

The target is the user's input. If they don't give one, default to **0.80** and
explain what it does. Rough guidance:

| Target | Catches | Trade-off |
|--------|---------|-----------|
| `0.90+` | Almost-identical cards. | High precision, may miss reworded dups. |
| `0.80` | Near-duplicates, reworded cards. | Balanced. Good default. |
| `0.65` | Loosely related cards. | Surfaces many pairs; more to inspect. |

Lower the target if the first run finds nothing; raise it if there's too much
noise to inspect.

## Workflow

1. **Health check** — confirm AnkiConnect is reachable:
   ```bash
   curl -s localhost:8765 -X POST -d '{"action":"version","version":6}'
   ```
   If it fails: "Anki desktop needs to be open with AnkiConnect installed
   (add-on code 2055492159). Start Anki and try again."

2. **Resolve inputs** — get the deck name and target from the arguments.
   - No deck given → list decks (`deckNames`) and ask which one.
   - No target given → use `0.80` and say so.
   - Confirm Deno is available; if not, point the user to `https://deno.land`.
   - Pick a method: default `tfidf`. Use `ollama`/`openai`/`openrouter` only if
     the user asks for semantic matching (paraphrase detection) and the
     corresponding backend is available (Ollama running, or the API key set).

3. **Run the indexer**:
   ```bash
   deno run -A \
     .claude/skills/dedupe/scripts/dedupe.ts \
     --deck "Spanish::Vocab" --target 0.8
   ```
   For semantic matching add `--method ollama` (or `openai` / `openrouter`).
   Parse the `JSON_RESULT` block. Progress and cache-hit logs go to stderr.

4. **Inspect each pair (the important step).** The script only surfaces
   *candidates*. For every pair, read both notes and classify:
   - **Duplicate** — same fact/prompt, redundant. Keeping both wastes reviews
     and causes interference.
   - **Reversible/complementary** — e.g. a term→definition card and its
     definition→term counterpart. Usually *intentional*, not a duplicate.
   - **Overlapping but distinct** — related topic, different atom. Keep both.
   - **Unrelated** — false positive from shared vocabulary. Ignore.

   A high score is evidence, not a verdict. Two cards can share wording yet test
   different things; two true duplicates can score modestly if worded
   differently. Judge on meaning, not the number. When a pair is genuinely
   ambiguous, show it and ask rather than guessing.

5. **Report** — list only the confirmed duplicates (and clearly-flagged
   "probable" ones), most-similar first. For each, show both cards with their
   note IDs and say *why* it's a duplicate and *which* you'd keep. Example:

   ```
   Duplicate (similarity 0.93)
     Keep   [note 1502098034]: What is the capital of France? → Paris
     Remove [note 1502098099]: France's capital city? → Paris
     Reason: identical fact, same prompt direction. The first is more precisely worded.
   ```

6. **Offer to resolve** — never delete without explicit confirmation. Present
   options per duplicate (or in bulk):
   - **Delete** the redundant note: `deleteNotes` with `{"notes":[id]}`.
   - **Suspend** instead of delete (reversible): `suspend` on the note's cards
     (get card IDs from `notesInfo` → `cards`).
   - **Merge** — copy any unique detail from one into the other with
     `updateNoteFields`, then delete the redundant one.
   - **Keep both** — user's call; skip it.

   Prefer **suspend** when the user is unsure — it's non-destructive and easy to
   undo. Only `deleteNotes` after clear confirmation.

## AnkiConnect Actions Used

All calls follow `curl -s localhost:8765 -X POST -d '{"action":...,"version":6,"params":{...}}'`
and return `{"result":...,"error":...}` — check `error` first.

| Need | Action |
|------|--------|
| List decks | `deckNames` |
| Full note content (fields, tags, card IDs) | `notesInfo` with `{"notes":[ids]}` |
| Delete a redundant note | `deleteNotes` with `{"notes":[id]}` |
| Non-destructive removal | `suspend` with `{"cards":[cardIds]}` |
| Merge detail into the kept note | `updateNoteFields` |
| Open a pair in Anki to eyeball | `guiBrowse` with `{"query":"nid:ID1 OR nid:ID2"}` |

See `../anki/reference/ankiconnect-api.md` for full request/response shapes.

## Error Handling

| Situation | Response |
|-----------|----------|
| AnkiConnect unreachable | "Start Anki with AnkiConnect (code 2055492159)." |
| Deno not installed | "This skill needs Deno — install from https://deno.land." |
| Deck has 0–1 notes | Nothing to compare; tell the user. |
| No pairs above target | "No duplicates at ≥ `<target>`. Lower the target to cast a wider net?" |
| `openai`/`openrouter`, no key | The script exits with which env var to set. Offer to fall back to `tfidf` (no key) or `ollama` (local). |
| `ollama` chosen, not running | The script reports the connection failure. Suggest `ollama serve` + `ollama pull nomic-embed-text`, or fall back to `tfidf`. |
| First `deno run` blocked offline | Deno's dependency download (Cliffy, yanki-connect, AI SDK) needs network once. For fully offline use, stick to `--method tfidf`. |

## Notes on Method

- **Scores are exact cosine similarity.** For `tfidf`, an inverted index only
  *generates* candidate pairs (those sharing a distinctive token) for speed, but
  every candidate is then scored with a full sparse cosine — the reported number
  is the true similarity, not an approximation. Semantic methods score every
  pair with a full dense cosine.
- **Text is normalized** before vectorizing: HTML tags stripped, cloze
  `{{c1::…}}` reduced to its answer text, `[sound:…]` and `<img>` refs removed,
  HTML entities decoded. So cards compare on meaning, not markup.
- **Built on the AI SDK.** The semantic methods use the Vercel AI SDK (`ai`) with
  a dedicated provider package per backend (`ai-sdk-ollama`, `@ai-sdk/openai`,
  `@openrouter/ai-sdk-provider`); each knows its own base URL and API-key env, so
  there is no hand-maintained endpoint table. Point any of them at a different
  host with `--base-url` / a different key source with `--api-key-env`.
- **Caching keeps repeat runs cheap.** Only new or edited notes are re-embedded;
  everything else is read from the on-disk cache. This matters most for paid
  APIs (`openai`/`openrouter`) — a re-audit after adding a few cards costs only
  those few embeddings.
- **Large decks:** `tfidf` scales to thousands of notes comfortably. The
  semantic methods are O(n²) in the scoring step and (for hosted APIs) cost per
  note — prefer them on focused decks or subsets (`--query`) rather than an
  entire collection. `ollama` is local, so only compute-bound.
