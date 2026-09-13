import { execFileSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR, ROM_DIR } from './lib/paths.ts';
import { loadCharmap, type Charmap } from './lib/charmap.ts';
import { splitLines, textWidth } from './lib/metrics.ts';
import { reflowMessage, setProtectedWords, wrapParagraph } from './lib/reflow.ts';
import { loadGlossary } from './lib/glossary.ts';
import { MAP_SECTIONS_FILE, PRISTINE_REF, parseFile, readPristine, type StringSite } from './lib/sources.ts';
import { loadSourceEntries, readJsonl, validateTranslation, type Translation } from './validate.ts';

const MESSAGE_WIDTH = 208;
const POKENAV_WIDTH = 184;
const LAYOUT_TOKEN = /\{(CLEAR_TO|SHIFT_RIGHT|SHIFT_DOWN|CLEAR|SKIP_TO|FONT_\w+|FONT|MIN_LETTER_SPACING)\b/;
const PROSE_KINDS = new Set(['item_desc', 'move_desc', 'ability_desc', 'dex', 'ribbon_desc', 'decoration_desc']);

interface SourceEntry {
  id: string;
  kind: string;
  en: string;
}

interface ProseLimit {
  width: number;
  lines: number;
}

function proseLimits(sources: Map<string, SourceEntry>, charmap: Charmap): Map<string, ProseLimit> {
  const limits = new Map<string, ProseLimit>();
  for (const entry of sources.values()) {
    if (!PROSE_KINDS.has(entry.kind)) continue;
    const lines = splitLines(entry.en);
    const limit = limits.get(entry.kind) ?? { width: 0, lines: 0 };
    limit.width = Math.max(limit.width, ...lines.map((line) => textWidth(line, charmap)));
    limit.lines = Math.max(limit.lines, lines.length);
    limits.set(entry.kind, limit);
  }
  return limits;
}

function layoutTranslation(th: string, source: SourceEntry, limits: Map<string, ProseLimit>, charmap: Charmap, warn: (message: string) => void): string {
  if (LAYOUT_TOKEN.test(source.en)) return th;

  if (source.kind === 'dialog') return reflowMessage(th, { maxWidth: MESSAGE_WIDTH, continuation: 'scroll' }, charmap);
  if (source.kind === 'match_call') return reflowMessage(th, { maxWidth: POKENAV_WIDTH, continuation: 'scroll' }, charmap);
  if (source.kind === 'battle' && (/\\[np]/.test(source.en) || textWidth(th, charmap) > MESSAGE_WIDTH)) {
    return reflowMessage(th, { maxWidth: MESSAGE_WIDTH, continuation: 'paragraph' }, charmap);
  }

  const limit = limits.get(source.kind);
  if (limit) {
    const lines = wrapParagraph(th, limit.width, charmap);
    if (lines.length > limit.lines) warn(`needs ${lines.length} lines, window has ${limit.lines}`);
    return lines.join('\\n');
  }

  const englishWidth = Math.max(...splitLines(source.en).map((line) => textWidth(line, charmap)));
  const thaiWidth = Math.max(...splitLines(th).map((line) => textWidth(line, charmap)));
  if (thaiWidth > englishWidth + 12 && thaiWidth > 40) warn(`line width ${thaiWidth}px vs English ${englishWidth}px`);
  return th;
}

function formatInc(text: string): string[] {
  const segments = text.match(/(?:[^\\]|\\[^nlp])*(?:\\[nlp]|$)/g)!.filter((segment) => segment.length > 0);
  return segments.map((segment) => `\t.string "${segment}"`);
}

function applyToFile(file: string, sites: StringSite[], translated: Map<string, string>): string {
  const content = readPristine(file);
  if (file === MAP_SECTIONS_FILE) {
    const json = JSON.parse(content) as { map_sections: { id: string; name?: string }[] };
    for (const section of json.map_sections) {
      const th = translated.get(`${file}#${section.id}`);
      if (th !== undefined) section.name = th;
    }
    return JSON.stringify(json, null, 2) + '\n';
  }

  if (file.endsWith('.inc')) {
    const lines = content.split('\n');
    for (const site of [...sites].sort((a, b) => b.start - a.start)) {
      const th = translated.get(site.id);
      if (th !== undefined) lines.splice(site.start, site.end - site.start + 1, ...formatInc(th));
    }
    return lines.join('\n');
  }

  let output = content;
  for (const site of [...sites].sort((a, b) => b.start - a.start)) {
    const th = translated.get(site.id);
    if (th !== undefined) output = output.slice(0, site.start) + `_("${th}")` + output.slice(site.end);
  }
  return output;
}

function restore(files: string[]): void {
  if (files.length) execFileSync('git', ['-C', ROM_DIR, 'checkout', PRISTINE_REF, '--', ...files]);
}

function main(): void {
  const charmap = loadCharmap();
  const sources = loadSourceEntries();
  const translationDir = path.join(DATA_DIR, 'translations');
  const translations = readdirSync(translationDir)
    .filter((name) => name.endsWith('.jsonl'))
    .sort()
    .flatMap((name) => readJsonl<Translation>(path.join(translationDir, name)));

  const limits = proseLimits(sources, charmap);
  setProtectedWords(loadGlossary().flatMap((term) => term.th.split(/\s+/)));
  const translated = new Map<string, string>();
  const warnings: string[] = [];
  let rejected = 0;

  for (const translation of translations) {
    const source = sources.get(translation.id);
    const errors = validateTranslation(translation, source, charmap).filter((issue) => issue.level === 'error');
    if (errors.length || !source) {
      rejected++;
      warnings.push(...errors.map((issue) => `REJECTED ${issue.id}: ${issue.message}`));
      continue;
    }
    const warn = (message: string) => warnings.push(`LAYOUT ${translation.id}: ${message}`);
    translated.set(translation.id, layoutTranslation(translation.th, source, limits, charmap, warn));
  }

  const files = [...new Set([...translated.keys()].map((id) => id.slice(0, id.indexOf('#'))))];
  if (process.argv.includes('--restore')) {
    restore(files);
    console.log(`Restored ${files.length} files`);
    return;
  }

  for (const file of files) {
    const sites = parseFile(file, readPristine(file));
    writeFileSync(path.join(ROM_DIR, file), applyToFile(file, sites, translated));
  }

  writeFileSync(path.join(DATA_DIR, 'insert-report.txt'), warnings.join('\n') + '\n');
  console.log(`Inserted ${translated.size} strings into ${files.length} files (${rejected} rejected, ${warnings.length - rejected} layout warnings; see data/insert-report.txt)`);
}

main();
