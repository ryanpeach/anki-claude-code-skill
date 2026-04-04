# Flashcard Science Reference

This document contains the evidence-based rules for creating high-quality flashcards. Read this before generating any cards.

## The 7 Laws of Card Creation

### Law 1: Understand First

Never create cards from material that hasn't been fully parsed and understood. If the source text is ambiguous, unclear, or uses unfamiliar jargon, ask clarifying questions before generating cards.

- Cards should test recall of understood concepts, not memorization of opaque text
- "Anki is a scheduling tool, not a learning tool" — understanding must happen first
- If the user pastes raw material, summarize your understanding back to them before generating cards

### Law 2: One Atom Per Card

Each card tests exactly one discrete fact, concept, or connection. If a card requires remembering two independent things, split it into two cards.

**Bad:**
```
Q: What are the ACID properties of database transactions?
A: Atomicity, Consistency, Isolation, Durability
```

**Good (split into individual cards):**
```
Q: [Databases] Which ACID property ensures a transaction is all-or-nothing?
A: Atomicity

Q: [Databases] Which ACID property ensures a transaction moves the database from one valid state to another?
A: Consistency
```

Plus a cloze for each:
```
{{c1::Atomicity}} is the ACID property that ensures a database transaction is all-or-nothing.
```

### Law 3: No Orphans

Every card must connect to something the user cares about or is actively working with. Isolated trivia is low-value and will become a review burden.

- When generating cards from dense material, prioritize concepts that relate to the user's stated goals
- Ask "why does this matter to you?" when the relevance isn't clear
- It's better to create 5 connected cards than 15 scattered ones
- Cards should build on each other — a web of knowledge, not isolated dots

### Law 4: Precise Cues, Consistent Answers

Every question must produce exactly one unambiguous answer. The same neural pathway should fire every time.

**Anti-patterns:**
- "Describe X" → too vague, different answer every time
- "What do you know about X?" → open-ended, no consistent retrieval
- "What is an example of X?" → multiple valid answers, inconsistent recall

**Fixes:**
- "Describe X" → "What does X do when Y happens?"
- "Example of X?" → "X is an example of {{c1::___}}" (recognition, not generation)
- Frame questions with enough context to narrow to one answer

**Test:** If you can think of two reasonable answers to a question, it's too vague.

### Law 5: No Enumerations

Never ask "list the N types/steps/components of X." Lists are extremely hard to retain and produce frustrating review sessions.

**Instead:**
- Create individual cards for each list item, testing what it does or why it matters
- If the ordering matters, use a mnemonic and test the mnemonic
- Add a card that tests the pattern or principle connecting the items
- Test recognition: "Is X a type of Y? → Yes, because..."

**Bad:**
```
Q: What are the 4 pillars of OOP?
A: Encapsulation, Abstraction, Inheritance, Polymorphism
```

**Good:**
```
Q: [OOP] Which principle hides internal state and requires interaction through methods?
A: Encapsulation

Q: [OOP] Which principle allows a subclass to provide a specific implementation of a parent method?
A: Polymorphism

[Cloze] In OOP, {{c1::inheritance}} allows a class to reuse behavior from a parent class.

Q: [OOP] How does abstraction differ from encapsulation?
A: Abstraction hides complexity by exposing only relevant interfaces; encapsulation hides internal state behind methods.
```

### Law 6: Context-Free

Each card must be fully understandable without seeing any other card or the source material. A card encountered during review 3 months from now must make immediate sense.

**Techniques:**
- Prefix with topic tags: `[Python]`, `[Kubernetes]`, `[React Hooks]`
- Include enough context in the question to anchor it: "In Python's GIL model, ..." not just "What does the GIL do?"
- Don't reference "the article" or "chapter 3" — state the concept directly
- If a card only makes sense next to another card, merge them or add context

### Law 7: Cloze When Possible

Cloze deletions (fill-in-the-blank) test recall in context, which produces better retention than isolated Q&A for most factual knowledge.

**When to use Cloze:**
- Definitions: `{{c1::Idempotent}} operations produce the same result regardless of how many times they're applied`
- Relationships: `In the OSI model, {{c1::the transport layer}} sits between the network layer and {{c2::the session layer}}`
- Facts with clear context: `Git stores data as {{c1::snapshots}}, not as diffs`

**When to use Basic Q&A instead:**
- "Why" and "How" questions requiring explanation
- Conceptual comparisons ("How does X differ from Y?")
- Application questions ("When would you use X over Y?")

**Cloze rules:**
- One cloze deletion per card when possible (use c1 only)
- Multiple clozes (c1, c2) only when testing related parts of the same concept
- The surrounding text must provide enough context to recall the hidden word
- Don't cloze trivial words — cloze the meaningful concept

## Anti-Patterns to Avoid

### Yes/No Questions
Low retrieval effort. The answer is always a coin flip.

**Bad:** `Q: Is Python dynamically typed? A: Yes`
**Good:** `Q: [Python] What is Python's type system? A: Dynamically typed — types are checked at runtime, not compile time`

### The "Example Trap"
Asking for examples produces inconsistent answers. Test recognition instead.

**Bad:** `Q: Give an example of a NoSQL database`
**Good:** `{{c1::MongoDB}} is a document-oriented NoSQL database`

### Cards During First Reading
Never create cards on a first pass through material. Read the whole thing first, understand the structure, identify what matters, then go back and create cards.

### Vague Prompts
If a question could be answered multiple ways, it will be — and each review will feel inconsistent.

### Statement Cards
Never put a statement on the front. Always frame as a question or cloze.

**Bad:** Front: "Python uses GIL" / Back: "Global Interpreter Lock"
**Good:** `Q: [Python] What mechanism prevents multiple threads from executing Python bytecode simultaneously? A: The Global Interpreter Lock (GIL)`

### Overly Long Answers
If the answer is more than 1-2 sentences, the card is testing too much. Split it.

## Card Type Selection Guide

| Situation | Card Type | Example |
|-----------|-----------|---------|
| Definition or fact | Cloze | `{{c1::TCP}} guarantees ordered, reliable delivery` |
| Term ↔ definition (both directions) | Basic (and reversed) | Q: "What is memoization?" / A: "Caching function results" |
| "Why" or "How" explanation | Basic | Q: "Why does quicksort degrade to O(n^2)?" |
| Concept comparison | Basic | Q: "How does UDP differ from TCP?" |
| Relationship between concepts | Cloze | `{{c1::DNS}} translates domain names to {{c2::IP addresses}}` |
| Process step | Cloze | `In TLS handshake, the client sends a {{c1::ClientHello}} message first` |
| When to apply a technique | Basic | Q: "When would you use a trie over a hash map?" |

## Quality Self-Review Checklist

Before presenting any card to the user, verify:

- [ ] Tests exactly one thing (Law 2)
- [ ] Has exactly one unambiguous answer (Law 4)
- [ ] Makes sense without other cards or source material (Law 6)
- [ ] Question requires actual retrieval, not trivial inference
- [ ] Answer is 1-2 sentences maximum
- [ ] No lists in the answer (Law 5)
- [ ] Not a yes/no question
- [ ] Includes topic context tags
- [ ] Uses the most appropriate card type
- [ ] Would still make sense 3 months from now

## Matuschak's Prompt-Writing Principles

From Andy Matuschak's research on spaced repetition systems:

### Properties of Effective Prompts
- **Focused** — target one detail, not multiple elements
- **Precise** — explicit about what should be recalled
- **Consistent** — same answer every time, same neural pathway
- **Tractable** — aim for ~90% accuracy; constant failure causes interference
- **Effortful** — must require real retrieval, not trivial recognition

### Techniques by Knowledge Type

**Factual knowledge:** Use cloze deletions. For closed lists, one card per element. For open lists, test individual items and the pattern connecting them.

**Conceptual knowledge:** Use multiple lenses — attributes, similarities/differences, parts/wholes, causes/effects, significance/implications. Create cards from several angles.

**Procedural knowledge:** Break procedures into key verbs, transitions, and conditions. Create "heads-up" cards for timing and sequencing. Add explanation cards for the reasoning behind steps.

### Elaborative Encoding
Connect isolated information to meaningful associations:
- Personal experiences or emotions
- Visual imagery
- Humor
- Mnemonic devices (place in the answer field, in parentheses)

### The Iterative Process
1. First pass: 5-10 cards on the most important concepts
2. Return to material for increasingly nuanced cards
3. Revise cards during reviews when they feel wrong or unclear
4. Delete cards you no longer care about — don't force unmotivated review

## The EAT Framework

A simple litmus test for every card:

- **Encoded** — created from material you've already learned and understood
- **Atomic** — specific enough for fast retrieval (target: answer in under 8 seconds)
- **Timeless** — your future self will understand it without additional context
