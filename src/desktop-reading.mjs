import { expandWords, selectionKey } from "./core.mjs";

export function selectionType(a) {
  return (
    a?.selectionType ||
    (/^[A-Za-z]+(?:['’\-][A-Za-z]+)*$/.test(a?.quote || "")
      ? "word"
      : a?.quote?.trim() === a?.sentence?.quote?.trim()
        ? "sentence"
        : "phrase")
  );
}

// UTF-16 offsets, with conservative handling of common English abbreviations.
export function desktopSentence(text, offset) {
  const boundaries = [0];
  for (const m of text.matchAll(/[.!?]+["”’')\]]*(?=\s|$)/g)) {
    const before = text.slice(0, m.index + 1);
    if (
      m[0][0] === "." &&
      /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc)|\b[A-Z]|\b(?:e\.g|i\.e|U\.S))\.$/i.test(
        before,
      )
    )
      continue;
    boundaries.push(m.index + m[0].length);
  }
  if (boundaries.at(-1) !== text.length) boundaries.push(text.length);
  for (let i = 1; i < boundaries.length; i++) {
    let start = boundaries[i - 1],
      end = boundaries[i];
    while (/\s/.test(text[start] || "") && start < end) start++;
    if (offset >= start && offset < end)
      return { start, end, quote: text.slice(start, end) };
  }
  return null;
}
export function desktopRange(text, mode, start, end = start) {
  if (mode === "sentence")
    return expandWords(text, start, start)
      ? desktopSentence(text, start)
      : null;
  return expandWords(text, start, mode === "word" ? start : end);
}

export function readableParts(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value))
    return value.map(readableParts).filter(Boolean).join("\n");
  if (!value || typeof value !== "object") return "";
  return Object.entries(value)
    .filter(([k]) => !["id", "versionId"].includes(k))
    .map(([, v]) => readableParts(v))
    .filter(Boolean)
    .join(" · ");
}
export function conversation(lib, anchor) {
  return lib.results.filter(
    (r) =>
      r.task === "followup" && selectionKey(r.anchor) === selectionKey(anchor),
  );
}
export function conversationContext(lib, anchor) {
  return conversation(lib, anchor)
    .filter((r) => r.data && !r.error)
    .slice(-6)
    .map((r) => ({ question: r.question, answer: r.data.meaning_zh }));
}
