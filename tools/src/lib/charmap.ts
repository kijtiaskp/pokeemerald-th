import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROM_DIR } from './paths.ts';

export interface Charmap {
  chars: Map<string, number[]>;
  constants: Map<string, number[]>;
}

const THAI_SARA_AM = 'ำ';
const THAI_NIKHAHIT = 'ํ';
const THAI_SARA_AA = 'า';

function parseBytes(text: string): number[] {
  return text.trim().split(/\s+/).map((byte) => parseInt(byte, 16));
}

export function loadCharmap(): Charmap {
  const chars = new Map<string, number[]>();
  const constants = new Map<string, number[]>();
  for (const rawLine of readFileSync(path.join(ROM_DIR, 'charmap.txt'), 'utf8').split('\n')) {
    const line = rawLine.replace(/\s@.*$/, '');
    const charEntry = /^'(.+)'\s*=\s*([0-9A-F ]+)$/.exec(line);
    if (charEntry) {
      const char = charEntry[1] === "\\'" ? "'" : charEntry[1];
      if (!chars.has(char)) chars.set(char, parseBytes(charEntry[2]));
      continue;
    }
    const constant = /^(\w+)\s*=\s*([0-9A-F ]+)$/.exec(line);
    if (constant) constants.set(constant[1], parseBytes(constant[2]));
  }
  const nikhahit = chars.get(THAI_NIKHAHIT);
  const saraAa = chars.get(THAI_SARA_AA);
  if (nikhahit && saraAa) chars.set(THAI_SARA_AM, [...nikhahit, ...saraAa]);
  return { chars, constants };
}

export type Token =
  | { type: 'char'; text: string; bytes: number[] }
  | { type: 'escape'; text: string; bytes: number[] }
  | { type: 'constant'; text: string; name: string; bytes: number[] }
  | { type: 'unknown'; text: string };

// Tokenizes source-level string text (as written inside .string "" or _("")).
export function tokenize(text: string, charmap: Charmap): Token[] {
  const tokens: Token[] = [];
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (char === '{') {
      const close = chars.indexOf('}', i);
      const inner = chars.slice(i + 1, close).join('');
      const words = inner.trim().split(/\s+/);
      const bytes = words.flatMap((word) => charmap.constants.get(word) ?? (/^(0x)?[0-9A-Fa-f]+$/.test(word) ? [parseInt(word, word.startsWith('0x') ? 16 : 10)] : [NaN]));
      const text = chars.slice(i, close + 1).join('');
      tokens.push(bytes.some(Number.isNaN) ? { type: 'unknown', text } : { type: 'constant', text, name: words[0], bytes });
      i = close;
    } else if (char === '\\') {
      const escape = '\\' + chars[i + 1];
      const bytes = charmap.chars.get(escape) ?? (chars[i + 1] === '"' ? charmap.chars.get('"') : undefined);
      tokens.push(bytes ? { type: 'escape', text: escape, bytes } : { type: 'unknown', text: escape });
      i++;
    } else {
      const bytes = charmap.chars.get(char);
      tokens.push(bytes ? { type: 'char', text: char, bytes } : { type: 'unknown', text: char });
    }
  }
  return tokens;
}

export function byteLength(text: string, charmap: Charmap): number {
  return tokenize(text, charmap).reduce((sum, token) => sum + ('bytes' in token ? token.bytes.length : 1), 0);
}
