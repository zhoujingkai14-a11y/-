import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const skippedDirectories = new Set(['.git', 'node_modules', '.next', '.vinext', '.wrangler', '.sites-runtime', '.openai', '.agents', '.codex', '.impeccable', 'dist', 'runtime', 'outputs']);
const sensitiveDirectories = new Set([...skippedDirectories].filter(name => name !== '.git'));
const patterns = [
  ['provider-api-key', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b/g],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/g],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g],
  ['credential-in-url', /https?:\/\/[^\s/"'<>:@]+:[^\s/"'<>@]+@/g],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/g]
];

export function forbiddenPath(path) {
  const parts = path.replaceAll('\\', '/').split('/');
  const name = parts.at(-1);
  if (parts.some(part => sensitiveDirectories.has(part))) return true;
  if (/^(?:\.env(?:\..*)?|\.dev\.vars.*|local\.settings\.json)$/i.test(name) && !['.env.example', '.env.test.example'].includes(name)) return true;
  return /\.(?:sqlite(?:-shm|-wal)?|db|log|pem|key|p12|pfx|zip|bak|tsbuildinfo)$/i.test(name);
}

function runGit(root, args, buffer = false) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: buffer ? undefined : 'utf8', maxBuffer: 512 * 1024 * 1024, windowsHide: true });
  if (result.status !== 0) throw new Error('Git inspection failed.');
  return result.stdout;
}

export function scanContent(content, location, knownSecrets = []) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const findings = [];
  const add = (rule, offset) => {
    const line = bytes.subarray(0, offset).toString('utf8').split('\n').length;
    if (!findings.some(item => item.rule === rule && item.line === line)) findings.push({ rule, location, line });
  };
  for (const secret of knownSecrets) {
    if (secret.length < 8) continue;
    for (const value of new Set([secret, Buffer.from(secret).toString('base64'), encodeURIComponent(secret)])) {
      const position = bytes.indexOf(Buffer.from(value));
      if (position >= 0) add('known-private-credential', position);
    }
  }
  if (bytes.includes(0) || bytes.length > 8 * 1024 * 1024) return findings;
  const text = bytes.toString('utf8');
  for (const [rule, pattern] of patterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) add(rule, Buffer.byteLength(text.slice(0, match.index)));
  }
  return findings;
}

export function loadKnownSecrets(root) {
  const secrets = new Set();
  const sources = [resolve(root, '.env'), resolve(root, 'local.settings.json'), resolve(root, 'sites-mingdan/.dev.vars')];
  const tools = resolve(root, 'runtime/tools');
  if (existsSync(tools)) for (const name of readdirSync(tools)) if (/owner|credential|private/i.test(name) && name.endsWith('.json')) sources.push(resolve(tools, name));
  const visit = value => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (/key|password|secret|token/i.test(key) && typeof item === 'string' && item.length >= 8 && item !== 'test-only-long-password') secrets.add(item);
      else visit(item);
    }
  };
  for (const file of sources.filter(existsSync)) {
    const text = readFileSync(file, 'utf8');
    if (file.endsWith('.json')) { try { visit(JSON.parse(text)); } catch { throw new Error('Private configuration could not be inspected.'); } }
    else for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z_]*(?:KEY|PASSWORD|SECRET|TOKEN)[A-Z_]*)\s*=\s*(.*?)\s*$/);
      if (match) { const value = match[2].replace(/^(['"])(.*)\1$/, '$2'); if (value.length >= 8 && value !== 'test-only-long-password') secrets.add(value); }
    }
  }
  return [...secrets];
}

export function inspectTree(root, { release = false, knownSecrets = [], tracked = false } = {}) {
  const files = [], findings = [], privateFiles = [], errors = [], notices = [];
  const trackedPaths = tracked ? new Set(runGit(root, ['ls-files', '-z']).split('\0').filter(Boolean)) : null;
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = resolve(directory, entry.name), path = relative(root, absolute).replaceAll('\\', '/');
      if (entry.isSymbolicLink() || lstatSync(absolute).isSymbolicLink()) { errors.push({ rule: 'symbolic-link', location: path }); continue; }
      if (entry.isDirectory()) {
        if (skippedDirectories.has(entry.name)) { if (release && entry.name !== '.git' && !tracked) errors.push({ rule: 'private-directory', location: path }); continue; }
        visit(absolute);
      } else if (entry.isFile()) {
        if (trackedPaths && !trackedPaths.has(path)) continue;
        const content = readFileSync(absolute), matches = scanContent(content, path, knownSecrets);
        files.push(path);
        if (forbiddenPath(path)) {
          privateFiles.push({ location: path, credentialMatches: matches.length });
          if (release) errors.push({ rule: 'private-file', location: path });
        } else findings.push(...matches);
        if (!content.includes(0)) {
          const text = content.toString('utf8');
          if (/(?:https?:\/\/[^\s"'<>]+\.chatgpt\.site|appgprj_[a-f0-9]{16,}|[A-Za-z]:[\\/](?:Users|文档)[\\/])/.test(text)) notices.push({ rule: 'deployment-or-local-metadata', location: path });
          if (release && /(?:https?:\/\/[^\s"'<>]+\.chatgpt\.site|appgprj_[a-f0-9]{16,})/.test(text)) errors.push({ rule: 'private-deployment-metadata', location: path });
          if (release && /[A-Za-z]:[\\/](?:Users|文档)[\\/]/.test(text)) errors.push({ rule: 'personal-local-path', location: path });
        }
      }
    }
  }
  visit(resolve(root));
  if (release) for (const name of ['README.md', 'LICENSE', 'SECURITY.md', 'CONTRIBUTING.md', 'THIRD_PARTY_NOTICES.md', '.gitignore', 'package.json']) if (!existsSync(resolve(root, name))) errors.push({ rule: 'missing-release-file', location: name });
  return { fileCount: files.length, files: files.sort(), findings, privateFiles, errors, notices };
}

export function inspectGit(root, knownSecrets = []) {
  if (!existsSync(resolve(root, '.git'))) return { present: false };
  const commitCount = Number(runGit(root, ['rev-list', '--all', '--count']).trim());
  const trackedFiles = runGit(root, ['ls-files', '-z']).split('\0').filter(Boolean);
  const privateTracked = trackedFiles.filter(forbiddenPath);
  const objectLines = runGit(root, ['cat-file', '--batch-all-objects', '--batch-check=%(objectname) %(objecttype) %(objectsize)']).split('\n').filter(Boolean);
  const findings = [], largeObjects = [];
  let blobCount = 0, commitObjects = 0;
  for (const line of objectLines) {
    const [oid, type, length] = line.trim().split(' ');
    if (!['blob', 'commit', 'tag'].includes(type)) continue;
    if (Number(length) > 256 * 1024 * 1024) { largeObjects.push({ oid, type, bytes: Number(length) }); continue; }
    const content = runGit(root, ['cat-file', type, oid], true);
    findings.push(...scanContent(content, `git-${type}:${oid}`, knownSecrets));
    if (type === 'blob') blobCount++; else commitObjects++;
  }
  return { present: true, commitCount, trackedFileCount: trackedFiles.length, privateTracked, objectCount: objectLines.length, blobCount, commitObjects, findings, uninspectedLargeObjects: largeObjects };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), root = resolve(args.find(value => !value.startsWith('--')) || process.cwd());
    const release = args.includes('--release'), workspace = args.includes('--workspace');
    const knownSecrets = loadKnownSecrets(root);
    const tree = inspectTree(root, { release, knownSecrets, tracked: args.includes('--git') });
    const repositories = args.includes('--history') || args.includes('--git') ? [root, ...(workspace && existsSync(resolve(root, 'sites-mingdan/.git')) ? [resolve(root, 'sites-mingdan')] : [])].map(path => ({ repository: relative(root, path).replaceAll('\\', '/') || '.', ...inspectGit(path, knownSecrets) })) : [];
    const report = { inspectedAt: new Date().toISOString(), scope: workspace ? 'workspace-and-existing-history' : 'publication-tree', knownCredentialsCompared: knownSecrets.length,
      tree, repositories, limitations: ['Pattern scanning cannot prove the absence of every possible secret.', 'Images require visual review; no customer database is included in a publication tree.', 'Known private credential values are compared without recording their values.', 'The documented public test fixture password is not treated as a private credential; it must not be used for a production administrator.'] };
    const index = args.indexOf('--report');
    if (index >= 0) writeFileSync(resolve(args[index + 1]), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    const blocked = tree.findings.length || tree.errors.length || repositories.some(repo => repo.findings?.length || repo.privateTracked?.length || repo.uninspectedLargeObjects?.length);
    console.log(JSON.stringify({ status: blocked ? 'blocked' : 'passed', fileCount: tree.fileCount, findings: tree.findings, errors: tree.errors, privateFileCount: tree.privateFiles.length,
      metadataNotices: tree.notices, repositories }, null, 2));
    if (blocked) process.exitCode = 1;
  } catch { console.error('Publication inspection failed; no file contents or credential values were printed.'); process.exitCode = 2; }
}
