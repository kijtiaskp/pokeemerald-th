import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './lib/paths.ts';
import { byteLength, loadCharmap, tokenize, type Charmap } from './lib/charmap.ts';

export interface Translation {
  id: string;
  th: string;
}

interface SourceEntry {
  id: string;
  kind: string;
  en: string;
  maxBytes?: number;
  trivial?: boolean;
}

export interface Issue {
  id: string;
  level: 'error' | 'warning';
  message: string;
}

const REFLOWED_KINDS = new Set(['dialog', 'match_call']);
const FORBIDDEN_CHARS = new Set(['ฃ', 'ฅ', 'ฦ', '฿', '"']);

export function readJsonl<T>(file: string): T[] {
  return readFileSync(file, 'utf8').split('\n').filter((line) => line.trim()).map((line, i) => {
    try {
      return JSON.parse(line) as T;
    } catch {
      throw new Error(`${file}:${i + 1}: invalid JSON`);
    }
  });
}

export function loadSourceEntries(): Map<string, SourceEntry> {
  return new Map(readJsonl<SourceEntry>(path.join(DATA_DIR, 'strings.jsonl')).map((entry) => [entry.id, entry]));
}

// Glyph constants that only draw English logos; Thai text may drop them.
const OPTIONAL_GLYPH_CONSTANTS = new Set(['{PKMN}', '{PK}', '{MN}', '{POKEBLOCK}', '{SUPER_E}', '{SUPER_ER}', '{SUPER_RE}']);

function placeholders(text: string): string[] {
  return (text.match(/\{[^}]*\}/g) ?? []).filter((token) => !OPTIONAL_GLYPH_CONSTANTS.has(token)).sort();
}

export function validateTranslation(translation: Translation, source: SourceEntry | undefined, charmap: Charmap): Issue[] {
  const issues: Issue[] = [];
  const add = (level: Issue['level'], message: string) => issues.push({ id: translation.id, level, message });
  if (!source) return [{ id: translation.id, level: 'error', message: 'unknown id' }];
  const { th } = translation;
  if (typeof th !== 'string' || (th.length === 0 && source.en.length > 0)) add('error', 'empty translation');

  const unknown = tokenize(th, charmap).filter((token) => token.type === 'unknown').map((token) => token.text);
  const forbidden = [...th.replace(/\{[^}]*\}/g, '').replace(/\\"/g, '')].filter((char) => FORBIDDEN_CHARS.has(char));
  if (unknown.length || forbidden.length) add('error', `unsupported characters: ${[...new Set([...unknown, ...forbidden])].join(' ')}`);

  const expected = placeholders(source.en).join(' ');
  const actual = placeholders(th).join(' ');
  if (expected !== actual) add('error', `placeholders differ: expected [${expected}] got [${actual}]`);

  const endsWithTerminator = source.en.endsWith('$');
  if (endsWithTerminator !== th.endsWith('$') || th.slice(0, -1).includes('$')) add('error', 'string terminator $ mismatch');

  if (source.maxBytes && byteLength(th, charmap) > source.maxBytes) add('error', `too long: ${byteLength(th, charmap)} > ${source.maxBytes} bytes`);
  if (REFLOWED_KINDS.has(source.kind) && /\\[nl]/.test(th)) add('warning', 'manual \\n or \\l in reflowed text');
  if (/[A-Z]{4,}/.test(th.replace(/\{[^}]*\}/g, '')) && !/[A-Z]{4,}/.test(source.en.replace(/\{[^}]*\}|POKé\w*|[A-Z]{4,}/g, (m) => (m.startsWith('{') ? '' : m)))) {
    add('warning', 'contains untranslated upper-case English');
  }
  return issues;
}

function main(): void {
  const files = process.argv.slice(2);
  if (files.length === 0) throw new Error('usage: validate.ts <translations.jsonl>...');
  const charmap = loadCharmap();
  const sources = loadSourceEntries();
  const issues: Issue[] = [];
  let total = 0;

  for (const file of files) {
    const translations = readJsonl<Translation>(file);
    total += translations.length;
    const seen = new Set<string>();
    for (const translation of translations) {
      if (seen.has(translation.id)) issues.push({ id: translation.id, level: 'error', message: 'duplicate id' });
      seen.add(translation.id);
      issues.push(...validateTranslation(translation, sources.get(translation.id), charmap));
    }
  }

  for (const issue of issues) console.log(`${issue.level.toUpperCase()} ${issue.id}: ${issue.message}`);
  const errors = issues.filter((issue) => issue.level === 'error').length;
  console.log(`${total} translations, ${errors} errors, ${issues.length - errors} warnings`);
  process.exitCode = errors ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
