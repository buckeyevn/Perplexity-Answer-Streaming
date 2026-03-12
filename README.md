# pplx-answer-streaming

Streaming answer generation with inline citation grounding.

## Pipeline

```
[query + sources] → LLM stream → [token buffer] → detect [[N]] markers → emit typed events
```

Answers are grounded against retrieved sources. Every factual claim is expected to carry a `[[N]]` citation marker. The streamer buffers partial tokens to avoid emitting incomplete markers mid-stream.

## API

```bash
npm start   # http://localhost:4002
```

| Route | Method | Description |
|---|---|---|
| `/answer` | POST | Full (non-streaming) answer |
| `/answer/stream` | POST | SSE streaming answer |
| `/citations/format` | POST | Format answer with citations |
| `/citations/audit` | POST | Check citation coverage |

### Streaming example

```js
const res = await fetch('http://localhost:4002/answer/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: 'What is NDCG?', sources: [...] })
});

for await (const line of res.body) {
  const { type, text, index, source } = JSON.parse(line.replace('data: ', ''));
  if (type === 'token') process.stdout.write(text);
  if (type === 'citation') console.log(`\n[${index}] ${source.title}`);
}
```

### Citation formats

```bash
# Markdown with footnotes
curl -X POST localhost:4002/citations/format \
  -d '{"text":"Fact [[1]]","sources":[...],"format":"markdown"}'

# HTML with superscript links
# Structured JSON with segment tree
```

## Citation audit

Checks sentence-level citation coverage:

```json
{ "citedCount": 3, "total": 4, "coveragePercent": 75, "uncitedSentences": ["..."] }
```

## Tests

```bash
npm test   # 25 tests
```
