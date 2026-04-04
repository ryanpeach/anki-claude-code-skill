# Card Templates & Styling Reference

This document covers HTML/CSS templates for well-formatted Anki cards and media handling.

## Default Card Styling

When creating note types or suggesting card styling to users, use this clean CSS that works across desktop and mobile:

```css
.card {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 18px;
  line-height: 1.5;
  text-align: center;
  color: #1a1a1a;
  background-color: #fafafa;
  padding: 20px;
  max-width: 600px;
  margin: 0 auto;
}

code {
  font-family: "SF Mono", "Fira Code", "Consolas", monospace;
  font-size: 0.9em;
  background-color: #f0f0f0;
  padding: 2px 6px;
  border-radius: 3px;
}

pre {
  text-align: left;
  background-color: #2d2d2d;
  color: #f8f8f2;
  padding: 12px 16px;
  border-radius: 6px;
  overflow-x: auto;
  font-size: 0.85em;
}

pre code {
  background: none;
  padding: 0;
  color: inherit;
}

.tag {
  display: inline-block;
  font-size: 0.7em;
  color: #888;
  margin-top: 16px;
}

img {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
}

hr#answer {
  border: none;
  border-top: 1px solid #ddd;
  margin: 20px 0;
}
```

## Template Patterns

### Basic Card Template

**Front:**
```html
{{Front}}
```

**Back:**
```html
{{FrontSide}}
<hr id="answer">
{{Back}}
```

### Basic (and reversed card) Template

Same as Basic — Anki auto-generates the reverse card.

### Cloze Template

**Front:**
```html
{{cloze:Text}}
```

**Back:**
```html
{{cloze:Text}}
<br>
{{Extra}}
```

## Formatting Card Content

### Text Formatting

Use HTML in field values:

```
Bold:      <b>important term</b>
Italic:    <i>emphasis</i>
Underline: <u>key phrase</u>
Line break: <br>
Bullet list:
<ul>
<li>Item one</li>
<li>Item two</li>
</ul>
```

### Code in Cards

**Inline code:**
```
The <code>map()</code> function applies a function to every item in an iterable.
```

**Code blocks:**
```
<pre><code>def fibonacci(n):
    if n &lt;= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)</code></pre>
```

Remember to HTML-encode `<`, `>`, and `&` inside code blocks.

### Images

Reference images stored in Anki's media folder:
```html
<img src="diagram.png">
```

With sizing:
```html
<img src="diagram.png" style="max-width: 400px;">
```

### Audio

Reference audio files:
```
[sound:pronunciation.mp3]
```

Place audio references in a field value. Anki will render a play button.

## Media Workflow

### Adding Images to Cards

1. Store the media file via AnkiConnect:
```bash
curl -s localhost:8765 -X POST -d '{
  "action": "storeMediaFile",
  "version": 6,
  "params": {
    "filename": "unique-name.png",
    "path": "/path/to/image.png"
  }
}'
```

2. Reference it in the card field:
```json
{
  "Front": "What does this diagram represent?<br><img src=\"unique-name.png\">",
  "Back": "A binary search tree with balanced nodes"
}
```

### Adding Audio to Cards

1. Store the audio file:
```bash
curl -s localhost:8765 -X POST -d '{
  "action": "storeMediaFile",
  "version": 6,
  "params": {
    "filename": "word-pronunciation.mp3",
    "path": "/path/to/audio.mp3"
  }
}'
```

2. Reference in card field:
```json
{
  "Front": "How do you pronounce this word?<br>[sound:word-pronunciation.mp3]",
  "Back": "kuhn-KURR-uhnt (concurrent)"
}
```

### Media from URLs

AnkiConnect can download media directly:
```bash
curl -s localhost:8765 -X POST -d '{
  "action": "storeMediaFile",
  "version": 6,
  "params": {
    "filename": "remote-image.png",
    "url": "https://example.com/image.png"
  }
}'
```

### Media Filename Conventions

Media filenames must be unique across the entire Anki collection. Use descriptive, namespaced names:

- `python-bst-diagram.png` not `diagram.png`
- `spanish-hola-pronunciation.mp3` not `audio.mp3`
- `kubernetes-pod-lifecycle.png` not `image1.png`

## Dark Mode Support

For users with dark mode, add night-mode overrides:

```css
.nightMode .card {
  color: #e0e0e0;
  background-color: #1a1a1a;
}

.nightMode code {
  background-color: #333;
}

.nightMode hr#answer {
  border-top-color: #444;
}
```

## Mobile Considerations

- Keep font size at 18px+ for readability on phones
- Use `max-width: 100%` on images
- Avoid fixed-width layouts
- Test that code blocks scroll horizontally rather than overflow
- Keep card content concise — mobile screens show less context
