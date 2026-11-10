// 秘密情報の点検のテスト。一時的な git リポジトリを作って確かめる。
// キーの形の文字列は、このファイル自体が検出されないよう実行時に組み立てる。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSecretFiles, checkSecrets, identityWords } from '../scripts/check-secrets.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FAKE_KEY = ['sk', 'ant', 'a'.repeat(30)].join('-');
const GOOD_IGNORE = '.env\n.env.*\n!.env.example\n*.pem\n*.key\n';

function withRepo(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'hikitsugi-secrets-'));
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args], { cwd: dir, encoding: 'utf8' });
  try {
    git('init', '-q');
    writeFileSync(join(dir, '.gitignore'), GOOD_IGNORE);
    git('add', '.');
    git('commit', '-q', '-m', '最初');
    return fn(dir, git);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const has = (problems, text) => assert.ok(problems.some((p) => p.includes(text)), problems.join('\n') || '問題なし');

test('このリポジトリは点検に合格する', () => {
  assert.deepEqual(checkSecrets(ROOT), []);
});

test('問題のないリポジトリは合格する', () => {
  withRepo((dir) => assert.deepEqual(checkSecrets(dir), []));
});

test('.env が無視されていないと失敗する', () => {
  withRepo((dir) => {
    writeFileSync(join(dir, '.gitignore'), '*.pem\n*.key\n');
    has(checkSecrets(dir), '.gitignore で無視されていません: .env');
  });
});

test('.env を追跡すると失敗する', () => {
  withRepo((dir, git) => {
    writeFileSync(join(dir, '.env'), 'X=1\n');
    git('add', '-f', '.env');
    git('commit', '-q', '-m', '誤って追加');
    has(checkSecrets(dir), '追跡されています: .env');
  });
});

test('.env.example は追跡してよい', () => {
  withRepo((dir, git) => {
    writeFileSync(join(dir, '.env.example'), 'ANTHROPIC_API_KEY=\n');
    git('add', '.env.example');
    git('commit', '-q', '-m', '見本');
    assert.deepEqual(checkSecrets(dir), []);
  });
});

test('過去のコミットのキーは、消した後でも検出し、値は表示しない', () => {
  withRepo((dir, git) => {
    writeFileSync(join(dir, 'a.txt'), `${FAKE_KEY}\n`);
    git('add', '.');
    git('commit', '-q', '-m', '混入');
    writeFileSync(join(dir, 'a.txt'), 'なし\n');
    git('add', '.');
    git('commit', '-q', '-m', '削除');
    const problems = checkSecrets(dir);
    has(problems, 'コミット履歴に Anthropic の API キー');
    assert.ok(!problems.join('\n').includes(FAKE_KEY));
  });
});

test('未コミットの変更にあるキーも検出する', () => {
  withRepo((dir, git) => {
    writeFileSync(join(dir, 'a.txt'), 'なし\n');
    git('add', '.');
    git('commit', '-q', '-m', '追加');
    writeFileSync(join(dir, 'a.txt'), `${FAKE_KEY}\n`);
    has(checkSecrets(dir), '作業中の変更に Anthropic の API キー');
  });
});

// 実行した PC の名前の代わりに使う、架空のアカウント名と PC 名
const FAKE_PC = { account: 'zq-acct', host: 'ZQHOST-07.local' };

test('この PC のアカウント名と PC 名：履歴と作業中の変更に語として出てくれば失敗し、値は表示しない', () => {
  withRepo((dir, git) => {
    writeFileSync(join(dir, 'a.txt'), '更新した人：zq-acct\n');
    git('add', '.');
    git('commit', '-q', '-m', '混入');
    writeFileSync(join(dir, 'a.txt'), 'なし\n');
    git('add', '.');
    git('commit', '-q', '-m', '削除');
    const problems = checkSecrets(dir, { identity: FAKE_PC });
    has(problems, 'コミット履歴に PC のアカウント名の形があります');
    writeFileSync(join(dir, 'b.txt'), 'C:\\Users\\ZQHOST-07 で作りました\n');
    git('add', '.');
    has(checkSecrets(dir, { identity: FAKE_PC }), '作業中の変更に PC 名の形があります');
    assert.ok(!checkSecrets(dir, { identity: FAKE_PC }).join('\n').match(/zq-acct|ZQHOST/i), '値は表示しない');
  });
});

test('この PC のアカウント名と PC 名：別の語の一部には当たらない。短い名前とよくある名前は調べない', () => {
  withRepo((dir, git) => {
    writeFileSync(join(dir, 'a.txt'), 'git clone https://github.com/devzq-acct-cpu/x.git\nZQHOST-070\n');
    git('add', '.');
    git('commit', '-q', '-m', '似た語');
    assert.deepEqual(checkSecrets(dir, { identity: FAKE_PC }), []);
  });
  assert.deepEqual(identityWords({ account: 'ab', host: 'admin' }), { words: [], skipped: 2 });
  assert.equal(identityWords({ account: '田中', host: 'ZQHOST' }).skipped, 1, '日本語の名前は調べない');
});

test('書き出したファイルの点検（--files）でも、この PC のアカウント名と PC 名を見つける', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hikitsugi-secrets-files-'));
  try {
    mkdirSync(join(dir, 'phone'));
    writeFileSync(join(dir, 'manual.html'), '<p>OKJ-PC01</p>');
    writeFileSync(join(dir, 'phone', '00.html'), '<p>zqhost-07</p>');
    assert.deepEqual(checkSecretFiles([join(dir, 'manual.html')], { identity: FAKE_PC }), []);
    assert.deepEqual(checkSecretFiles([join(dir, 'phone')], { identity: FAKE_PC }), [`${join(dir, 'phone', '00.html')}: PC 名の形があります`]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
