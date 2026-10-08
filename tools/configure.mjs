import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function createConfiguration(directory, apiKey = '') {
  const path = resolve(directory, '.env');
  if (existsSync(path)) throw new Error('Configuration already exists; refusing to overwrite it.');
  const key = apiKey.trim();
  if (key && !/^[A-Za-z0-9_-]{8,}$/.test(key)) throw new Error('Invalid API key format.');
  const template = readFileSync(resolve(directory, '.env.example'), 'utf8');
  const content = template.replace(/^MINGDAN_ADMIN_PASSWORD=$/m, 'MINGDAN_ADMIN_PASSWORD=' + randomBytes(32).toString('base64url'))
    .replace(/^DEEPSEEK_API_KEY=$/m, 'DEEPSEEK_API_KEY=' + key);
  writeFileSync(path, content, { flag: 'wx', mode: 0o600 });
  return { configured: true, aiEnabled: Boolean(key) };
}
async function readPrivateKey() {
  if (!process.stdin.isTTY) throw new Error('Use an interactive terminal or pass --manual.');
  let muted = false;
  const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); } });
  const input = createInterface({ input: process.stdin, output, terminal: true });
  try {
    return await new Promise((resolve, reject) => {
      input.once('SIGINT', () => reject(new Error('Configuration cancelled.')));
      input.once('close', () => reject(new Error('Configuration cancelled.')));
      input.question('DeepSeek API key (hidden; blank for manual mode): ', value => { muted = false; process.stdout.write('\n'); resolve(value); });
      muted = true;
    });
  } finally { input.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (existsSync(resolve(root, '.env'))) throw new Error('Configuration already exists; edit your private .env locally.');
    const key = process.argv.includes('--manual') ? '' : await readPrivateKey();
    const result = createConfiguration(root, key);
    console.log('Private configuration created. Owner password is stored only in .env.');
    console.log(result.aiEnabled ? 'AI enabled with your own key. Run npm start.' : 'Manual mode enabled. Run npm start.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
