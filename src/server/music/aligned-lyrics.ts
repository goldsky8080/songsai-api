import type { ProviderAlignedLyricWord } from "./types";

export type AlignedLyricLine = {
  text: string;
  start_s: number;
  end_s: number;
};

function splitWordWithTiming(word: ProviderAlignedLyricWord) {
  const parts = word.word.split(/(\n+)/);
  const textLengths = parts.map((part) => (part.includes("\n") ? 0 : part.length));
  const totalTextLength = textLengths.reduce((sum, length) => sum + length, 0);
  const totalDuration = Math.max(word.end_s - word.start_s, 0);
  let cursor = word.start_s;

  return parts.map((part, index) => {
    if (part.includes("\n")) {
      return {
        type: "newline" as const,
        value: part,
        start_s: cursor,
        end_s: cursor,
      };
    }

    const length = textLengths[index] ?? 0;
    const duration = totalTextLength > 0 ? (totalDuration * length) / totalTextLength : 0;
    const start_s = cursor;
    const end_s = index === parts.length - 1 ? word.end_s : cursor + duration;
    cursor = end_s;

    return {
      type: "text" as const,
      value: part,
      start_s,
      end_s,
    };
  });
}

export function buildAlignedLyricLines(words: ProviderAlignedLyricWord[]): AlignedLyricLine[] {
  const lines: AlignedLyricLine[] = [];
  let currentText = "";
  let currentStart: number | null = null;
  let currentEnd: number | null = null;

  const flush = () => {
    const text = currentText.replace(/\s+/g, " ").trim();

    if (text && !/^\[[^\]]+\]$/.test(text) && currentStart !== null && currentEnd !== null) {
      lines.push({
        text,
        start_s: currentStart,
        end_s: currentEnd,
      });
    }

    currentText = "";
    currentStart = null;
    currentEnd = null;
  };

  for (const word of words) {
    const chunks = splitWordWithTiming(word);

    for (const chunk of chunks) {
      if (chunk.type === "newline") {
        flush();
        continue;
      }

      const normalized = chunk.value.replace(/\s+/g, " ");
      if (!normalized.trim()) {
        continue;
      }

      if (currentStart === null) {
        currentStart = chunk.start_s;
      }

      currentText += normalized;
      currentEnd = chunk.end_s;
    }
  }

  flush();

  return lines;
}
