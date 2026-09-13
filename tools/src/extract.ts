import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './lib/paths.ts';
import { isTranslatableFile, listPristineFiles, parseFile, readPristine, type StringSite } from './lib/sources.ts';

interface TrainerInfo {
  id: string;
  trainerClass: string;
  name: string;
  gender: 'F' | 'M';
  double: boolean;
}

interface Speaker {
  gfx?: string;
  gender?: 'F' | 'M' | 'nonhuman' | '?';
  trainer?: TrainerInfo;
  role?: 'sign' | 'trigger' | 'item';
}

export interface StringEntry {
  id: string;
  file: string;
  key: string;
  kind: string;
  en: string;
  maxBytes?: number;
  trivial?: boolean;
  map?: string;
  speakers?: Speaker[];
  usage?: string[];
}

const FEMALE_GFX = /WOMAN|GIRL|LASS|LADY|BEAUTY|TWIN|NURSE|MOM|MAY|AROMA|PICNICKER|_F\b|_F_|HEX_MANIAC|PARASOL|ROXANNE|FLANNERY|WINONA|LIZA|PHOEBE|GLACIA|TEALA|LANETTE|GABBY|LYDIA|MAID|GRANNY|REPORTER_F|SCHOOL_KID_F|POKEFAN_F|EXPERT_F|DANCER|CONTEST_JUDGE_F|GIRL|LADIES|WALLYS_MOM|RIVAL_MAY|LEAF|DAISY/;
const NONHUMAN_GFX = /ITEM_BALL|TRUCK|BOULDER|CUTTABLE|BREAKABLE|BERRY_TREE|ZIGZAGOON|KECLEON|DOLL|CUSHION|STATUE|MACHOKE|SKITTY|KYOGRE|GROUDON|RAYQUAZA|LATIAS|LATIOS|DEOXYS|LUGIA|HOOH|MEW|WINGULL|AZURILL|POOCHYENA|KIRLIA|DUSCLOPS|SUDOWOODO|AZUMARILL|SUBMARINE|SS_TIDAL|BIRTH_ISLAND|SPLASH|BIKE|TREE|ROCK|LIGHT|VAR_|PICHU|PIKACHU|MARILL|WOBBUFFET|GULPIN|MUDKIP|TORCHIC|TREECKO|FOSSIL|BALL|BOX|MAGNEMITE|PETALBURG_GYM|MINIMAP/;

const KIND_BY_FILE: [RegExp, string][] = [
  [/species_names\.h$/, 'species'],
  [/move_names\.h$/, 'move'],
  [/move_descriptions\.h$/, 'move_desc'],
  [/item_descriptions\.h$/, 'item_desc'],
  [/nature_names\.h$/, 'nature'],
  [/trainer_class_names\.h$/, 'trainer_class'],
  [/pokedex_text\.h$/, 'dex'],
  [/pokedex_entries\.h$/, 'dex_category'],
  [/easy_chat\//, 'easy_chat'],
  [/decoration\/header\.h$/, 'decoration'],
  [/battle_message\.c$/, 'battle'],
  [/battle_frontier_trainers\.h$|trainer_hill\.h$|battle_tent\.h$/, 'frontier_trainer'],
  [/region_map_sections\.json$/, 'location'],
  [/ribbon_descriptions\.h$/, 'ribbon_desc'],
  [/match_call/, 'match_call'],
  [/credits\.h$/, 'credits'],
  [/contest_opponents\.h$/, 'contest_opponent'],
  [/berry\.c$/, 'berry'],
];

const MAX_BYTES: Record<string, number> = {
  species: 12,
  dex_category: 11,
  move: 12,
  ability: 12,
  type: 8,
  trainer_class: 12,
  trainer_name: 10,
  item: 13,
  decoration: 19,
  location: 18,
  berry_name: 6,
  easy_chat: 11,
};

// Struct fields in frontier/contest tables are sized by PLAYER_NAME_LENGTH, TRAINER_NAME_LENGTH or the vanilla nickname length.
const FIELD_MAX_BYTES_BY_FILE: [RegExp, Record<string, number>][] = [
  [/battle_frontier_trainers\.h$|battle_tent\.h$/, { trainerName: 7 }],
  [/contest_opponents\.h$/, { trainerName: 7, nickname: 12, monName: 10 }],
  [/battle_frontier\/trainer_hill\.h$/, { name: 10, nickname: 10 }],
];

function classify(site: StringSite): { kind: string; maxBytes?: number } {
  let kind = site.format === 'inc' ? 'dialog' : 'ui';
  for (const [pattern, fileKind] of KIND_BY_FILE) if (pattern.test(site.file)) kind = fileKind;

  if (site.file.endsWith('abilities.h')) kind = site.key.startsWith('ABILITY_') ? 'ability' : 'ability_desc';
  if (site.file.endsWith('items.h')) kind = site.key.endsWith('.name') ? 'item' : 'ui';
  if (site.file.endsWith('trainers.h') && site.key.endsWith('.trainerName')) kind = 'trainer_name';
  if (site.file.endsWith('battle_main.c') && site.key.startsWith('TYPE_')) kind = 'type';
  if (kind === 'berry' && /^name(~\d+)?$/.test(site.key)) kind = 'berry_name';
  if (kind === 'decoration' && !site.key.endsWith('.name') && !site.key.startsWith('DECOR_')) kind = 'decoration_desc';

  const fieldLimits = FIELD_MAX_BYTES_BY_FILE.find(([pattern]) => pattern.test(site.file))?.[1];
  const fieldLimit = fieldLimits?.[site.key.slice(site.key.lastIndexOf('.') + 1).replace(/~\d+$/, '')];
  return { kind, maxBytes: fieldLimit ?? MAX_BYTES[kind] };
}

function isTrivial(en: string): boolean {
  const letters = en.replace(/\{[^}]*\}/g, '').replace(/\\./g, '').replace(/POKé|é/g, 'x');
  return !/[A-Za-z]{2}/.test(letters);
}

function parseTrainers(content: string): Map<string, TrainerInfo> {
  const trainers = new Map<string, TrainerInfo>();
  for (const block of content.split(/\n\s*\[(?=TRAINER_)/).slice(1)) {
    const id = block.slice(0, block.indexOf(']'));
    trainers.set(id, {
      id,
      trainerClass: /\.trainerClass = (\w+)/.exec(block)?.[1] ?? '',
      name: /\.trainerName = _\("([^"]*)"\)/.exec(block)?.[1] ?? '',
      gender: /F_TRAINER_FEMALE/.test(block) ? 'F' : 'M',
      double: /\.doubleBattle = TRUE/.test(block),
    });
  }
  return trainers;
}

function gfxGender(gfx: string): Speaker['gender'] {
  if (NONHUMAN_GFX.test(gfx)) return 'nonhuman';
  return FEMALE_GFX.test(gfx) ? 'F' : 'M';
}

interface ScriptBody {
  file: string;
  lines: string[];
}

function parseScripts(files: Map<string, string>): Map<string, ScriptBody> {
  const scripts = new Map<string, ScriptBody>();
  for (const [file, content] of files) {
    let current: ScriptBody | null = null;
    for (const line of content.split('\n')) {
      const label = /^([A-Za-z_]\w*)::?\s*(?:@.*)?$/.exec(line);
      if (label) {
        current = { file, lines: [] };
        scripts.set(label[1], current);
      } else if (current && !/^\s*\.string/.test(line)) {
        current.lines.push(line.replace(/@.*$/, '').trim());
      }
    }
  }
  return scripts;
}

function mapNameOf(file: string): string {
  const mapMatch = /^data\/maps\/([^/]+)\//.exec(file);
  if (mapMatch) return mapMatch[1];
  return path.basename(file).replace(/\.\w+$/, '');
}

function main(): void {
  const files = listPristineFiles().filter(isTranslatableFile);
  const contents = new Map(files.map((file) => [file, readPristine(file)]));
  const sites = files.flatMap((file) => parseFile(file, contents.get(file)!));

  const trainers = parseTrainers(contents.get('src/data/trainers.h')!);
  const incFiles = new Map([...contents].filter(([file]) => file.endsWith('.inc')));
  const scripts = parseScripts(incFiles);
  const textLabels = new Set(sites.filter((site) => site.format === 'inc').map((site) => site.label!));

  const speakersByScript = new Map<string, Speaker[]>();
  const addSpeaker = (script: string, speaker: Speaker) => {
    const list = speakersByScript.get(script) ?? [];
    if (!list.some((existing) => JSON.stringify(existing) === JSON.stringify(speaker))) list.push(speaker);
    speakersByScript.set(script, list);
  };

  for (const file of listPristineFiles().filter((f) => /^data\/maps\/[^/]+\/map\.json$/.test(f))) {
    const map = JSON.parse(readPristine(file)) as {
      object_events?: { graphics_id: string; script: string }[];
      bg_events?: { type: string; script?: string }[];
      coord_events?: { script?: string }[];
    };
    for (const object of map.object_events ?? []) {
      if (object.script && object.script !== '0x0') addSpeaker(object.script, { gfx: object.graphics_id, gender: gfxGender(object.graphics_id) });
    }
    for (const bg of map.bg_events ?? []) if (bg.script) addSpeaker(bg.script, { role: 'sign' });
    for (const coord of map.coord_events ?? []) if (coord.script && coord.script !== '0x0') addSpeaker(coord.script, { role: 'trigger' });
  }

  const callees = new Map<string, string[]>();
  const textUsage = new Map<string, { script: string; command: string; trainer?: string }[]>();
  for (const [script, body] of scripts) {
    for (const line of body.lines) {
      const tokens = line.split(/[\s,()]+/).filter(Boolean);
      const command = tokens[0] ?? '';
      for (const token of tokens.slice(1)) {
        if (textLabels.has(token)) {
          const usage = textUsage.get(token) ?? [];
          usage.push({ script, command, trainer: command.startsWith('trainerbattle') ? tokens[1] : undefined });
          textUsage.set(token, usage);
        } else if (scripts.has(token) && token !== script) {
          callees.set(script, [...(callees.get(script) ?? []), token]);
        }
      }
    }
  }

  const MAX_DEPTH = 6;
  for (const [root, rootSpeakers] of [...speakersByScript]) {
    const queue: [string, number][] = [[root, 0]];
    const visited = new Set([root]);
    while (queue.length) {
      const [script, depth] = queue.shift()!;
      for (const callee of callees.get(script) ?? []) {
        if (visited.has(callee) || depth >= MAX_DEPTH) continue;
        visited.add(callee);
        if (!speakersByScript.has(callee) || callee.includes('Common_') === false) rootSpeakers.forEach((speaker) => addSpeaker(callee, speaker));
        queue.push([callee, depth + 1]);
      }
    }
  }

  const entries: StringEntry[] = sites
    .filter((site) => site.en.replace(/\$$/, '').length > 0)
    .map((site) => {
      const { kind, maxBytes } = classify(site);
      const entry: StringEntry = { id: site.id, file: site.file, key: site.key, kind, en: site.en };
      if (maxBytes) entry.maxBytes = maxBytes;
      if (isTrivial(site.en)) entry.trivial = true;
      if (site.format === 'inc') {
        entry.map = mapNameOf(site.file);
        const usages = textUsage.get(site.label!) ?? [];
        const speakers: Speaker[] = [];
        for (const usage of usages) {
          const trainer = usage.trainer ? trainers.get(usage.trainer) : undefined;
          if (trainer) speakers.push({ trainer });
          else for (const speaker of speakersByScript.get(usage.script) ?? []) speakers.push(speaker);
        }
        const unique = [...new Map(speakers.map((speaker) => [JSON.stringify(speaker), speaker])).values()].slice(0, 6);
        if (unique.length) entry.speakers = unique;
        if (usages.length) entry.usage = [...new Set(usages.map((usage) => `${usage.command} in ${usage.script}`))].slice(0, 4);
      }
      if (site.file.endsWith('trainers.h')) {
        const trainer = trainers.get(site.key.replace(/\.trainerName$/, ''));
        if (trainer) entry.speakers = [{ trainer }];
      }
      return entry;
    });

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(path.join(DATA_DIR, 'strings.jsonl'), entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n');

  const byKind = new Map<string, { count: number; chars: number }>();
  for (const entry of entries) {
    const stat = byKind.get(entry.kind) ?? { count: 0, chars: 0 };
    stat.count++;
    stat.chars += entry.trivial ? 0 : entry.en.length;
    byKind.set(entry.kind, stat);
  }
  console.log(`${entries.length} strings (${entries.filter((e) => e.trivial).length} trivial)`);
  for (const [kind, stat] of [...byKind].sort((a, b) => b[1].chars - a[1].chars)) console.log(kind.padEnd(18), stat.count, stat.chars);
}

main();
