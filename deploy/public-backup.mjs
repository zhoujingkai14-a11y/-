import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const source = process.env.MINGDAN_DATABASE || '/data/mingdan-public.sqlite';
if (!existsSync(source)) throw new Error('Database does not exist; refusing to create an empty backup.');
const target = resolve(dirname(source), 'backups', `mingdan-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
if (existsSync(target)) throw new Error('Backup target already exists.');
mkdirSync(dirname(target), { recursive: true });
const database = new DatabaseSync(source);
try { database.exec('PRAGMA busy_timeout=5000'); database.prepare('VACUUM INTO ?').run(target); }
finally { database.close(); }
console.log(`Database backup created: ${target}`);
