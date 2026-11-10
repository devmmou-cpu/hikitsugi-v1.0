// 段 1 の更新まわり：連絡先と機器を足す、更新の記録にアカウント名と PC 名を残す。
// 設計は docs/design/stage1-update.md。偽の担当の出力で流れを確かめる。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadInput } from '../eval/lib/load-set.mjs';
import { checkCommon, checkContact } from '../plugin/lib/assemble.mjs';
import { manualProblems } from '../plugin/lib/page-check.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const input = loadInput(join(ROOT, 'eval/sets/okojo'));
const sources = { survey: input.survey, transcript: input.transcript };
const fixture = () => JSON.parse(readFileSync(join(ROOT, 'test/fixtures/manual-t1.json'), 'utf8'));
const RETIREE_CONTACT = /退職する担当者を連絡先に載せないでください/;

test('退職する本人の名前の連絡先は、最初に作るとき、足すとき、直すときのすべてで止める', () => {
  const manual = fixture();
  const [vendor] = manual.contacts;
  const named = { ...vendor, name: '田中' };
  // 最初に作るとき：組み立てたあとの全体の検査と、共通部分の検査
  assert.match(manualProblems({ ...manual, contacts: [named] }, '田中 一郎').join('\n'), RETIREE_CONTACT);
  const common = { page_plan: [{ id: 'T1', category: 'net', symptom: 'ネット' }], statements: manual.statements, contacts: [named], routines: [], devices: [], before_leaving: [] };
  assert.match(checkCommon(common, sources, { retiree: '田中さん' }).problems.join('\n'), RETIREE_CONTACT);
  // 足すとき、直すとき：連絡先 1 件の検査
  const statements = manual.statements.filter((statement) => [vendor.role, vendor.hours, vendor.contract_location, vendor.what_to_tell].includes(statement.id));
  assert.match(checkContact({ statements, contact: { ...named, name: '田中 一郎' } }, vendor.id, sources, { retiree: '田中' }).problems.join('\n'), RETIREE_CONTACT);
  // 本人でない名前は止めない。退職する人が分からないときも止めない
  assert.doesNotMatch(manualProblems(manual, '田中').join('\n'), RETIREE_CONTACT);
  assert.doesNotMatch(manualProblems({ ...manual, contacts: [named] }, '').join('\n'), RETIREE_CONTACT);
});
