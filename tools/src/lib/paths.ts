import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const TOOLS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const PROJECT_DIR = path.resolve(TOOLS_DIR, '..');
export const ROM_DIR = path.join(PROJECT_DIR, 'rom');
export const DATA_DIR = path.join(TOOLS_DIR, 'data');
