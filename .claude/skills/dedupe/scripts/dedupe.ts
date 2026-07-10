#!/usr/bin/env -S deno run -A
/**
 * dedupe.ts — Vector-index an Anki deck and surface near-duplicate note pairs.
 *
 * Pulls every note in a deck (or matching an Anki search query) from
 * AnkiConnect (via the yanki-connect client), builds a vector for each note,
 * computes pairwise cosine similarity, and prints every pair scoring at or
 * above a target threshold.
 *
 * The script only *surfaces candidates* — it does not decide what is a
 * duplicate. That final judgment is left to Claude Code, which inspects the
 * emitted pairs semantically.
 *
 * Vectorization backends (--method):
 *   tfidf  (default) — TF-IDF over word uni/bigrams. Zero setup, fully local,
 *                      great at catching reworded / near-identical cards.
 *   ollama           — Local semantic embeddings via ai-sdk-ollama. No API key.
 *   openai           — Semantic embeddings via @ai-sdk/openai. Needs OPENAI_API_KEY.
 *   openrouter       — Semantic embeddings via @openrouter/ai-sdk-provider.
 *                      Needs OPENROUTER_API_KEY.
 *
 * Embeddings go through the Vercel AI SDK (`ai`), one dedicated provider package
 * per backend — each knows its own base URL and API-key env, so there is no
 * hand-maintained endpoint table. Override with --base-url / --model /
 * --api-key-env when you need a non-default host, model, or key source.
 *
 * Usage:
 *   deno run -A dedupe.ts --deck "Spanish::Vocab" --target 0.8
 *   deno run -A dedupe.ts --query "deck:Spanish tag:verbs" --target 0.85
 *   deno run -A dedupe.ts --deck "Spanish" --method ollama --target 0.88
 *   deno run -A dedupe.ts --deck "Spanish" --method openrouter --model openai/text-embedding-3-small
 *
 * Run with --help for the full, Cliffy-generated flag list.
 *
 * Per-method defaults (base URL comes from the provider package):
 *   ollama      key (none)              model nomic-embed-text
 *   openai      key OPENAI_API_KEY       model text-embedding-3-small
 *   openrouter  key OPENROUTER_API_KEY   model openai/text-embedding-3-small
 *
 * Caching: embedding vectors are cached on disk (default
 * ~/.cache/anki-dedupe/embeddings.json) keyed by a hash of "<method>:<model>" +
 * note text, so re-running only embeds notes that are new or changed. TF-IDF
 * needs no cache (it is local and instant).
 *
 * Environment:
 *   OPENAI_API_KEY / OPENROUTER_API_KEY  API key for the chosen method.
 *   OLLAMA_BASE_URL / OPENAI_BASE_URL / OPENROUTER_BASE_URL
 *                      Override the provider base URL without a flag.
 */

import { Command, EnumType } from "jsr:@cliffy/command@1.0.0-rc.7";
import { YankiConnect } from "npm:yanki-connect@^4";
import { embedMany } from "npm:ai@^7";
import { createOllama } from "npm:ai-sdk-ollama@^4";
import { createOpenAI } from "npm:@ai-sdk/openai@^4";
import { createOpenRouter } from "npm:@openrouter/ai-sdk-provider@^3";

/** The embedding-model type that `embedMany` accepts, derived from the SDK. */
type EmbeddingModel = Parameters<typeof embedMany>[0]["model"];

// ---------------------------------------------------------------------------
// Embedding providers — one dedicated AI SDK provider package per backend.
// Each provider package owns its default base URL and API-key handling; here we
// only record the per-method default model, the key env var, and a factory that
// builds an embedding model (applying --base-url / --api-key-env overrides).
// ---------------------------------------------------------------------------

type Method = "tfidf" | "ollama" | "openai" | "openrouter";
type EmbedMethod = Exclude<Method, "tfidf">;

interface ProviderSpec {
  defaultModel: string;
  keyEnv: string | null; // null ⇒ no API key required (Ollama)
  baseUrlEnv: string;
  make(model: string, opts: { apiKey?: string; baseURL?: string }): EmbeddingModel;
}

const PROVIDERS: Record<EmbedMethod, ProviderSpec> = {
  ollama: {
    defaultModel: "nomic-embed-text",
    keyEnv: null,
    baseUrlEnv: "OLLAMA_BASE_URL",
    make: (model, o) => createOllama(o).textEmbeddingModel(model),
  },
  openai: {
    defaultModel: "text-embedding-3-small",
    keyEnv: "OPENAI_API_KEY",
    baseUrlEnv: "OPENAI_BASE_URL",
    make: (model, o) => createOpenAI(o).textEmbeddingModel(model),
  },
  openrouter: {
    defaultModel: "openai/text-embedding-3-small",
    keyEnv: "OPENROUTER_API_KEY",
    baseUrlEnv: "OPENROUTER_BASE_URL",
    make: (model, o) => createOpenRouter(o).textEmbeddingModel(model),
  },
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Print an error to stderr and exit non-zero. */
function fail(msg: string): never {
  console.error(`error: ${msg}`);
  console.error("Run with --help for usage.");
  Deno.exit(2);
}

// ---------------------------------------------------------------------------
// AnkiConnect (via yanki-connect)
// ---------------------------------------------------------------------------

/** A note as returned by yanki-connect's notesInfo (subset we use). */
interface Note {
  noteId: number;
  modelName: string;
  tags: string[];
  fields: Record<string, { value: string; order: number }>;
}

/** Build a yanki-connect client from an `http://host:port` AnkiConnect URL. */
function ankiClient(ankiUrl: string): YankiConnect {
  let host = "http://127.0.0.1";
  let port = 8765;
  try {
    const u = new URL(ankiUrl);
    host = `${u.protocol}//${u.hostname}`;
    if (u.port) port = Number(u.port);
  } catch {
    fail(`Invalid --anki-url: ${ankiUrl}`);
  }
  return new YankiConnect({ host, port });
}

// ---------------------------------------------------------------------------
// Text extraction
// ---------------------------------------------------------------------------

/** Strip HTML tags, cloze markup, and media refs; collapse whitespace. */
function noteToText(note: Note): string {
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
// Semantic embeddings via the AI SDK, with an on-disk cache + dense cosine.
// ---------------------------------------------------------------------------

interface EmbedConfig {
  method: EmbedMethod;
  model: string;
  apiKey?: string;
  baseURL?: string;
  cachePath?: string; // undefined ⇒ caching disabled
}

/** Resolve flags + env + provider defaults into a concrete embed config. */
function resolveEmbedConfig(opts: Options): EmbedConfig {
  const method = opts.method as EmbedMethod;
  const spec = PROVIDERS[method];
  const model = opts.model ?? spec.defaultModel;
  const baseURL = opts.baseUrl ?? Deno.env.get(spec.baseUrlEnv) ?? undefined;

  const keyEnv = opts.apiKeyEnv ?? spec.keyEnv;
  const apiKey = keyEnv ? Deno.env.get(keyEnv) ?? undefined : undefined;
  if (keyEnv && !apiKey) {
    fail(`--method ${method} needs an API key. Set ${keyEnv} (or pass --api-key-env).`);
  }

  const cachePath = opts.cache ? (opts.cacheFile ?? defaultCachePath()) : undefined;
  return { method, model, apiKey, baseURL, cachePath };
}

function defaultCachePath(): string {
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? ".";
  return `${home}/.cache/anki-dedupe/embeddings.json`;
}

/** Stable cache key for a (namespace, text) pair. */
async function cacheKey(ns: string, text: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${ns}\n${text}`);
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
 * misses. Cached vectors are keyed by SHA-256 of "<method>:<model>" + text, so
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
    const model = PROVIDERS[cfg.method].make(cfg.model, {
      apiKey: cfg.apiKey,
      baseURL: cfg.baseURL,
    });
    let embeddings: number[][];
    try {
      const res = await embedMany({ model, values: missTexts });
      embeddings = res.embeddings as number[][];
    } catch (e) {
      fail(`Embedding request failed (${cfg.method}, model ${cfg.model}): ${(e as Error).message}`);
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
// Core run
// ---------------------------------------------------------------------------

interface Options {
  deck?: string;
  query?: string;
  target: number;
  method: Method;
  top?: number;
  maxSnippet: number;
  ankiUrl: string;
  model?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  cache: boolean;      // false when --no-cache
  cacheFile?: string;
  json: boolean;
}

async function run(opts: Options) {
  if (!(opts.target >= 0 && opts.target <= 1)) fail("--target must be between 0 and 1.");
  const query = opts.query ?? (opts.deck ? `deck:"${opts.deck}"` : undefined);
  if (!query) fail("Provide --deck <name> or --query <anki-query>.");

  // Resolve (and validate) the embedding backend up front so a missing key or
  // bad config fails before we touch Anki.
  const embedCfg = opts.method === "tfidf" ? null : resolveEmbedConfig(opts);

  const client = ankiClient(opts.ankiUrl);
  try {
    await client.miscellaneous.version(); // health check
  } catch (e) {
    fail(
      `Cannot reach AnkiConnect at ${opts.ankiUrl}. Is Anki running with the ` +
      `AnkiConnect add-on installed (code 2055492159)?\n  (${(e as Error).message})`,
    );
  }

  console.error(`Finding notes: ${query}`);
  let noteIds: number[];
  try {
    noteIds = await client.note.findNotes({ query });
  } catch (e) {
    fail(`AnkiConnect findNotes failed: ${(e as Error).message}`);
  }
  if (noteIds.length === 0) fail(`No notes match: ${query}`);
  if (noteIds.length === 1) fail("Only one note matched — nothing to compare.");
  console.error(`Found ${noteIds.length} notes. Vectorizing with "${opts.method}"...`);

  const notes = await client.note.notesInfo({ notes: noteIds }) as Note[];
  const texts = notes.map(noteToText);

  let pairs: [number, number, number][];
  if (embedCfg === null) {
    const vectors = tfidfVectors(texts);
    pairs = tfidfPairs(vectors, opts.target);
  } else {
    const vectors = await embed(texts, embedCfg);
    pairs = densePairs(vectors, opts.target);
  }

  pairs.sort((p, q) => q[2] - p[2]);
  if (opts.top !== undefined) pairs = pairs.slice(0, opts.top);

  const result = {
    deck: opts.deck ?? null,
    query,
    method: opts.method,
    target: opts.target,
    noteCount: notes.length,
    pairCount: pairs.length,
    pairs: pairs.map(([i, j, sim]) => ({
      similarity: Number(sim.toFixed(4)),
      a: { noteId: notes[i].noteId, model: notes[i].modelName, tags: notes[i].tags, text: texts[i] },
      b: { noteId: notes[j].noteId, model: notes[j].modelName, tags: notes[j].tags, text: texts[j] },
    })),
  };

  if (opts.json) {
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
  const clip = (s: string) => s.length > opts.maxSnippet ? s.slice(0, opts.maxSnippet) + "…" : s;
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

// ---------------------------------------------------------------------------
// CLI (Cliffy)
// ---------------------------------------------------------------------------

function cli() {
  const methodType = new EnumType(["tfidf", "ollama", "openai", "openrouter"]);
  return new Command()
    .name("dedupe")
    .description("Vector-index an Anki deck and surface near-duplicate note pairs.")
    .type("method", methodType)
    .option("--deck <name:string>", "Deck to scan (quoted). Shorthand for --query 'deck:\"<name>\"'.")
    .option("--query <query:string>", "Raw Anki search query (overrides --deck).")
    .option("--target <target:number>", "Similarity threshold in [0,1]; report pairs ≥ this.", { default: 0.8 })
    .option("--method <method:method>", "tfidf | ollama | openai | openrouter.", { default: "tfidf" })
    .option("--model <name:string>", "Embedding model (semantic methods). Defaults per method.")
    .option("--base-url <url:string>", "Override the provider base URL.")
    .option("--api-key-env <var:string>", "Env var to read the API key from. Defaults per method.")
    .option("--cache-file <path:string>", "Embedding cache file. Default ~/.cache/anki-dedupe/embeddings.json.")
    .option("--no-cache", "Disable the embedding cache (always re-embed).")
    .option("--top <n:integer>", "Cap output to the N highest-scoring pairs.")
    .option("--max-snippet <n:integer>", "Chars of note text shown per side in text output.", { default: 160 })
    .option("--anki-url <url:string>", "AnkiConnect endpoint.", { default: "http://127.0.0.1:8765" })
    .option("--json", "Emit JSON only (for programmatic consumption by Claude).", { default: false })
    .action((opts) => run(opts as unknown as Options));
}

if (import.meta.main) await cli().parse(Deno.args);
