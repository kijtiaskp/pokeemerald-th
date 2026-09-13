import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './lib/paths.ts';
import { readJsonl } from './validate.ts';
import { loadGlossary, type GlossaryTerm } from './lib/glossary.ts';

interface Entry {
  id: string;
  file: string;
  key: string;
  kind: string;
  en: string;
  trivial?: boolean;
  [field: string]: unknown;
}

const WORK_DIR = path.join(DATA_DIR, 'work');

const NAME_BATCHES: Record<string, (entry: Entry) => boolean> = {
  'names-species': (e) => e.kind === 'species' || e.kind === 'dex_category',
  'names-moves': (e) => ['move', 'ability', 'type', 'nature', 'trainer_class'].includes(e.kind),
  'names-items': (e) =>
    ['item', 'location'].includes(e.kind) ||
    e.kind === 'berry_name' ||
    (e.kind === 'decoration' && e.en.length <= 16),
  'names-people': (e) => ['trainer_name', 'frontier_trainer', 'contest_opponent'].includes(e.kind),
};

function writeBatch(name: string, entries: Entry[]): void {
  const rows = entries.filter((entry) => !entry.trivial).map(({ file: _file, key: _key, ...rest }) => rest);
  writeFileSync(path.join(WORK_DIR, `${name}.jsonl`), rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  console.log(`${name}: ${rows.length}`);
}

const TEXT_BATCH_CHARS = 48000;

function isNameEntry(entry: Entry): boolean {
  return Object.values(NAME_BATCHES).some((predicate) => predicate(entry));
}

function termAppears(term: GlossaryTerm, text: string): boolean {
  if (term.kind === 'characters') return true;
  const escaped = term.en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z])${escaped}($|[^A-Za-z])`).test(text);
}

function writeTextBatches(entries: Entry[]): void {
  const pending = entries.filter((entry) => !entry.trivial && !isNameEntry(entry));
  const byFile = new Map<string, Entry[]>();
  for (const entry of pending) byFile.set(entry.file, [...(byFile.get(entry.file) ?? []), entry]);

  const batches: Entry[][] = [];
  let current: Entry[] = [];
  let size = 0;
  const flush = () => {
    if (current.length) batches.push(current);
    current = [];
    size = 0;
  };
  for (const fileEntries of byFile.values()) {
    for (const entry of fileEntries) {
      if (size + entry.en.length > TEXT_BATCH_CHARS && size > TEXT_BATCH_CHARS * 0.6) flush();
      current.push(entry);
      size += entry.en.length;
    }
  }
  flush();

  const glossary = loadGlossary();
  batches.forEach((batch, index) => {
    const name = `text-${String(index + 1).padStart(2, '0')}`;
    writeBatch(name, batch);
    const english = batch.map((entry) => entry.en).join('\n');
    const terms = glossary.filter((term) => termAppears(term, english));
    const tsv = terms.map((term) => [term.en, term.th, term.kind, term.note ?? ''].join('\t')).join('\n');
    writeFileSync(path.join(WORK_DIR, `${name}.glossary.tsv`), 'en\tth\tkind\tnote\n' + tsv + '\n');
  });
}

function main(): void {
  const mode = process.argv[2];
  const entries = readJsonl<Entry>(path.join(DATA_DIR, 'strings.jsonl'));
  mkdirSync(WORK_DIR, { recursive: true });
  if (mode === 'names') {
    for (const [name, predicate] of Object.entries(NAME_BATCHES)) writeBatch(name, entries.filter(predicate));
    return;
  }
  if (mode === 'text') {
    writeTextBatches(entries);
    return;
  }
  throw new Error('usage: make-batches.ts names|text');
}

main();
