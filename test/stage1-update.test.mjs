// 段 1 の更新まわり：連絡先と機器を足す、更新の記録にアカウント名と PC 名を残す。
// 設計は docs/design/stage1-update.md。偽の担当の出力で流れを確かめる。

import './setup-identity.mjs';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadInput } from '../eval/lib/load-set.mjs';
import { checkCommon, checkContact } from '../plugin/lib/assemble.mjs';
import { IDENTITY_ENV, machineIdentity, otherAccountsOf } from '../plugin/lib/identity.mjs';
import { manualProblems } from '../plugin/lib/page-check.mjs';
import { withoutReplies, withReplies } from '../plugin/lib/reply.mjs';
import { withUpdateMark } from '../plugin/lib/update.mjs';
import { validate } from '../plugin/lib/validate.mjs';
import { PHONE_DIR } from '../plugin/renderer/phone.mjs';
import { nextStep, run } from '../plugin/scripts/hikitsugi.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const input = loadInput(join(ROOT, 'eval/sets/okojo'));
const sources = { survey: input.survey, transcript: input.transcript };
const fixture = () => JSON.parse(readFileSync(join(ROOT, 'test/fixtures/manual-t1.json'), 'utf8'));
const RETIREE_CONTACT = /退職する担当者を連絡先に載せないでください/;
const MANUAL_SCHEMA = JSON.parse(readFileSync(join(ROOT, 'plugin/schemas/manual.schema.json'), 'utf8'));
const allCorrect = (ids) => ({ results: ids.map((id) => ({ statement: id, verdict: 'correct', reason: '', checked: [], conflicts_with: [] })) });

/** 環境変数で架空のアカウント名と PC 名を渡して、fn を実行する。終わったら元に戻す。 */
function withIdentity(identity, fn) {
  const saved = process.env[IDENTITY_ENV];
  if (identity) process.env[IDENTITY_ENV] = JSON.stringify(identity);
  else delete process.env[IDENTITY_ENV];
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env[IDENTITY_ENV];
    else process.env[IDENTITY_ENV] = saved;
  }
}

/** 完成した説明書の作業フォルダを作る（test/update.test.mjs と同じ作り）。聞き取りは、連絡先の名前と番号が入る記録。 */
function finished(fn, { entries } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hikitsugi-stage1-'));
  const work = join(dir, 'hikitsugi-work');
  const surveyPath = join(dir, 'survey-input.json');
  writeFileSync(surveyPath, JSON.stringify(input.survey));
  const tool = {
    dir,
    work,
    hikitsugi: (command, args = [], stdin = '') => run(command, args, { work, stdin }),
    write: (name, value) => writeFileSync(join(work, name), JSON.stringify(value)),
    read: (name) => JSON.parse(readFileSync(join(work, name), 'utf8')),
  };
  try {
    run('init', [surveyPath, '田中', 'オコジョ精工'], { work });
    const base = withoutReplies(fixture());
    const known = new Set(['INT-001', 'INT-002', 'INT-003']);
    const statements = base.statements.map((statement) => ({ ...statement, evidence: [...new Set(statement.evidence.map((id) => (id.startsWith('INT-') && !known.has(id) ? 'INT-001' : id)))] }));
    const made = withReplies({ ...base, statements, company_name: 'オコジョ精工', review: { reviewer: '田中', confirmed_on: '2026-11-05' } });
    const manual = { ...made, search_index: made.symptom_pages.map((page) => ({ page: page.id, phrases: Array.from({ length: 15 }, (_, i) => `${page.id} の言い方 ${i}`) })) };
    tool.write('survey.json', { ...input.survey, items: [] });
    const transcript = tool.read('transcript.json');
    const entry = (n, answer, status = 'answered') => ({ id: `INT-00${n}`, gap: 'GAP-001', covers: ['CHK-01'], question: '質問', answer, status, answered_at: '2026-11-04T00:00:00Z' });
    tool.write('transcript.json', { ...transcript, entries: entries ?? [entry(1, '保守はカワウソシステムサービスで、連絡先は 03-0000-0102 です。'), entry(2, '再接続すれば直ります。'), entry(3, '分かりません。', 'unknown')] });
    tool.write('gaps.json', { schema_version: 1, company: 'okojo', coverage: [], gaps: [] });
    tool.write('manual-final.json', manual);
    tool.write('manual-1.json', manual);
    tool.write('edited-1.json', manual);
    tool.write('verification-1.json', allCorrect(manual.statements.map(({ id }) => id)));
    tool.write('state.json', { company: 'okojo', company_name: 'オコジョ精工', retiree: '田中', round: 1, interview_done: true, passed: true, review: { reviewer: '田中', pages: { T1: 'ok' }, done: true } });
    tool.hikitsugi('render');
    return fn(tool);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 連絡先の番号を変える更新を、照合なしで最後まで通す。記録の確かめに使う。 */
function changePhone({ hikitsugi, write, read }, phone) {
  hikitsugi('update-fix', ['VEN-02'], `電話番号が ${phone} に変わりました。`);
  hikitsugi('writer-task', [String(read('state.json').round), 'VEN-02']);
  const { statements, contact } = read('writer-task.json').revision.previous;
  const round = String(read('state.json').round);
  write(`writer-${round}-VEN-02.json`, { statements, contact: { ...contact, phone } });
  hikitsugi('check-writer', [round, 'VEN-02']);
  hikitsugi('review-ok', ['VEN-02']);
  hikitsugi('render');
}

/** 作業フォルダの中の、書き出した HTML をすべて読む（PC 用とスマホ用）。 */
const writtenHtml = (work) => [readFileSync(join(work, 'manual.html'), 'utf8'), ...readdirSync(join(work, PHONE_DIR)).map((name) => readFileSync(join(work, PHONE_DIR, name), 'utf8'))].join('\n');

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

test('アカウント名と PC 名：OS から読み、環境変数があればその値を使って出どころを残す', () => {
  const fromOs = withIdentity(null, () => machineIdentity());
  assert.equal(fromOs.source, 'os');
  // 値は表示しない。OS の値と同じであることだけを確かめる
  assert.ok(fromOs.account === userInfo().username, 'アカウント名は OS の値');
  assert.ok(fromOs.host === hostname(), 'PC 名は OS の値');
  assert.deepEqual(machineIdentity({ [IDENTITY_ENV]: JSON.stringify({ account: ' user-b ', host: 'OKJ-PC02' }) }), { account: 'user-b', host: 'OKJ-PC02', source: 'env' });
  assert.deepEqual(machineIdentity({ [IDENTITY_ENV]: JSON.stringify({ account: '' }) }), { account: null, host: null, source: 'env' });
  assert.throws(() => machineIdentity({ [IDENTITY_ENV]: 'user-b' }), /の形で指定してください/);
});

test('更新の記録：名乗った名前、アカウント名、PC 名、出どころを manual.json に残し、PC 用・印刷・スマホ用の画面には出さない', () =>
  withIdentity({ account: 'user-z', host: 'OKJ-ZZ99' }, () =>
    finished((tool) => {
      const { work, hikitsugi, read } = tool;
      const started = hikitsugi('update-start', ['佐藤']);
      assert.match(started, /記録します：アカウント名 user-z、PC 名 OKJ-ZZ99（環境変数で指定）。画面には出さず、manual\.json にだけ残します/);
      assert.match(started, /更新の記録はまだありません/);
      changePhone(tool, '03-0000-0199');
      const [update] = read('manual-final.json').updates;
      assert.deepEqual([update.by, update.account, update.host, update.identity_source], ['佐藤', 'user-z', 'OKJ-ZZ99', 'env']);
      assert.deepEqual(validate(MANUAL_SCHEMA, read('manual-final.json')), []);
      const bundle = JSON.parse(readFileSync(join(work, 'manual.json'), 'utf8'));
      assert.equal(bundle.manual.updates[0].account, 'user-z', 'manual.json に残る');
      const html = writtenHtml(work);
      assert.ok(html.includes('佐藤'), '名乗った名前は更新の記録の表に出る');
      for (const value of ['user-z', 'OKJ-ZZ99']) assert.ok(!html.includes(value), `${value} は画面に出さない`);
      assert.match(hikitsugi('history'), /^\d{4}-\d{2}-\d{2} 連絡先の変更 佐藤（アカウント名 user-z、PC 名 OKJ-ZZ99）対象 VEN-02$/);
    })));

test('更新を始めたとき：直近の記録を出し、名乗った名前が別のアカウント名と組になっていたら注意を出す（止めない）', () =>
  finished((tool) => {
    const { hikitsugi, read } = tool;
    withIdentity({ account: 'user-a', host: 'OKJ-PC01' }, () => {
      hikitsugi('update-start', ['佐藤']);
      changePhone(tool, '03-0000-0199');
    });
    withIdentity({ account: 'user-b', host: 'OKJ-PC02' }, () => {
      const started = hikitsugi('update-start', ['佐藤さん']);
      assert.match(started, /直近の更新：\d{4}-\d{2}-\d{2} 佐藤（アカウント名 user-a、PC 名 OKJ-PC01）/);
      assert.match(started, /注意：「佐藤さん」の名前は、前の更新で別のアカウント名（user-a）と組になっていました/);
      // 止めないので、そのまま更新できる
      changePhone(tool, '03-0000-0198');
      assert.deepEqual(read('manual-final.json').updates.map((update) => update.account), ['user-a', 'user-b']);
      // 別の名前なら注意を出さない
      assert.doesNotMatch(hikitsugi('update-start', ['鈴木']), /注意/);
    });
    withIdentity({ account: 'user-a', host: 'OKJ-PC03' }, () => assert.match(hikitsugi('update-start', ['佐藤']), /注意：.*（user-b）/));
  }));

test('アカウント名の欄がない前の版の記録とは比べない。今回のアカウント名が取れないときも比べない', () => {
  const old = [{ target: 'VEN-02', pages: ['T1'], by: '佐藤', date: '2026-11-06', kind: 'contact' }];
  assert.deepEqual(otherAccountsOf(old, '佐藤', 'user-a'), []);
  assert.deepEqual(otherAccountsOf([...old, { ...old[0], account: 'user-b' }], '佐藤', 'user-a'), ['user-b']);
  assert.deepEqual(otherAccountsOf([...old, { ...old[0], account: 'user-b' }], '佐藤', null), []);
  // 前の版の説明書（欄なし）でも記録の印は付き、形の検査に通る
  const marked = withUpdateMark({ ...fixture(), updates: old }, { target: 'VEN-02', by: '佐藤', date: '2026-11-10', kind: 'contact', identity: { account: null, host: 'OKJ-PC01', source: 'os' } });
  assert.deepEqual(marked.updates.at(-1), { target: 'VEN-02', pages: ['T1'], by: '佐藤', date: '2026-11-10', kind: 'contact', host: 'OKJ-PC01', identity_source: 'os' });
  assert.deepEqual(validate(MANUAL_SCHEMA, marked), []);
  finished(({ hikitsugi, write, read }) => {
    write('manual-final.json', { ...read('manual-final.json'), updates: old });
    const started = withIdentity({ account: 'user-a', host: 'OKJ-PC01' }, () => hikitsugi('update-start', ['佐藤']));
    assert.match(started, /直近の更新：2026-11-06 佐藤（アカウント名 記録なし、PC 名 記録なし）/);
    assert.doesNotMatch(started, /注意/);
  });
});

test('サンプルの更新の記録には、OS から読んだアカウント名と PC 名を入れない（作り直すときは環境変数で架空の値を渡す）', () => {
  const bundle = JSON.parse(readFileSync(join(ROOT, 'samples/okojo/manual.json'), 'utf8'));
  for (const update of bundle.manual.updates ?? []) {
    if (update.account || update.host) assert.equal(update.identity_source, 'env', `${update.date} の記録`);
  }
});
