import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { scanContent, forbiddenPath, inspectTree, inspectGit, loadKnownSecrets } from './check-publication.mjs';
import { createConfiguration } from './configure.mjs';

const temporary = () => mkdtempSync(resolve(tmpdir(), 'mingdan-publication-test-'));
function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, 'Git fixture operation must succeed.');
  return result.stdout;
}
function required(root) {
  for (const name of ['README.md', 'LICENSE', 'SECURITY.md', 'CONTRIBUTING.md', 'THIRD_PARTY_NOTICES.md', '.gitignore', 'package.json']) writeFileSync(resolve(root, name), 'Public fixture content\n');
}

test('secret findings identify rules and locations without disclosing credential values', () => {
  const key = ['sk', randomBytes(24).toString('hex')].join('-');
  const results = scanContent('header\n' + key, 'fixture.mjs', [key]);
  assert.ok(results.some(item => item.rule === 'known-private-credential'));
  assert.ok(results.some(item => item.rule === 'provider-api-key'));
  assert.equal(results[0].line, 2);
  assert.equal(JSON.stringify(results).includes(key), false);
});

test('known secrets are detected in binary data and encoded forms', () => {
  const secret = randomBytes(24).toString('base64url');
  for (const bytes of [Buffer.concat([Buffer.from([0, 1]), Buffer.from(secret)]), Buffer.from(Buffer.from(secret).toString('base64'))]) {
    assert.ok(scanContent(bytes, 'fixture', [secret]).some(item => item.rule === 'known-private-credential'));
  }
});

test('Git history inspection finds secrets that were removed from the current file', () => {
  const root = temporary(), key = ['sk', randomBytes(24).toString('hex')].join('-');
  git(root, ['init', '-b', 'main']);
  writeFileSync(resolve(root, 'fixture.txt'), key);
  git(root, ['add', 'fixture.txt']);
  git(root, ['-c', 'user.name=PublicationTest', '-c', 'user.email=publication@example.test', 'commit', '-m', 'Add generated fixture']);
  writeFileSync(resolve(root, 'fixture.txt'), 'Secret removed from the current file.');
  git(root, ['add', 'fixture.txt']);
  git(root, ['-c', 'user.name=PublicationTest', '-c', 'user.email=publication@example.test', 'commit', '-m', 'Replace generated fixture']);
  const result = inspectGit(root, [key]);
  assert.equal(result.commitCount, 2);
  assert.ok(result.findings.some(item => item.rule === 'known-private-credential'));
  assert.equal(JSON.stringify(result).includes(key), false);
});

test('the staged Git object is inspected before its first commit', () => {
  const root = temporary(), key = ['sk', randomBytes(24).toString('hex')].join('-');
  git(root, ['init', '-b', 'main']);
  writeFileSync(resolve(root, 'fixture.txt'), key);
  git(root, ['add', 'fixture.txt']);
  assert.ok(inspectGit(root, [key]).findings.some(item => item.rule === 'known-private-credential'));
});

test('private configuration, operational storage and platform artifacts are blocked', () => {
  for (const path of ['.env', '.dev.vars', 'local.settings.json', 'runtime/a.sqlite', 'outputs/report.json', '.openai/hosting.json', 'logs/app.log']) assert.equal(forbiddenPath(path), true, path);
  assert.equal(forbiddenPath('.env.example'), false);
  const root = temporary(); required(root);
  mkdirSync(resolve(root, 'runtime')); writeFileSync(resolve(root, 'runtime/customer.sqlite'), 'Private fixture');
  writeFileSync(resolve(root, '.env'), 'PRIVATE_FIXTURE=1');
  const result = inspectTree(root, { release: true });
  assert.ok(result.errors.some(item => item.rule === 'private-directory'));
  assert.ok(result.errors.some(item => item.rule === 'private-file'));
});

test('configured but ignored local files do not enter the Git publication tree', () => {
  const root = temporary(); required(root);
  writeFileSync(resolve(root, '.gitignore'), '.env\nruntime/\n');
  git(root, ['init', '-b', 'main']); git(root, ['add', '.']);
  writeFileSync(resolve(root, '.env'), 'PRIVATE_FIXTURE=1');
  mkdirSync(resolve(root, 'runtime')); writeFileSync(resolve(root, 'runtime/customer.sqlite'), 'Private fixture');
  const result = inspectTree(root, { release: true, tracked: true });
  assert.equal(result.errors.length, 0);
  assert.equal(result.files.includes('.env'), false);
  assert.equal(inspectGit(root).privateTracked.length, 0);
});

test('symbolic directory links cannot smuggle files into an export tree', () => {
  const root = temporary(), external = temporary(); required(root);
  symlinkSync(external, resolve(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.ok(inspectTree(root, { release: true }).errors.some(item => item.rule === 'symbolic-link'));
});

test('private local credentials are compared without returning them in findings', () => {
  const root = temporary(), password = randomBytes(32).toString('base64url');
  writeFileSync(resolve(root, '.env'), 'MINGDAN_ADMIN_PASSWORD=' + password + '\n');
  const secrets = loadKnownSecrets(root);
  assert.ok(secrets.includes(password));
  const result = scanContent(password, 'fixture.txt', secrets);
  assert.equal(JSON.stringify(result).includes(password), false);
});

test('valid short credentials and words resembling placeholders are still inspected', () => {
  const root = temporary(), shortKey = randomBytes(6).toString('base64url');
  const password = 'ExampleFixture' + randomBytes(20).toString('base64url');
  writeFileSync(resolve(root, '.env'), 'DEEPSEEK_API_KEY=' + shortKey + '\nMINGDAN_ADMIN_PASSWORD=' + password + '\n');
  const secrets = loadKnownSecrets(root);
  for (const secret of [shortKey, password]) {
    assert.ok(secrets.includes(secret));
    assert.ok(scanContent(secret, 'fixture.txt', secrets).some(item => item.rule === 'known-private-credential'));
  }
});

test('URI encoded credentials remain detectable without disclosing their values', () => {
  const secret = randomBytes(20).toString('base64') + '+/=';
  const results = scanContent(encodeURIComponent(secret), 'fixture.txt', [secret]);
  assert.ok(results.some(item => item.rule === 'known-private-credential'));
  assert.equal(JSON.stringify(results).includes(secret), false);
});

test('configuration generates distinct owner passwords and refuses to overwrite credentials', () => {
  const a = temporary(), b = temporary();
  for (const root of [a, b]) copyFileSync(new URL('../.env.example', import.meta.url), resolve(root, '.env.example'));
  assert.equal(createConfiguration(a).aiEnabled, false);
  createConfiguration(b);
  const before = readFileSync(resolve(a, '.env'), 'utf8');
  assert.notEqual(before, readFileSync(resolve(b, '.env'), 'utf8'));
  assert.match(before, /MINGDAN_ADMIN_PASSWORD=[A-Za-z0-9_-]{43}/);
  assert.throws(() => createConfiguration(a), /refusing to overwrite/);
  assert.equal(readFileSync(resolve(a, '.env'), 'utf8'), before);
});

test('configuration rejects line injection before creating a private file', () => {
  const root = temporary();
  copyFileSync(new URL('../.env.example', import.meta.url), resolve(root, '.env.example'));
  assert.throws(() => createConfiguration(root, 'fixture\nHOST=0.0.0.0'), /Invalid API key/);
  assert.equal(existsSync(resolve(root, '.env')), false);
});
