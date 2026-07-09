#!/usr/bin/env -S deno run -A
/**
 * dedupe.ts — Vector-index an Anki deck and surface near-duplicate note pairs.
 *
 * Pulls every note in a deck (or matching an Anki search query) from
 * AnkiConnect, builds a vector for each note, computes pairwise cosine
 * similarity, and prints every pair scoring at or above a target threshold.
 *
 * The script only *surfaces candidates* — it does not decide what is a
 * duplicate. That final judgment is left to Claude Code, which inspects the
 * emitted pairs semantically.
 *
 * Vectorization backends (--method):
 *   tfidf  (default) — TF-IDF over word uni/bigrams. Zero setup, fully local,
 *                      great at catching reworded / near-identical cards.
 *   ollama           — Local semantic embeddings via Ollama's OpenAI-compatible
 *                      endpoint (http://localhost:11434/v1). No API key needed.
 *   openai           — Semantic embeddings via the OpenAI API. Needs OPENAI_API_KEY.
 *   openrouter       — Semantic embeddings via OpenRouter. Needs OPENROUTER_API_KEY.
 *
 * The last three all speak the OpenAI /v1/embeddings protocol; they differ only
 * in default base URL, default model, and which env var holds the key. Override
 * any of it with --base-url / --model / --api-key-env.
 *
 * Usage:
 *   deno run -A dedupe.ts --deck "Spanish::Vocab" --target 0.8
 *   deno run -A dedupe.ts --query "deck:Spanish tag:verbs" --target 0.85
 *   deno run -A dedupe.ts --deck "Spanish" --method ollama --target 0.88
 *   deno run -A dedupe.ts --deck "Spanish" --method openrouter --model openai/text-embedding-3-small
 *
 * Flags:
 *   --deck <name>       Deck to scan (quoted). Shorthand for --query 'deck:"<name>"'.
 *   --query <query>     Raw Anki search query (overrides --deck).
 *   --target <float>    Similarity threshold in [0,1]. Default 0.80.
 *   --method <name>     tfidf | ollama | openai | openrouter. Default tfidf.
 *   --top <int>         Cap output to the N highest-scoring pairs.
 *   --max-snippet <n>   Chars of note text shown per side in text output. Default 160.
 *   --anki-url <url>    AnkiConnect endpoint. Default http://localhost:8765.
 *   --model <name>      Embedding model. Defaults per method (see below).
 *   --base-url <url>    Override the embeddings endpoint base (…/v1).
 *   --api-key-env <var> Env var to read the API key from. Default per method.
 *   --cache <path>      Embedding cache file. Default ~/.cache/anki-dedupe/embeddings.json.
 *   --no-cache          Disable the embedding cache (always re-embed).
 *   --json              Emit JSON only (for programmatic consumption by Claude).
 *   --help              Show this help.
 *
 * Caching: embedding vectors are cached on disk keyed by a hash of
 * "<method>:<model>" + note text, so re-running only embeds notes that are new
 * or changed. TF-IDF needs no cache (it is local and instant).
 *
 * Per-method defaults:
 *   ollama      base http://localhost:11434/v1   key (none)          model nomic-embed-text
 *   openai      base https://api.openai.com/v1   key OPENAI_API_KEY   model text-embedding-3-small
 *   openrouter  base https://openrouter.ai/api/v1 key OPENROUTER_API_KEY model openai/text-embedding-3-small
 *
 * Environment:
 *   OPENAI_API_KEY / OPENROUTER_API_KEY  API key for the chosen method.
 *   <method>_BASE_URL (e.g. OLLAMA_BASE_URL, OPENAI_BASE_URL, OPENROUTER_BASE_URL)
 *                      Override the base URL without a flag.
 */

import { embedMany } from "npm:ai@^7";
import { createOpenAICompatible } from "npm:@ai-sdk/openai-compatible@^3";

// ---------------------------------------------------------------------------
// Provider presets — the embedding methods all speak the OpenAI /v1/embeddings
// protocol and differ only in these three fields.
// ---------------------------------------------------------------------------

type Method = "tfidf" | "ollama" | "openai" | "openrouter";
type EmbedMethod = Exclude<Method, "tfidf">;

interface Preset {
  baseUrl: string;
  baseUrlEnv: string;
  keyEnv: string | null; // null ⇒ no API key required (Ollama)
  model: string;
}

const PRESETS: Record<EmbedMethod, Preset> = {
  ollama: {
    baseUrl: "http://localhost:11434/v1",
    baseUrlEnv: "OLLAMA_BASE_URL",
    keyEnv: null,
    model: "nomic-embed-text",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    baseUrlEnv: "OPENAI_BASE_URL",
    keyEnv: "OPENAI_API_KEY",
    model: "text-embedding-3-small",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    baseUrlEnv: "OPENROUTER_BASE_URL",
    keyEnv: "OPENROUTER_API_KEY",
    model: "openai/text-embedding-3-small",
  },
};

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface Args {
  deck?: string;
  query?: string;
  target: number;
  method: Method;
  top?: number;
  maxSnippet: number;
  ankiUrl: string;
  model?: string;      // undefined ⇒ use the method's preset default
  baseUrl?: string;    // undefined ⇒ preset default / env
  apiKeyEnv?: string;  // undefined ⇒ preset default
  cache: boolean;
  cachePath?: string;  // undefined ⇒ default path
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    target: 0.8,
    method: "tfidf",
    maxSnippet: 160,
    ankiUrl: "http://localhost:8765",
    cache: true,
    json: false,
  };
  const methods: Method[] = ["tfidf", "ollama", "openai", "openrouter"];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) die(`Missing value for ${arg}`);
      return v;
    };
    switch (arg) {
      case "--deck": a.deck = next(); break;
      case "--query": a.query = next(); break;
      case "--target": a.target = Number(next()); break;
      case "--method": {
        const m = next();
        if (!methods.includes(m as Method)) {
          die(`Unknown --method: ${m}. Use one of: ${methods.join(", ")}.`);
        }
        a.method = m as Method;
        break;
      }
      case "--top": a.top = parseInt(next(), 10); break;
      case "--max-snippet": a.maxSnippet = parseInt(next(), 10); break;
      case "--anki-url": a.ankiUrl = next(); break;
      case "--model": a.model = next(); break;
      case "--base-url": a.baseUrl = next(); break;
      case "--api-key-env": a.apiKeyEnv = next(); break;
      case "--cache": a.cache = true; a.cachePath = next(); break;
      case "--no-cache": a.cache = false; break;
      case "--json": a.json = true; break;
      case "--help": case "-h": printHelpAndExit(); break;
      default: die(`Unknown argument: ${arg}`);
    }
  }
  if (!a.query && !a.deck) die("Provide --deck <name> or --query <anki-query>.");
  if (!a.query && a.deck) a.query = `deck:"${a.deck}"`;
  if (!(a.target >= 0 && a.target <= 1)) die("--target must be between 0 and 1.");
  return a;
}

function die(msg: string): never {
  console.error(`error: ${msg}`);
  console.error("Run with --help for usage.");
  Deno.exit(2);
}

function printHelpAndExit(): never {
  // The leading block comment is the canonical help text.
  const src = new URL(import.meta.url);
  try {
    const text = Deno.readTextFileSync(src);
    const doc = text.match(/\/\*\*([\s\S]*?)\*\//);
    if (doc) console.log(doc[1].replace(/^\s*\* ?/gm, "").trim());
  } catch {
    console.log("dedupe.ts — see file header for usage.");
  }
  Deno.exit(0);
}

// ---------------------------------------------------------------------------
// AnkiConnect
// ---------------------------------------------------------------------------

async function anki<T>(url: string, action: string, params: unknown = {}): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, version: 6, params }),
    });
  } catch (e) {
    die(
      `Cannot reach AnkiConnect at ${url}. Is Anki running with the AnkiConnect ` +
      `add-on installed (code 2055492159)?\n  (${(e as Error).message})`,
    );
  }
  if (!resp.ok) die(`AnkiConnect HTTP ${resp.status} for action "${action}".`);
  const data = await resp.json() as { result: T; error: string | null };
  if (data.error) die(`AnkiConnect error on "${action}": ${data.error}`);
  return data.result;
}

interface NoteInfo {
  noteId: number;
  modelName: string;
  tags: string[];
  fields: Record<string, { value: string; order: number }>;
}

// ---------------------------------------------------------------------------
// Text extraction
// ---------------------------------------------------------------------------

/** Strip HTML tags, cloze markup, and media refs; collapse whitespace. */
function noteToText(note: NoteInfo): string {
  const parts = Object.values(note.fields)
    .sort((x, y) => x.order - y.order)
    .map((f) => f.value);
  let s = parts.join("  ");
  s = s.replace(/\[sound:[^\]]*\]/gi, " ");        // audio refs
  s = s.replace(/<img[^>]*>/gi, " ");              // images
  s = s.replace(/\{\{c\d+::(.*?)(::.*?)?\}\}/gs, "$1"); // cloze -> answer text
  s = s.replace(/<[^>]+>/g, " ");                  // remaining tags
  s = decodeEntities(s);
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function decodeEntities(s: string): string {
  const map: Record<string, string> = {
    "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">",
    "&quot;": '"', "&#39;": "'", "&apos;": "'",
  };
  return s
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;|&apos;/g, (m) => map[m])
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

// ---------------------------------------------------------------------------
// TF-IDF vectorization + cosine similarity via inverted index
// ---------------------------------------------------------------------------

function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const grams: string[] = [];
  for (let i = 0; i < words.length; i++) {
    grams.push(words[i]);
    if (i + 1 < words.length) grams.push(`${words[i]} ${words[i + 1]}`); // bigram
  }
  return grams;
}

/** Sparse, L2-normalized TF-IDF vectors, one per document. */
function tfidfVectors(texts: string[]): Map<string, number>[] {
  const n = texts.length;
  const docTokens = texts.map(tokenize);

  const df = new Map<string, number>();
  for (const toks of docTokens) {
    for (const t of new Set(toks)) df.set(t, (df.get(t) ?? 0) + 1);
  }

  const vectors: Map<string, number>[] = [];
  for (const toks of docTokens) {
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    const vec = new Map<string, number>();
    let norm = 0;
    for (const [t, freq] of tf) {
      const idf = Math.log((n + 1) / ((df.get(t) ?? 0) + 1)) + 1;
      const w = (1 + Math.log(freq)) * idf;
      vec.set(t, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [t, w] of vec) vec.set(t, w / norm);
    vectors.push(vec);
  }
  return vectors;
}

/**
 * All pairs with cosine >= target.
 *
 * An inverted index generates *candidate* pairs (those sharing a discriminative
 * token) cheaply, then every candidate is scored with an exact sparse cosine —
 * so the reported similarity is the true cosine, never a truncated one.
 *
 * Tokens present in more than 50% of docs are skipped for candidate generation
 * only: they are non-discriminative (near-zero idf) and would blow the postings
 * lists up to O(n²). Real duplicates always share distinctive lower-frequency
 * tokens, so this does not cost recall — and because scoring is exact, it never
 * affects the similarity value.
 */
function tfidfPairs(
  vectors: Map<string, number>[],
  target: number,
): [number, number, number][] {
  const n = vectors.length;
  const dfCap = Math.max(2, Math.floor(n * 0.5));

  const postings = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    for (const t of vectors[i].keys()) {
      let list = postings.get(t);
      if (!list) postings.set(t, (list = []));
      list.push(i);
    }
  }

  // Candidate pairs: any (i<j) sharing at least one sub-cap token.
  const candidates = new Set<number>();
  for (const list of postings.values()) {
    if (list.length < 2 || list.length > dfCap) continue;
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        candidates.add(list[x] * n + list[y]); // list preserves doc order → i < j
      }
    }
  }

  const out: [number, number, number][] = [];
  for (const key of candidates) {
    const i = Math.floor(key / n), j = key % n;
    // Exact cosine: iterate the smaller sparse vector.
    let small = vectors[i], big = vectors[j];
    if (small.size > big.size) [small, big] = [big, small];
    let dot = 0;
    for (const [t, w] of small) {
      const wj = big.get(t);
      if (wj !== undefined) dot += w * wj;
    }
    if (dot >= target) out.push([i, j, dot]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Semantic embeddings (Ollama / OpenAI / OpenRouter) via the Vercel AI SDK,
// with an on-disk cache + dense cosine similarity.
// ---------------------------------------------------------------------------

interface EmbedConfig {
  method: EmbedMethod;
  baseUrl: string;
  model: string;
  apiKey?: string;
  cachePath?: string; // undefined ⇒ caching disabled
}

/** Resolve flags + env + presets into a concrete embedding configuration. */
function resolveEmbedConfig(args: Args): EmbedConfig {
  const method = args.method as EmbedMethod;
  const preset = PRESETS[method];
  const model = args.model ?? preset.model;
  const baseUrl = (args.baseUrl ?? Deno.env.get(preset.baseUrlEnv) ?? preset.baseUrl)
    .replace(/\/$/, "");

  const keyEnv = args.apiKeyEnv ?? preset.keyEnv;
  const apiKey = keyEnv ? Deno.env.get(keyEnv) ?? undefined : undefined;
  if (keyEnv && !apiKey) {
    die(`--method ${method} needs an API key. Set ${keyEnv} (or pass --api-key-env).`);
  }

  let cachePath: string | undefined;
  if (args.cache) cachePath = args.cachePath ?? defaultCachePath();

  return { method, baseUrl, model, apiKey, cachePath };
}

function defaultCachePath(): string {
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? ".";
  return `${home}/.cache/anki-dedupe/embeddings.json`;
}

/** Stable cache key for a (namespace, text) pair. */
async function cacheKey(ns: string, text: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${ns}\u0000${text}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

type Cache = Record<string, number[]>;

function loadCache(path: string): Cache {
  try {
    return JSON.parse(Deno.readTextFileSync(path)) as Cache;
  } catch {
    return {}; // missing or corrupt cache → start fresh
  }
}

function saveCache(path: string, cache: Cache): void {
  try {
    const dir = path.replace(/\/[^/]*$/, "");
    if (dir && dir !== path) Deno.mkdirSync(dir, { recursive: true });
    Deno.writeTextFileSync(path, JSON.stringify(cache));
  } catch (e) {
    console.error(`  warning: could not write cache (${(e as Error).message})`);
  }
}

function unit(raw: number[]): Float64Array {
  const v = Float64Array.from(raw);
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let k = 0; k < v.length; k++) v[k] /= norm;
  return v;
}

/**
 * Embed texts, reusing cached vectors and only calling the provider for cache
 * misses. Cached vectors are keyed by SHA-256 of "<method>:<model>\0<text>", so
 * unchanged notes are never re-embedded and switching model/provider is safe.
 */
async function embed(texts: string[], cfg: EmbedConfig): Promise<Float64Array[]> {
  const ns = `${cfg.method}:${cfg.model}`;
  const cache: Cache = cfg.cachePath ? loadCache(cfg.cachePath) : {};
  const keys = await Promise.all(texts.map((t) => cacheKey(ns, t)));

  const out = new Array<Float64Array>(texts.length);
  const missTexts: string[] = [];
  const missIdx: number[] = [];
  for (let i = 0; i < texts.length; i++) {
    const hit = cfg.cachePath ? cache[keys[i]] : undefined;
    if (hit) out[i] = unit(hit);
    else { missTexts.push(texts[i] || " "); missIdx.push(i); }
  }

  const hits = texts.length - missTexts.length;
  if (cfg.cachePath && hits > 0) console.error(`  cache: ${hits}/${texts.length} hit`);

  if (missTexts.length > 0) {
    console.error(`  embedding ${missTexts.length} note(s) via ${cfg.method} (${cfg.model})...`);
    const provider = createOpenAICompatible({
      name: cfg.method,
      baseURL: cfg.baseUrl,
      apiKey: cfg.apiKey,
    });
    let embeddings: number[][];
    try {
      const res = await embedMany({
        model: provider.embeddingModel(cfg.model),
        values: missTexts,
      });
      embeddings = res.embeddings as number[][];
    } catch (e) {
      die(`Embedding request failed (${cfg.method} @ ${cfg.baseUrl}): ${(e as Error).message}`);
    }
    for (let k = 0; k < missIdx.length; k++) {
      out[missIdx[k]] = unit(embeddings[k]);
      if (cfg.cachePath) cache[keys[missIdx[k]]] = embeddings[k];
    }
    if (cfg.cachePath) saveCache(cfg.cachePath, cache);
  }

  return out;
}

function densePairs(
  vectors: Float64Array[],
  target: number,
): [number, number, number][] {
  const n = vectors.length;
  const out: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = vectors[i], b = vectors[j];
      let dot = 0;
      for (let k = 0; k < a.length; k++) dot += a[k] * b[k];
      if (dot >= target) out.push([i, j, dot]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(Deno.args);

  // Resolve (and validate) the embedding backend up front so a missing key or
  // bad config fails before we touch Anki.
  const embedCfg = args.method === "tfidf" ? null : resolveEmbedConfig(args);

  await anki<number>(args.ankiUrl, "version"); // health check

  console.error(`Finding notes: ${args.query}`);
  const noteIds = await anki<number[]>(args.ankiUrl, "findNotes", { query: args.query });
  if (noteIds.length === 0) die(`No notes match: ${args.query}`);
  if (noteIds.length === 1) die("Only one note matched — nothing to compare.");
  console.error(`Found ${noteIds.length} notes. Vectorizing with "${args.method}"...`);

  const notes = await anki<NoteInfo[]>(args.ankiUrl, "notesInfo", { notes: noteIds });
  const texts = notes.map(noteToText);

  let pairs: [number, number, number][];
  if (embedCfg === null) {
    const vectors = tfidfVectors(texts);
    pairs = tfidfPairs(vectors, args.target);
  } else {
    const vectors = await embed(texts, embedCfg);
    pairs = densePairs(vectors, args.target);
  }

  pairs.sort((p, q) => q[2] - p[2]);
  if (args.top !== undefined) pairs = pairs.slice(0, args.top);

  const result = {
    deck: args.deck ?? null,
    query: args.query,
    method: args.method,
    target: args.target,
    noteCount: notes.length,
    pairCount: pairs.length,
    pairs: pairs.map(([i, j, sim]) => ({
      similarity: Number(sim.toFixed(4)),
      a: { noteId: notes[i].noteId, model: notes[i].modelName, tags: notes[i].tags, text: texts[i] },
      b: { noteId: notes[j].noteId, model: notes[j].modelName, tags: notes[j].tags, text: texts[j] },
    })),
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Human-readable report; also print JSON at the end for Claude to parse.
  console.log();
  console.log(`Deck/query : ${result.query}`);
  console.log(`Method     : ${result.method}   Target ≥ ${result.target}`);
  console.log(`Notes      : ${result.noteCount}`);
  console.log(`Candidate pairs above target: ${result.pairCount}`);
  console.log("─".repeat(72));
  const clip = (s: string) => s.length > args.maxSnippet ? s.slice(0, args.maxSnippet) + "…" : s;
  result.pairs.forEach((p, idx) => {
    console.log(`\n[${idx + 1}] similarity ${p.similarity}`);
    console.log(`  A (note ${p.a.noteId}): ${clip(p.a.text)}`);
    console.log(`  B (note ${p.b.noteId}): ${clip(p.b.text)}`);
  });
  if (result.pairCount === 0) {
    console.log("\nNo pairs met the threshold. Try lowering --target.");
  }
  console.log("\n" + "─".repeat(72));
  console.log("JSON_RESULT_BEGIN");
  console.log(JSON.stringify(result));
  console.log("JSON_RESULT_END");
}

if (import.meta.main) await main();
