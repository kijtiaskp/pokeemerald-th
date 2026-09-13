import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROM_DIR } from './paths.ts';

export const PRISTINE_REF = 'thai-engine';

export interface StringSite {
  id: string;
  file: string;
  key: string;
  format: 'inc' | 'c' | 'json';
  en: string;
  start: number;
  end: number;
  label?: string;
}

const INC_LABEL = /^([A-Za-z_]\w*)::?\s*(?:@.*)?$/;
const INC_STRING = /^\s*\.string\s+"((?:[^"\\]|\\.)*)"\s*(?:@.*)?$/;
const C_STRING = /(?<![\w])_\(\s*((?:"(?:[^"\\]|\\.)*"\s*)+)\)/g;
const C_LITERAL = /"((?:[^"\\]|\\.)*)"/g;

export function readPristine(file: string): string {
  return execFileSync('git', ['-C', ROM_DIR, 'show', `${PRISTINE_REF}:${file}`], { encoding: 'utf8', maxBuffer: 64 << 20 });
}

export function listPristineFiles(): string[] {
  return execFileSync('git', ['-C', ROM_DIR, 'ls-tree', '-r', '--name-only', PRISTINE_REF], { encoding: 'utf8', maxBuffer: 64 << 20 })
    .split('\n')
    .filter(Boolean);
}

export function readWorking(file: string): string {
  return readFileSync(path.join(ROM_DIR, file), 'utf8');
}

function uniqueKey(seen: Map<string, number>, key: string): string {
  const count = (seen.get(key) ?? 0) + 1;
  seen.set(key, count);
  return count === 1 ? key : `${key}~${count}`;
}

// Offsets are line indices for .inc files: [start, end] inclusive.
export function parseIncStrings(file: string, content: string): StringSite[] {
  const lines = content.split('\n');
  const sites: StringSite[] = [];
  const seen = new Map<string, number>();
  let label = `${path.basename(file)}@top`;
  let block: { start: number; parts: string[] } | null = null;

  const flush = (end: number) => {
    if (!block) return;
    const key = uniqueKey(seen, label);
    sites.push({ id: `${file}#${key}`, file, key, format: 'inc', en: block.parts.join(''), start: block.start, end, label });
    block = null;
  };

  lines.forEach((line, i) => {
    const labelMatch = INC_LABEL.exec(line);
    if (labelMatch) {
      flush(i - 1);
      label = labelMatch[1];
      return;
    }
    const stringMatch = INC_STRING.exec(line);
    if (stringMatch) {
      block ??= { start: i, parts: [] };
      block.parts.push(stringMatch[1]);
    } else {
      flush(i - 1);
    }
  });
  flush(lines.length - 1);
  return sites;
}

function cStringKey(content: string, index: number): string | null {
  const lineStart = content.lastIndexOf('\n', index) + 1;
  const prefix = content.slice(lineStart, index);

  const designator = /\[\s*(\w+)\s*\]\s*=\s*$/.exec(prefix);
  if (designator) return designator[1];

  const field = /\.(\w+)\s*=\s*$/.exec(prefix);
  if (field) {
    const before = content.slice(Math.max(0, lineStart - 4000), lineStart);
    const owners = [...before.matchAll(/\[\s*(\w+)\s*\]\s*=\s*\{?\s*$/gm)];
    const owner = owners.at(-1)?.[1];
    return owner ? `${owner}.${field[1]}` : field[1];
  }

  const variable = /(\w+)\s*(?:\[[^\]]*\]\s*)*=\s*$/.exec(prefix);
  if (variable) return variable[1];

  const previousLine = content.slice(content.lastIndexOf('\n', lineStart - 2) + 1, lineStart);
  const variableAbove = /(\w+)\s*(?:\[[^\]]*\]\s*)*=\s*$/.exec(previousLine);
  return variableAbove ? variableAbove[1] : null;
}

// Offsets are character indices of the whole _(...) expression: [start, end).
export function parseCStrings(file: string, content: string): StringSite[] {
  const sites: StringSite[] = [];
  const seen = new Map<string, number>();
  let ordinal = 0;

  for (const match of content.matchAll(C_STRING)) {
    ordinal++;
    const en = [...match[1].matchAll(C_LITERAL)].map((literal) => literal[1]).join('');
    const key = uniqueKey(seen, cStringKey(content, match.index) ?? `@${ordinal}`);
    sites.push({ id: `${file}#${key}`, file, key, format: 'c', en, start: match.index, end: match.index + match[0].length });
  }
  return sites;
}

export const MAP_SECTIONS_FILE = 'src/data/region_map/region_map_sections.json';

export function parseMapSections(content: string): StringSite[] {
  const { map_sections: sections } = JSON.parse(content) as { map_sections: { id: string; name?: string }[] };
  return sections
    .filter((section) => section.name)
    .map((section) => ({
      id: `${MAP_SECTIONS_FILE}#${section.id}`,
      file: MAP_SECTIONS_FILE,
      key: section.id,
      format: 'json' as const,
      en: section.name!,
      start: 0,
      end: 0,
    }));
}

const EXCLUDED_C_FILES = [/^src\/data\/text\/braille\.h$/, /^tools\//, /^gflib\/.*debug/];

export function isTranslatableFile(file: string): boolean {
  if (EXCLUDED_C_FILES.some((pattern) => pattern.test(file))) return false;
  if (file === MAP_SECTIONS_FILE) return true;
  if (file.startsWith('data/') && file.endsWith('.inc')) return true;
  return /^(src|include)\/.*\.(c|h)$/.test(file);
}

export function parseFile(file: string, content: string): StringSite[] {
  if (file === MAP_SECTIONS_FILE) return parseMapSections(content);
  if (file.endsWith('.inc')) return parseIncStrings(file, content);
  return parseCStrings(file, content);
}
