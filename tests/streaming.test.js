/**
 * tests/streaming.test.js — pplx-answer-streaming
 */

import {
  extractCitations,
  countCitations,
} from "../src/streamer/index.js";

import {
  normalizeCitations,
  toMarkdown,
  toHTML,
  toStructured,
  auditCitations,
} from "../src/citations/index.js";

const SOURCES = [
  { id: "s1", text: "The Eiffel Tower is 330 meters tall.", url: "https://wiki.org/eiffel", title: "Eiffel Tower" },
  { id: "s2", text: "It was built in 1889 for the World's Fair.", url: "https://wiki.org/eiffel2", title: "Eiffel History" },
  { id: "s3", text: "Paris is the capital of France with 2.1 million residents.", url: "https://wiki.org/paris", title: "Paris" },
  { id: "s4", text: "The tower attracts 7 million visitors annually.", url: "https://wiki.org/tourism", title: "Tourism" },
];

const SAMPLE_TEXT =
  "The Eiffel Tower stands 330 meters tall [[1]] and was built in 1889 [[2]]. " +
  "Located in Paris [[3]], it draws millions of visitors [[4]] each year.";

// ── extractCitations ──────────────────────────────────────────────────────────

test("extractCitations: finds all markers", () => {
  const cits = extractCitations(SAMPLE_TEXT, SOURCES);
  expect(cits).toHaveLength(4);
});

test("extractCitations: resolves correct sources", () => {
  const cits = extractCitations(SAMPLE_TEXT, SOURCES);
  expect(cits[0].source.id).toBe("s1");
  expect(cits[1].source.id).toBe("s2");
  expect(cits[2].source.id).toBe("s3");
  expect(cits[3].source.id).toBe("s4");
});

test("extractCitations: deduplicates repeated markers", () => {
  const text = "Repeated [[1]] and again [[1]] and once more [[2]].";
  const cits = extractCitations(text, SOURCES);
  expect(cits).toHaveLength(2);
});

test("extractCitations: out-of-range marker ignored", () => {
  const text = "Valid [[1]] and invalid [[99]].";
  const cits = extractCitations(text, SOURCES);
  expect(cits).toHaveLength(1);
  expect(cits[0].index).toBe(1);
});

test("extractCitations: empty text returns empty array", () => {
  expect(extractCitations("", SOURCES)).toEqual([]);
});

test("extractCitations: text without citations returns empty array", () => {
  expect(extractCitations("No citations here at all.", SOURCES)).toEqual([]);
});

// ── countCitations ────────────────────────────────────────────────────────────

test("countCitations: counts distinct markers", () => {
  expect(countCitations(SAMPLE_TEXT)).toBe(4);
});

test("countCitations: deduplicates", () => {
  expect(countCitations("[[1]] and [[1]] again and [[2]]")).toBe(2);
});

test("countCitations: zero for clean text", () => {
  expect(countCitations("No citations.")).toBe(0);
});

// ── normalizeCitations ────────────────────────────────────────────────────────

test("normalizeCitations: renumbers sequentially", () => {
  const text = "First [[3]] then [[1]] and [[3]] again.";
  const { text: norm, usedSources } = normalizeCitations(text, SOURCES);
  // [[3]] should become [[1]], [[1]] should become [[2]]
  expect(norm).toContain("[[1]]");
  expect(norm).toContain("[[2]]");
  expect(norm).not.toContain("[[3]]");
  expect(usedSources).toHaveLength(2);
});

test("normalizeCitations: unused sources excluded", () => {
  const text = "Only [[2]] is used.";
  const { usedSources } = normalizeCitations(text, SOURCES);
  expect(usedSources).toHaveLength(1);
  expect(usedSources[0].id).toBe("s2");
});

// ── toMarkdown ────────────────────────────────────────────────────────────────

test("toMarkdown: contains footnote refs", () => {
  const md = toMarkdown(SAMPLE_TEXT, SOURCES);
  expect(md).toContain("[^1]");
  expect(md).toContain("[^2]");
});

test("toMarkdown: contains reference links", () => {
  const md = toMarkdown(SAMPLE_TEXT, SOURCES);
  expect(md).toContain("https://wiki.org/eiffel");
  expect(md).toContain("https://wiki.org/eiffel2");
});

test("toMarkdown: no [[N]] markers remain", () => {
  const md = toMarkdown(SAMPLE_TEXT, SOURCES);
  expect(md).not.toMatch(/\[\[\d+\]\]/);
});

test("toMarkdown: no citations block when no markers", () => {
  const md = toMarkdown("Clean text with no markers.", SOURCES);
  expect(md).not.toContain("[^");
});

// ── toHTML ────────────────────────────────────────────────────────────────────

test("toHTML: contains superscript citation links", () => {
  const html = toHTML(SAMPLE_TEXT, SOURCES);
  expect(html).toContain('<sup>');
  expect(html).toContain('class="citation"');
});

test("toHTML: contains ol.references", () => {
  const html = toHTML(SAMPLE_TEXT, SOURCES);
  expect(html).toContain('<ol class="references">');
});

test("toHTML: source URLs are in reference list", () => {
  const html = toHTML(SAMPLE_TEXT, SOURCES);
  expect(html).toContain("https://wiki.org/eiffel");
});

test("toHTML: no unescaped [[N]] in output", () => {
  const html = toHTML(SAMPLE_TEXT, SOURCES);
  expect(html).not.toMatch(/\[\[\d+\]\]/);
});

// ── toStructured ──────────────────────────────────────────────────────────────

test("toStructured: segments have correct types", () => {
  const s = toStructured(SAMPLE_TEXT, SOURCES);
  const types = new Set(s.segments.map((seg) => seg.type));
  expect(types.has("text")).toBe(true);
  expect(types.has("citation")).toBe(true);
});

test("toStructured: references match used sources", () => {
  const s = toStructured(SAMPLE_TEXT, SOURCES);
  expect(s.references).toHaveLength(4);
  expect(s.references[0].index).toBe(1);
});

test("toStructured: citationCount is correct", () => {
  const s = toStructured(SAMPLE_TEXT, SOURCES);
  expect(s.citationCount).toBe(4);
});

// ── auditCitations ────────────────────────────────────────────────────────────

test("auditCitations: fully cited answer has 100% coverage", () => {
  const text =
    "The tower is 330 meters tall [[1]]. It was built in 1889 [[2]]. Visitors number in millions [[4]].";
  const audit = auditCitations(text);
  expect(audit.coveragePercent).toBe(100);
});

test("auditCitations: uncited sentences detected", () => {
  const text =
    "The tower is 330 meters tall [[1]]. This is a claim with no citation here at all unfortunately.";
  const audit = auditCitations(text);
  expect(audit.uncitedSentences.length).toBeGreaterThan(0);
});

test("auditCitations: empty string returns zero total", () => {
  const audit = auditCitations("");
  expect(audit.total).toBe(0);
  expect(audit.coveragePercent).toBe(0); // no sentences → 0%
});
