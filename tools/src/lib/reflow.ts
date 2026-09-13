import { textWidth } from './metrics.ts';
import type { Charmap } from './charmap.ts';

const segmenter = new Intl.Segmenter('th', { granularity: 'word' });
let protectedPattern: RegExp | null = null;

// Words that must never be split across lines (names the ICU dictionary does not know).
export function setProtectedWords(words: Iterable<string>): void {
  const unique = [...new Set([...words].filter((word) => word.length > 1 && /[\u0E00-\u0E7F]/.test(word)))];
  unique.sort((a, b) => b.length - a.length);
  const escaped = unique.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  protectedPattern = escaped.length ? new RegExp(`(${escaped.join('|')})`, 'g') : null;
}

function segmentWords(text: string): string[] {
  const parts = protectedPattern ? text.split(protectedPattern) : [text];
  return parts.flatMap((part, i) => (i % 2 === 1 ? [part] : [...segmenter.segment(part)].map(({ segment }) => segment)));
}
const NO_BREAK_BEFORE = /^([!?.,…”’)\]:;ๆฯ%]|\\")/;
const NO_BREAK_AFTER = /([“‘(\[]|\\")$/;

export interface ReflowOptions {
  maxWidth: number;
  continuation: 'scroll' | 'paragraph' | 'newline';
}

// Splits text into unbreakable atoms; a leading space marks a break opportunity that is dropped at line ends.
function atomize(paragraph: string): string[] {
  const pieces = paragraph.match(/\{[^}]*\}|\\.|[^{\\]+/g) ?? [];
  const atoms: string[] = [];
  for (const piece of pieces) {
    if (piece.startsWith('{') || piece.startsWith('\\')) {
      atoms.push(piece);
      continue;
    }
    atoms.push(...segmentWords(piece).filter((segment) => segment.length > 0));
  }

  const merged: string[] = [];
  for (const atom of atoms) {
    const previous = merged.at(-1);
    if (previous !== undefined && !/^\s+$/.test(atom) && !/^\s+$/.test(previous) && (NO_BREAK_BEFORE.test(atom) || NO_BREAK_AFTER.test(previous))) {
      merged[merged.length - 1] = previous + atom;
    } else {
      merged.push(atom);
    }
  }
  return merged;
}

export function wrapParagraph(paragraph: string, maxWidth: number, charmap: Charmap): string[] {
  const lines: string[] = [];
  let line = '';
  for (const atom of atomize(paragraph.replace(/\\[nl]/g, ' ').replace(/ {2,}/g, ' ').trim())) {
    if (/^\s+$/.test(atom)) {
      if (line) line += ' ';
      continue;
    }
    const candidate = line + atom;
    if (line && textWidth(candidate.trimEnd(), charmap) > maxWidth) {
      lines.push(line.trimEnd());
      line = atom;
    } else {
      line = candidate;
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}

// Re-breaks message-box text: two lines per box, extra lines scroll (\l) or open a new box (\p).
export function reflowMessage(text: string, options: ReflowOptions, charmap: Charmap): string {
  const terminated = text.endsWith('$');
  const body = terminated ? text.slice(0, -1) : text;
  const boxes = body.split('\\p').map((paragraph) => {
    const lines = wrapParagraph(paragraph, options.maxWidth, charmap);
    if (lines.length === 0) return '';
    if (options.continuation === 'newline') return lines.join('\\n');
    const pairs: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (i === 0) pairs.push(lines[i]);
      else if (i === 1) pairs.push('\\n' + lines[i]);
      else pairs.push((options.continuation === 'scroll' ? '\\l' : i % 2 === 0 ? '\\p' : '\\n') + lines[i]);
    }
    return pairs.join('');
  });
  return boxes.join('\\p') + (terminated ? '$' : '');
}
