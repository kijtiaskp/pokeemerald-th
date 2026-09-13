import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './paths.ts';
import { readJsonl } from '../validate.ts';

export interface GlossaryTerm {
  en: string;
  th: string;
  kind: string;
  note?: string;
}

const NAME_KINDS = new Set([
  'species', 'move', 'ability', 'type', 'nature', 'trainer_class', 'item', 'location', 'berry_name', 'decoration',
  'trainer_name', 'frontier_trainer', 'contest_opponent', 'dex_category',
]);

export function loadGlossary(): GlossaryTerm[] {
  const terms: GlossaryTerm[] = [];
  const glossaryDir = path.join(DATA_DIR, 'glossary');
  for (const name of readdirSync(glossaryDir).filter((file) => file.endsWith('.json'))) {
    const entries = JSON.parse(readFileSync(path.join(glossaryDir, name), 'utf8')) as { en: string; th: string; note?: string; voice?: string }[];
    for (const entry of entries) terms.push({ en: entry.en, th: entry.th, kind: name.replace(/\.json$/, ''), note: [entry.note, entry.voice].filter(Boolean).join(' | ') || undefined });
  }

  const sources = new Map(readJsonl<{ id: string; kind: string; en: string }>(path.join(DATA_DIR, 'strings.jsonl')).map((entry) => [entry.id, entry]));
  const translationDir = path.join(DATA_DIR, 'translations');
  if (!existsSync(translationDir)) return terms;
  for (const name of readdirSync(translationDir).filter((file) => file.startsWith('names-') && file.endsWith('.jsonl'))) {
    for (const { id, th } of readJsonl<{ id: string; th: string }>(path.join(translationDir, name))) {
      const source = sources.get(id);
      if (source && NAME_KINDS.has(source.kind) && source.en.trim()) terms.push({ en: source.en, th, kind: source.kind });
    }
  }
  return terms;
}
