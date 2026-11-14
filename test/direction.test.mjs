// 向きのある部品（コピー）の検査。部品は元と先を言わないので、前の手順に根拠つきの「どこからどこへ」の文を求める。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadInput } from '../eval/lib/load-set.mjs';
import { applyEdits, directionChanged } from '../plugin/lib/apply-edits.mjs';
import { checkCommon } from '../plugin/lib/assemble.mjs';
import { directionOf, directionProblems, evidenceReader, libraryForAgents, loadLibrary, pageDetailProblems, pageScopeNotes, routineScopeNotes, SCOPE_UNKNOWN } from '../plugin/lib/procedures.mjs';
import { renderPhoneBundle } from '../plugin/renderer/phone.mjs';
import { renderManual } from '../plugin/renderer/render.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const input = loadInput(join(ROOT, 'eval/sets/okojo'));
const library = loadLibrary();
// 評価セットにない、テスト用の答え
const ANSWER = { id: 'INT-950', status: 'answered', question: 'テスト用', answer: '消したファイルは、外付けのディスクの控えから共有フォルダへ戻します。' };
const sources = { survey: input.survey, transcript: { ...input.transcript, entries: [...input.transcript.entries, ANSWER] } };
const readEvidence = evidenceReader(sources);

const part = (id, partId) => ({ id, text: '', evidence: [], library: partId });
const said = (id, text, evidence = ['INT-950']) => ({ id, text, evidence, library: null });
/** 部品の文面を入れた文の一覧。プログラムが組み立てたあとの形。 */
const composed = (statements) => statements.map((statement) => (statement.library ? { ...statement, text: library.procedures.find((p) => p.id === statement.library).text, evidence: [statement.library] } : statement));
const COPY = [part('STM-802', 'LIB-024'), part('STM-803', 'LIB-025'), part('STM-804', 'LIB-026')];
const page = (steps, fields = {}) => ({ id: 'T1', category: 'file', title: 'STM-901', badge: { value: 'confirm', statement: 'STM-902' }, minutes: 5, reassurance: 'STM-903', notes: [], first_steps: [], first_goal: null, branches: [], steps, goal: null, exceptions: [], info_rows: [], fallback: null, ...fields });

test('印を付けた部品は、コピーの 2 つだけ。文面と承認は変えていない', () => {
  assert.deepEqual(library.procedures.filter((p) => p.directional).map((p) => p.id), ['LIB-024', 'LIB-025']);
  for (const id of ['LIB-024', 'LIB-025']) {
    const p = library.procedures.find((candidate) => candidate.id === id);
    assert.equal(p.status, 'approved');
    assert.equal(p.reviewed_on, '2026-11-03');
  }
  // Writer にも印を渡す。承認の状態は渡さない
  const forAgents = libraryForAgents(library).procedures;
  assert.equal(forAgents.find((p) => p.id === 'LIB-024').directional, true);
  assert.equal(forAgents.find((p) => p.id === 'LIB-026').directional, undefined);
});

test('文から元と先を読む', () => {
  assert.deepEqual(directionOf('外付けのディスクの控えから、共有フォルダへ戻してください。'), { from: '外付けのディスクの控え', to: '共有フォルダ' });
  assert.deepEqual(directionOf('消したファイルは、外付けのディスクの控えから共有フォルダにコピーしてください。'), { from: '外付けのディスクの控え', to: '共有フォルダ' });
  // 「金曜に取った」の「に」で先を切らない
  assert.deepEqual(directionOf('共有フォルダから、月曜に取り付けたディスクへコピーしてください。'), { from: '共有フォルダ', to: '月曜に取り付けたディスク' });
  assert.equal(directionOf('ファイルを戻す前に、社長に相談してください。'), null);
  assert.equal(directionOf('コピー先のフォルダーを開いてください。'), null);
});

test('向きの文がないと、部品を使えない', () => {
  const statements = composed([said('STM-801', 'ファイルを戻す前に、社長に相談してください。'), ...COPY]);
  const problems = directionProblems('T1', [['STM-801', 'STM-802', 'STM-803', 'STM-804']], statements, readEvidence, library);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /LIB-024 は向きのある部品です/);
  assert.match(problems[0], /部品を使わず、答えの文だけで/);
});

test('根拠にある元と先の向きの文があれば、使える。空白と長音の違いは問わない', () => {
  const statements = composed([said('STM-801', '外付けのディスクの控えから、共有フォルダーへ戻してください。'), ...COPY]);
  assert.deepEqual(directionProblems('T1', [['STM-801', 'STM-802', 'STM-803', 'STM-804']], statements, readEvidence, library), []);
});

test('元か先が根拠にないと止める。部品より後ろの向きの文は数えない', () => {
  const wrong = composed([said('STM-801', '共有フォルダから、ノートパソコンへコピーしてください。'), ...COPY]);
  assert.match(directionProblems('T1', [['STM-801', 'STM-802', 'STM-803']], wrong, readEvidence, library).join('\n'), /先の場所「ノートパソコン」が、その文の根拠にありません/);
  const after = composed([...COPY, said('STM-801', '外付けのディスクの控えから、共有フォルダへ戻してください。')]);
  assert.match(directionProblems('T1', [['STM-802', 'STM-803', 'STM-801']], after, readEvidence, library).join('\n'), /向きのある部品です/);
  // 根拠が調査データだけの文や、部品は向きの根拠にしない
  const fromLibrary = composed([said('STM-801', '外付けのディスクの控えから、共有フォルダへ戻してください。', ['LIB-024']), ...COPY]);
  assert.match(directionProblems('T1', [['STM-801', 'STM-802']], fromLibrary, readEvidence, library).join('\n'), /元の場所「外付けのディスクの控え」が、その文の根拠にありません/);
});

test('定期作業は、手順の真上に出る題名の向きも数える。「〈元〉を〈先〉へコピー」の形も読む', () => {
  assert.deepEqual(directionOf('毎週金曜：共有フォルダを外付けのディスクへ手でコピーする'), { from: '共有フォルダ', to: '外付けのディスク' });
  // 「ファイルを〜へ戻す」の「を」は物なので、元の場所として読まない
  assert.equal(directionOf('消したファイルを共有フォルダへ戻してください。'), null);
  const statements = composed([said('STM-801', '毎週、共有フォルダを外付けディスクへコピーする'), ...COPY]);
  assert.deepEqual(directionProblems('R1', [['STM-802', 'STM-803']], statements, readEvidence, library, 'STM-801'), []);
  // ページの題名は症状なので、題名を渡さなければ数えない
  assert.equal(directionProblems('R1', [['STM-802', 'STM-803']], statements, readEvidence, library).length, 1);
});

test('ページの検査（Writer の出力ごと、最後の組み立て）と、定期作業の検査に入っている', () => {
  const statements = composed([said('STM-801', 'ファイルを戻す前に、社長に相談してください。'), ...COPY]);
  assert.match(pageDetailProblems(page(['STM-801', 'STM-802', 'STM-803', 'STM-804']), statements, sources, library).join('\n'), /向きのある部品/);
  const common = JSON.parse(readFileSync(join(ROOT, 'test/fixtures/manual-full.json'), 'utf8'));
  const output = { ...common, page_plan: [{ id: 'T1' }], before_leaving: [], statements: [...common.statements, said('STM-801', '毎週金曜に控えを取ってください。', ['INT-001']), part('STM-802', 'LIB-024'), part('STM-803', 'LIB-025')], routines: [{ id: 'R90', frequency: 'weekly', title: 'STM-801', steps: ['STM-801', 'STM-802', 'STM-803'] }] };
  assert.match(checkCommon(output, sources).problems.join('\n'), /R90: LIB-024 は向きのある部品です/);
});

test('戻す操作で範囲の記録がなければ、向きの文の下に決まった文を出す。範囲の文があれば出さない', () => {
  const statements = composed([said('STM-801', '外付けのディスクの控えから、共有フォルダへ戻してください。'), ...COPY]);
  const manual = { statements };
  const target = page(['STM-801', 'STM-802', 'STM-803', 'STM-804']);
  assert.deepEqual([...pageScopeNotes(target, manual, library)], [['STM-801', SCOPE_UNKNOWN]]);
  const scoped = { statements: [...statements, said('STM-805', '戻すのは、消したファイルだけです。')] };
  assert.equal(pageScopeNotes({ ...target, notes: ['STM-805'] }, scoped, library).size, 0);
  // 戻すのでなく、控えを取るコピーには出さない
  const backup = { statements: composed([said('STM-801', '共有フォルダから、外付けのディスクへコピーしてください。'), ...COPY]) };
  assert.equal(routineScopeNotes({ id: 'R1', title: 'STM-801', steps: ['STM-801', 'STM-802', 'STM-803'] }, backup, library).size, 0);
});

test('PC 用、印刷、スマホ用に、戻す範囲の記録がないことが出る', () => {
  const manual = JSON.parse(readFileSync(join(ROOT, 'test/fixtures/manual-full.json'), 'utf8'));
  const target = manual.symptom_pages.find((candidate) => candidate.steps.length === 0 && candidate.first_steps.length === 0) ?? manual.symptom_pages[0];
  manual.statements.push(said('STM-951', '外付けのディスクの控えから、共有フォルダへ戻してください。'), ...composed(COPY.map((s, i) => ({ ...s, id: `STM-95${i + 2}` }))));
  target.steps = ['STM-951', 'STM-952', 'STM-953', 'STM-954'];
  const html = renderManual(manual);
  const article = html.match(new RegExp(`<article[^>]*id="symptom-${target.id}"[\\s\\S]*?</article>`))[0];
  assert.ok(article.includes(SCOPE_UNKNOWN));
  const files = renderPhoneBundle(manual).filter((file) => file.html.includes(SCOPE_UNKNOWN));
  assert.equal(files.length, 1);
});

test('Editor の直しで元と先が変わる、または読めなくなるなら、元の文のまま残す', () => {
  assert.equal(directionChanged('外付けのディスクの控えから、共有フォルダへ戻してください。', '外付けのディスクの控えから、共有フォルダーへ戻してください。'), false);
  assert.equal(directionChanged('外付けのディスクの控えから、共有フォルダへ戻してください。', '共有フォルダへ戻してください。'), true);
  assert.equal(directionChanged('社長に相談してください。', 'まず社長に相談してください。'), false);
  const manual = { statements: [said('STM-801', '外付けのディスクの控えから、共有フォルダへ戻してください。')], symptom_pages: [page(['STM-801'])], contacts: [], devices: [], glossary: [] };
  const { manual: edited, changes } = applyEdits(manual, { rewrites: [{ id: 'STM-801', text: '控えを使って戻してください。' }], glossary: [] });
  assert.equal(edited.statements[0].text, '外付けのディスクの控えから、共有フォルダへ戻してください。');
  assert.deepEqual(changes, [{ statement: 'STM-801', missing: ['向きの文'], rejected: '控えを使って戻してください。' }]);
});
