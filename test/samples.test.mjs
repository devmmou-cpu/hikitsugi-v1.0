// README からリンクするサンプル。架空の形式の番号とドメインだけで、表示の検査に通ること。

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { manualHtmlProblems } from '../scripts/hooks/check-manual-html.mjs';
import { countsTable, sampleCounts } from '../scripts/sample-counts.mjs';

const root = new URL('../samples/okojo/', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');

test('PC 用と束のサンプルは HTML の検査に通る', () => {
  assert.deepEqual(manualHtmlProblems(read('manual.html')), []);
  for (const name of readdirSync(new URL('phone/', root))) assert.deepEqual(manualHtmlProblems(read(`phone/${name}`)), [], name);
});

test('更新用のデータは架空の形式の番号とドメインだけ', () => {
  const data = read('manual.json');
  for (const phone of data.match(/(?<![\d-])0\d{0,4}-\d{1,4}-\d{3,4}(?![\d-])/g) ?? []) assert.match(phone, /^03-0000-01\d{2}$/);
  for (const domain of data.match(/[a-z0-9-]+\.(?:com|net|org|jp|co\.jp)\b/g) ?? []) assert.fail(`実在の形式のドメイン：${domain}`);
  assert.doesNotMatch(data, /パスワードは[^の、。]{4,}/);
});

test('README からサンプルへのリンクがある', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  for (const path of ['samples/okojo/manual.html', 'samples/okojo/phone/', 'samples/okojo/manual.json']) assert.ok(readme.includes(path), path);
  assert.ok(readme.includes('Download ZIP'));
});

test('README の「何が手に入るか」の表は、サンプルから数えた数と同じ（手で書かない）', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.ok(readme.includes(countsTable()), 'node scripts/sample-counts.mjs の出力で README の表を置き換えてください');
  const counts = sampleCounts();
  assert.equal(Object.values(counts.badge).reduce((sum, n) => sum + n, 0), counts.pages, '判定ごとの内訳の合計がページの数');
});

test('サンプルの入口のページは、PC 用と、スマホ用の束の全ファイルへのリンクだけで、JavaScript も外部の読み込みもない', () => {
  const index = read('index.html');
  const links = [...index.matchAll(/href="([^"]+)"/g)].map((match) => decodeURIComponent(match[1]));
  const phone = readdirSync(new URL('phone/', root)).filter((name) => name.endsWith('.html')).map((name) => `phone/${name}`);
  assert.deepEqual(links.sort(), ['manual.html', ...phone].sort());
  assert.doesNotMatch(index, /<script|https?:\/\/|src=/i);
});
