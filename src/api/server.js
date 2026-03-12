/**
 * api/server.js — pplx-answer-streaming
 *
 * Routes:
 *   POST /answer            — generate (non-streaming)
 *   POST /answer/stream     — Server-Sent Events streaming
 *   POST /citations/format  — format an answer with citations
 *   POST /citations/audit   — check citation coverage
 *   GET  /health
 */

import express from "express";
import cors from "cors";
import { AnswerStreamer, extractCitations } from "../streamer/index.js";
import {
  toMarkdown,
  toHTML,
  toStructured,
  normalizeCitations,
  auditCitations,
} from "../citations/index.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get("/health", (_, res) => res.json({ status: "ok" }));

/**
 * POST /answer
 * Non-streaming answer generation.
 * Body: { query: string, sources: [{id, text, url?, title?}], format?: "json"|"markdown"|"html" }
 */
app.post("/answer", async (req, res) => {
  const { query, sources, format = "json" } = req.body ?? {};
  if (!query) return res.status(400).json({ error: "query required" });
  if (!Array.isArray(sources) || !sources.length)
    return res.status(400).json({ error: "sources[] required" });

  try {
    const streamer = new AnswerStreamer();
    const { fullText, citations, usage } = await streamer.generate(
      query,
      sources,
      { stream: false }
    );

    let formatted;
    if (format === "markdown") {
      formatted = toMarkdown(fullText, sources);
    } else if (format === "html") {
      formatted = toHTML(fullText, sources);
    } else {
      formatted = toStructured(fullText, sources);
    }

    res.json({ answer: formatted, usage, citationCount: citations.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /answer/stream
 * SSE streaming. Client receives newline-delimited JSON events.
 *
 * Event types:
 *   { type: "token",    text: string }
 *   { type: "citation", index: number, source: object }
 *   { type: "done",     fullText: string, citations: Array, usage: object }
 *   { type: "error",    error: string }
 */
app.post("/answer/stream", async (req, res) => {
  const { query, sources } = req.body ?? {};
  if (!query) return res.status(400).json({ error: "query required" });
  if (!Array.isArray(sources) || !sources.length)
    return res.status(400).json({ error: "sources[] required" });

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const streamer = new AnswerStreamer();

  streamer.on("token", (e) => send({ type: "token", text: e.text }));
  streamer.on("citation", (e) =>
    send({ type: "citation", index: e.index, source: e.source, position: e.position })
  );
  streamer.on("done", (e) => {
    send({ type: "done", fullText: e.fullText, citations: e.citations, usage: e.usage });
    res.end();
  });
  streamer.on("error", (e) => {
    send({ type: "error", error: e.error.message });
    res.end();
  });

  try {
    await streamer.generate(query, sources, { stream: true });
  } catch (err) {
    send({ type: "error", error: err.message });
    res.end();
  }
});

/**
 * POST /citations/format
 * Body: { text: string, sources: Array, format: "json"|"markdown"|"html" }
 */
app.post("/citations/format", (req, res) => {
  const { text, sources, format = "json" } = req.body ?? {};
  if (!text) return res.status(400).json({ error: "text required" });
  if (!Array.isArray(sources))
    return res.status(400).json({ error: "sources[] required" });

  let result;
  if (format === "markdown") result = toMarkdown(text, sources);
  else if (format === "html") result = toHTML(text, sources);
  else result = toStructured(text, sources);

  res.json({ result });
});

/**
 * POST /citations/audit
 * Check what fraction of sentences are cited.
 * Body: { text: string }
 */
app.post("/citations/audit", (req, res) => {
  const { text } = req.body ?? {};
  if (!text) return res.status(400).json({ error: "text required" });
  res.json(auditCitations(text));
});

const PORT = process.env.PORT ?? 4002;
app.listen(PORT, () => {
  console.log(`\n✍️   pplx-answer-streaming`);
  console.log(`    http://localhost:${PORT}\n`);
});

export { app };
