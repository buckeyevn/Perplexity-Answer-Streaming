/**
 * citations/index.js
 *
 * Citation post-processing: formatting, deduplication, and rendering.
 *
 * Handles:
 *   - Inline citation numbering normalization
 *   - Source deduplication (same URL → same citation number)
 *   - Rendering to: Markdown, plain text, HTML, JSON
 *   - Citation health check: claims without citations
 */

/**
 * Normalize citation numbers in a text:
 * - Deduplicate (same source → same number)
 * - Renumber sequentially from 1
 *
 * @param {string} text
 * @param {Array}  sources   - original source list
 * @returns {{ text: string, usedSources: Array, citationMap: Map }}
 */
export function normalizeCitations(text, sources) {
  const urlToOriginalIdx = new Map();
  for (let i = 0; i < sources.length; i++) {
    const url = sources[i].url ?? sources[i].id;
    if (!urlToOriginalIdx.has(url)) urlToOriginalIdx.set(url, i);
  }

  // Find all markers and which sources they actually reference
  const usedOriginalIdxs = [];
  const seenIdxs = new Set();
  const regex = /\[\[(\d+)\]\]/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const origIdx = parseInt(match[1], 10) - 1;
    if (origIdx >= 0 && origIdx < sources.length && !seenIdxs.has(origIdx)) {
      usedOriginalIdxs.push(origIdx);
      seenIdxs.add(origIdx);
    }
  }

  // Build renumbering map: original 1-based → new 1-based
  const renumber = new Map();
  usedOriginalIdxs.forEach((origIdx, newIdx) => {
    renumber.set(origIdx + 1, newIdx + 1);
  });

  // Replace markers in text
  const normalizedText = text.replace(/\[\[(\d+)\]\]/g, (_, n) => {
    const newNum = renumber.get(parseInt(n, 10));
    return newNum !== undefined ? `[[${newNum}]]` : "";
  });

  const usedSources = usedOriginalIdxs.map((i) => sources[i]);

  return { text: normalizedText, usedSources, citationMap: renumber };
}

/**
 * Render an answer with citations to Markdown.
 * Appends a numbered references section.
 *
 * @param {string} text
 * @param {Array}  sources
 * @returns {string}
 */
export function toMarkdown(text, sources) {
  const { text: normalized, usedSources } = normalizeCitations(text, sources);

  // Convert [[N]] to superscript markdown [^N]
  const body = normalized.replace(/\[\[(\d+)\]\]/g, "[^$1]");

  if (!usedSources.length) return body;

  const refs = usedSources
    .map((s, i) => {
      const title = s.title ?? s.id;
      return s.url
        ? `[^${i + 1}]: [${title}](${s.url})`
        : `[^${i + 1}]: ${title}`;
    })
    .join("\n");

  return `${body}\n\n---\n\n${refs}`;
}

/**
 * Render to HTML with inline superscript links and a reference list.
 * @param {string} text
 * @param {Array}  sources
 * @returns {string}
 */
export function toHTML(text, sources) {
  const { text: normalized, usedSources } = normalizeCitations(text, sources);

  // Escape HTML in body text first
  const escaped = normalized
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Inline citations
  const body = escaped.replace(/\[\[(\d+)\]\]/g, (_, n) => {
    const src = usedSources[parseInt(n, 10) - 1];
    const href = src?.url ?? "#";
    return `<sup><a href="${href}" class="citation" data-index="${n}">[${n}]</a></sup>`;
  });

  if (!usedSources.length) return `<p>${body}</p>`;

  const refItems = usedSources
    .map((s, i) => {
      const title = s.title ?? s.id;
      return s.url
        ? `<li id="ref-${i + 1}"><a href="${s.url}" target="_blank">${title}</a></li>`
        : `<li id="ref-${i + 1}">${title}</li>`;
    })
    .join("\n");

  return `<div class="answer">${body}</div>\n<ol class="references">\n${refItems}\n</ol>`;
}

/**
 * Structured JSON output for API consumers.
 * @param {string} text
 * @param {Array}  sources
 * @returns {Object}
 */
export function toStructured(text, sources) {
  const { text: normalized, usedSources } = normalizeCitations(text, sources);

  // Split text into segments: plain text and citation markers
  const segments = [];
  let lastIdx = 0;
  const regex = /\[\[(\d+)\]\]/g;
  let match;

  while ((match = regex.exec(normalized)) !== null) {
    if (match.index > lastIdx) {
      segments.push({ type: "text", content: normalized.slice(lastIdx, match.index) });
    }
    const n = parseInt(match[1], 10);
    segments.push({
      type: "citation",
      index: n,
      source: usedSources[n - 1],
    });
    lastIdx = match.index + match[0].length;
  }

  if (lastIdx < normalized.length) {
    segments.push({ type: "text", content: normalized.slice(lastIdx) });
  }

  return {
    text: normalized,
    segments,
    references: usedSources.map((s, i) => ({ index: i + 1, ...s })),
    citationCount: usedSources.length,
  };
}

/**
 * Audit an answer for claims that are NOT backed by citations.
 * Heuristic: sentences ending without a [[N]] nearby.
 *
 * @param {string} text
 * @returns {{ uncitedSentences: string[], citedCount: number, total: number }}
 */
export function auditCitations(text) {
  const sentences = text
    .replace(/\[\[\d+\]\]/g, "§")
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim().length > 20);

  const citedCount = sentences.filter((s) => s.includes("§")).length;
  const uncitedSentences = sentences.filter((s) => !s.includes("§"));

  return {
    uncitedSentences: uncitedSentences.map((s) => s.replace(/§/g, "").trim()),
    citedCount,
    total: sentences.length,
    coveragePercent: sentences.length === 0 ? 0 : Math.round((citedCount / sentences.length) * 100),
  };
}
