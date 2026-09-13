import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { TOOLS_DIR } from './lib/paths.ts';

const QA_DIR = path.join(TOOLS_DIR, 'qa');
const COMMAND_FILE = path.join(QA_DIR, 'command.txt');
const STATUS_FILE = path.join(QA_DIR, 'status.txt');
const TIMEOUT_MS = 180_000;

// Usage: node src/qa.ts "press A" "wait 60" "shot /abs/path.png" ...
async function main(): Promise<void> {
  const commands = process.argv.slice(2);
  const sequence = Date.now().toString(36);
  writeFileSync(COMMAND_FILE, [`#${sequence}`, ...commands].join('\n') + '\n');
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (existsSync(STATUS_FILE) && readFileSync(STATUS_FILE, 'utf8').trim() === `done ${sequence}`) {
      console.log(`done ${sequence}`);
      return;
    }
    await delay(250);
  }
  throw new Error('mGBA harness did not respond; is qa/harness.lua loaded?');
}

await main();
