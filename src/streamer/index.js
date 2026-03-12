/**
 * streamer/index.js
 *
 * Core streaming answer generator.
 *
 * Pipeline:
 *   1. Build a grounded prompt from [query + retrieved sources]
 *   2. Stream LLM tokens via Anthropic streaming API
 *   3. As tokens arrive, detect citation markers [[N]] in the stream
 *   4. Emit typed events: {type: "token"}, {type: "citation"}, {type: "done"}
 *
 * Citation format in model output: [[1]], [[2]], etc.
 * These are resolved against the sources array by index.
 */

import Anthropic from "@anthropic-ai/sdk";
import { EventEmitter } from "events";

const client = new Anthropic();

const SYSTEM_PROMPT = `You are Perplexity, a helpful AI assistant that answers questions accurately using provided sources.

CRITICAL RULES:
1. Every factual claim MUST be backed by a source using [[N]] notation where N is the source number.
2. Do NOT make claims not supported by the provided sources.
3. Write in clear, direct prose. No unnecessary hedging.
4. If sources conflict, acknowledge the disagreement and cite both.
5. Never hallucinate URLs or source details — only use what's provided.

Citation format: "The Eiffel Tower is 330m tall [[1]] and was built in 1889 [[2]]."`;

/**
 * Build the grounded user prompt with numbered sources.
 * @param {string} query
 * @param {Array<{id:string, text:string, url?:string, title?:string}>} sources
 * @returns {string}
 */
function buildPrompt(query, sources) {
  const sourceBlock = sources
    .map(
      (s, i) =>
        `[${i + 1}] ${s.title ? `**${s.title}**\n` : ""}${s.url ? `URL: ${s.url}\n` : ""}${s.text}`
    )
    .join("\n\n---\n\n");

  return `SOURCES:\n\n${sourceBlock}\n\n---\n\nQUESTION: ${query}\n\nAnswer using the sources above. Cite every factual claim with [[N]].`;
}

/**
 * Streamer: emits events as the answer is generated.
 *
 * Events:
 *   "token"    — { text: string }
 *   "citation" — { index: number, source: object, position: number }
 *   "done"     — { fullText: string, citations: Citation[], usage: object }
 *   "error"    — { error: Error }
 */
export class AnswerStreamer extends EventEmitter {
  /**
   * @param {Object} opts
   * @param {string} [opts.model]
   * @param {number} [opts.maxTokens]
   */
  constructor({ model = "claude-sonnet-4-6", maxTokens = 1024 } = {}) {
    super();
    this.model = model;
    this.maxTokens = maxTokens;
  }

  /**
   * Stream an answer for a query with grounding sources.
   *
   * @param {string}  query
   * @param {Array}   sources  - [{id, text, url?, title?}]
   * @param {Object}  [opts]
   * @param {boolean} [opts.stream]  - false = return full text (no streaming)
   * @returns {Promise<{fullText:string, citations:Array, usage:Object}>}
   */
  async generate(query, sources, { stream = true } = {}) {
    const prompt = buildPrompt(query, sources);

    if (!stream) {
      return this._generateFull(prompt, sources);
    }

    return this._generateStreaming(prompt, sources);
  }

  async _generateFull(prompt, sources) {
    const response = await client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });

    const fullText = response.content[0]?.text ?? "";
    const citations = extractCitations(fullText, sources);

    this.emit("done", { fullText, citations, usage: response.usage });
    return { fullText, citations, usage: response.usage };
  }

  async _generateStreaming(prompt, sources) {
    let fullText = "";
    let buffer = "";
    let charPosition = 0;
    const emittedCitations = new Set();

    try {
      const stream = await client.messages.stream({
        model: this.model,
        max_tokens: this.maxTokens,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
      });

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          const chunk = event.delta.text;
          fullText += chunk;
          buffer += chunk;
          charPosition += chunk.length;

          // Scan buffer for complete citation markers [[N]]
          let match;
          const citationRegex = /\[\[(\d+)\]\]/g;
          while ((match = citationRegex.exec(buffer)) !== null) {
            const idx = parseInt(match[1], 10) - 1; // 0-indexed
            if (idx >= 0 && idx < sources.length && !emittedCitations.has(match[0])) {
              emittedCitations.add(match[0]);
              this.emit("citation", {
                marker: match[0],
                index: idx + 1,
                source: sources[idx],
                position: charPosition - buffer.length + match.index,
              });
            }
          }

          // Emit text token (strip pending incomplete citation markers)
          const safeText = buffer.replace(/\[\[(?!\d+\]\])[^\]]*$/, "");
          if (safeText) {
            this.emit("token", { text: safeText });
            buffer = buffer.slice(safeText.length);
          }
        }
      }

      // Flush remaining buffer
      if (buffer) {
        this.emit("token", { text: buffer });
      }

      const finalMessage = await stream.finalMessage();
      const citations = extractCitations(fullText, sources);

      this.emit("done", {
        fullText,
        citations,
        usage: finalMessage.usage,
      });

      return { fullText, citations, usage: finalMessage.usage };
    } catch (err) {
      this.emit("error", { error: err });
      throw err;
    }
  }
}

/**
 * Extract and resolve all [[N]] citations from a text.
 * @param {string} text
 * @param {Array}  sources
 * @returns {Array<{marker:string, index:number, source:object}>}
 */
export function extractCitations(text, sources) {
  const seen = new Set();
  const citations = [];
  const regex = /\[\[(\d+)\]\]/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const marker = match[0];
    if (seen.has(marker)) continue;
    seen.add(marker);

    const idx = parseInt(match[1], 10) - 1;
    if (idx >= 0 && idx < sources.length) {
      citations.push({ marker, index: idx + 1, source: sources[idx] });
    }
  }

  return citations;
}

/**
 * Count how many distinct [[N]] markers are in text.
 * @param {string} text
 * @returns {number}
 */
export function countCitations(text) {
  return new Set(text.match(/\[\[\d+\]\]/g) ?? []).size;
}
