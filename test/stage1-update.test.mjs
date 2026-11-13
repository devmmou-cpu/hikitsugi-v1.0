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
import { checkCommon, checkContact, credentialNoneProblems, writerFormat } from '../plugin/lib/assemble.mjs';
import { IDENTITY_ENV, machineIdentity, otherAccountsOf } from '../plugin/lib/identity.mjs';
import { manualProblems, pageStatementIds } from '../plugin/lib/page-check.mjs';
import { withoutReplies, withReplies } from '../plugin/lib/reply.mjs';
import { UPDATE_KIND_LABELS, withUpdateMark } from '../plugin/lib/update.mjs';
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
      assert.match(started, /記録します：アカウント名 user-z、PC 名 OKJ-ZZ99（環境変数で指定）。説明書の画面には出さず、manual\.json にだけ残します/);
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

/**
 * 前の版の文が残っていることを確かめる。用語の説明の文は、新しい文と番号が重なると振り直す決まり（handover.mjs の carryForward）なので、
 * 文面が残っていることだけを見る。ほかの文は ID と文面が同じこと。プログラムが組む文（usage 付き）は作り直すので見ない。
 */
function keepsStatements(before, after) {
  const glossary = new Set(before.glossary.map((entry) => entry.company));
  for (const old of before.statements.filter((s) => !s.usage)) {
    if (glossary.has(old.id)) assert.ok(after.statements.some((s) => s.text === old.text), `用語の説明 ${old.id} が残る`);
    else assert.equal(after.statements.find((s) => s.id === old.id)?.text, old.text, old.id);
  }
}

// ---- 連絡先を足す ----
const EZO = { name: 'エゾクロテン電設', phone: '03-0000-0131' };
const EZO_ANSWER = `分電盤やブレーカーの工事は${EZO.name}に頼みます。電話番号は ${EZO.phone} で、受付は平日の9時から17時です。契約書の控えの場所は分かりません。`;
const statement = (id, text, evidence) => ({ id, text, evidence: [evidence], library: null });
const phrasesOf = (id) => Array.from({ length: 15 }, (_, i) => `${id} の言い方 ${i}`);

/** 書き終えたあと、照合（全部正しい）、言い方、更新する人の確認、作り直しまで進める。Editor は直さない。 */
function passThrough({ work, hikitsugi, write, read }, target) {
  const round = String(read('state.json').round);
  if (nextStep(work).step === 'editor') {
    write(`editor-${round}.json`, { rewrites: [], glossary: [] });
    hikitsugi('merge-edits', [round]);
  }
  assert.deepEqual(nextStep(work), { step: 'verifier', round: Number(round) });
  const scope = read(`verify-scope-${round}.json`).statements;
  write(`verification-${round}.json`, allCorrect(scope));
  assert.match(hikitsugi('check-verification', [round]), /合格/);
  if (nextStep(work).step === 'phrases') {
    hikitsugi('phrase-task');
    write('phrases.json', { pages: read('phrase-pages.json').pages.map((page) => ({ id: page.id, phrases: phrasesOf(page.id) })) });
    hikitsugi('check-phrases');
  }
  assert.deepEqual(nextStep(work), { step: 'review', reviewer: read('state.json').update.by, page: target, pages: 1, update: true });
  const shown = hikitsugi('review-show', [target]);
  hikitsugi('review-ok', [target]);
  hikitsugi('render');
  return { scope, shown };
}

/** 業者の連絡先を足す更新を、Writer の出力を書いて検査まで進める。 */
function writeAddedContact({ work, hikitsugi, write, read }, { answer = EZO_ANSWER, contact = {}, type = 'vendor' } = {}) {
  assert.match(hikitsugi('update-add-contact', [type], answer), /。(VEN|INH)-\d{2} を書きます$/);
  const { round } = read('state.json');
  const id = read('state.json').update.target;
  assert.deepEqual(nextStep(work), { step: 'writer', round, part: id });
  hikitsugi('writer-task', [String(round), id]);
  const task = read('writer-task.json');
  const evidence = task.revision.page_fix.evidence;
  const statements = [
    statement('STM-001', '分電盤の工事の会社', evidence),
    statement('STM-002', '受付は平日の9時から17時です。', evidence),
    statement('STM-003', '記録がありません。', evidence),
    statement('STM-004', '分電盤のどこが落ちたかを伝えてください。', evidence),
  ];
  write(`writer-${round}-${id}.json`, { statements, contact: { id, ...EZO, role: 'STM-001', hours: 'STM-002', contract_location: 'STM-003', what_to_tell: 'STM-004', ...contact } });
  return { id, round, task, check: () => hikitsugi('check-writer', [String(round), id]) };
}

test('連絡先を足す：業者の続きの ID で、答えのとおりの名前と番号を載せ、文を照合し、確認のあと PC 用・スマホ用・manual.json に出す', () =>
  finished((tool) => {
    const { work, hikitsugi, read } = tool;
    hikitsugi('update-start', ['佐藤']);
    const before = read('manual-final.json');
    const { id, task, check } = writeAddedContact(tool);
    assert.equal(id, 'VEN-03', '今ある VEN-02 の続き');
    assert.equal(task.part, 'contact');
    assert.deepEqual(task.revision.previous, { statements: [], contact: null });
    assert.deepEqual(task.revision.update, { kind: 'add_contact', add_contact: { id: 'VEN-03', type: 'vendor' } });
    assert.equal(read('transcript.json').entries.at(-1).answer, EZO_ANSWER, '更新する人の答えを聞き取りの記録にする');
    check();
    const { scope } = passThrough(tool, id);
    const after = read('manual-final.json');
    const added = after.contacts.find((contact) => contact.id === 'VEN-03');
    assert.deepEqual([added.name, added.phone], [EZO.name, EZO.phone]);
    for (const ref of [added.role, added.hours, added.contract_location, added.what_to_tell]) assert.ok(scope.includes(ref), `${ref} は照合にかける`);
    // 前の版の文と連絡先は変わらない
    keepsStatements(before, after);
    assert.deepEqual(after.contacts.filter((contact) => contact.id !== 'VEN-03'), before.contacts);
    const update = after.updates.at(-1);
    assert.deepEqual([update.kind, update.target, update.pages, update.by], ['add_contact', 'VEN-03', [], '佐藤']);
    // PC 用、スマホ用（00_連絡先）、manual.json
    const html = readFileSync(join(work, 'manual.html'), 'utf8');
    assert.ok(html.includes(EZO.name));
    assert.ok(html.includes('<td class="update-kind">連絡先の追加</td><td>佐藤</td><td>エゾクロテン電設</td>'), '更新の記録の表に種類と名前を出す');
    const contactsFile = readdirSync(join(work, PHONE_DIR)).find((name) => name.startsWith('00'));
    assert.ok(readFileSync(join(work, PHONE_DIR, contactsFile), 'utf8').includes(EZO.name));
    assert.ok(JSON.parse(readFileSync(join(work, 'manual.json'), 'utf8')).manual.contacts.some((contact) => contact.name === EZO.name));
  }));

test('連絡先を足す：社内の相談先は INH- の続き。番号の記録がなくても載せる', () =>
  finished((tool) => {
    tool.hikitsugi('update-start', ['佐藤']);
    const { id, check } = writeAddedContact(tool, { type: 'internal', answer: '総務課に相談します。番号はありません。連絡は Teams でします。', contact: { name: '総務課', phone: '' } });
    assert.equal(id, 'INH-01');
    check();
    passThrough(tool, id);
    assert.equal(tool.read('manual-final.json').contacts.find((contact) => contact.id === 'INH-01').name, '総務課');
  }));

test('連絡先を足す：名前か番号が今回の答えにない、退職する本人、今の連絡先と同じ名前、番号でない番号は止める', () =>
  finished((tool) => {
    tool.hikitsugi('update-start', ['佐藤']);
    // 1 件ずつ試して、取り消してから次を試す
    const fails = (contact, answer, pattern) => {
      const { check } = writeAddedContact(tool, { contact, answer });
      assert.throws(check, pattern);
      tool.hikitsugi('update-cancel');
    };
    // 名前と番号は、記録のどこかではなく今回の答えにあること（カワウソシステムサービスの番号は前の記録にある）
    fails({ name: 'エゾクロテン電設', phone: '03-0000-0102' }, EZO_ANSWER, /電話番号が今回の答えにありません/);
    fails({ name: '田中' }, `${EZO_ANSWER}田中に聞きます。`, /退職する担当者を連絡先に載せないでください/);
    fails({ name: 'カワウソシステムサービス', phone: '' }, `カワウソシステムサービスにも頼みます。`, /VEN-02 と同じ名前です/);
    fails({ phone: '分からない' }, `${EZO_ANSWER}番号は分からない。`, /番号の形ではありません/);
    // パスワードの本体らしい答えは、記録の前に断る
    assert.throws(() => tool.hikitsugi('update-add-contact', ['vendor'], 'エゾクロテン電設のパスワードは abcd1234 です。'), /パスワードの本体/);
    assert.throws(() => tool.hikitsugi('update-add-contact', ['shop'], EZO_ANSWER), /vendor\|internal/);
  }));

test('連絡先の番号：見慣れない形（フリーダイヤル、携帯、内線つき）は止めず、確認の表示で「この番号でよいですか」と聞く', () =>
  finished((tool) => {
    tool.hikitsugi('update-start', ['佐藤']);
    const free = '0120-000-131';
    const { id, check } = writeAddedContact(tool, { contact: { phone: free }, answer: EZO_ANSWER.replace(EZO.phone, free) });
    check();
    const { shown } = passThrough(tool, id);
    assert.match(shown, /電話番号：0120-000-131\n確認：見慣れない形の番号です/);
    // ふつうの番号には出さない
    assert.doesNotMatch(tool.hikitsugi('review-show', ['VEN-02']), /見慣れない形/);
  }));

const PANEL_ANSWER = `分電盤のブレーカーが落ちて事務所の電気が止まったときは、${EZO.name}に電話します。`;
const PANEL_TITLE = '分電盤のブレーカーが落ちた';

/** 症状を足す更新で、共通部分と新しいページを書く。ページは今のページを写し、題名と ③ の連絡先を変える。 */
function writeAddedSymptom({ work, hikitsugi, write, read }, contactId) {
  const before = read('manual-final.json');
  assert.match(hikitsugi('update-add', [], PANEL_ANSWER), /。T\d+ を書きます$/);
  const round = String(read('state.json').round);
  const pageId = read('state.json').update.target;
  hikitsugi('writer-task', [round, 'common']);
  const { previous } = read('writer-task.json').revision;
  write(`writer-${round}-common.json`, { ...previous, page_plan: [...previous.page_plan, { id: pageId, category: 'other', symptom: PANEL_TITLE }] });
  hikitsugi('check-writer', [round, 'common']);
  hikitsugi('writer-task', [round, pageId]);
  const task = read('writer-task.json');
  const source = before.symptom_pages[0];
  const ids = new Set(pageStatementIds(source));
  const { reply_to_staff: _reply, ...page } = source;
  const statements = before.statements.filter((s) => ids.has(s.id) && !s.usage).map(({ usage: _usage, ...s }) => (s.id === source.title ? { ...s, text: PANEL_TITLE, evidence: [task.revision.page_fix.evidence] } : s));
  write(`writer-${round}-${pageId}.json`, { statements, page: { ...page, fallback: { contact: contactId } } });
  hikitsugi('check-writer', [round, pageId]);
  return { pageId, task };
}

test('足した連絡先を、続けて足した症状ページの ③ に使える。3 つの出力と更新の記録に出る', () =>
  finished((tool) => {
    const { work, hikitsugi, read } = tool;
    hikitsugi('update-start', ['佐藤']);
    const { id, check } = writeAddedContact(tool);
    check();
    passThrough(tool, id);
    const { pageId, task } = writeAddedSymptom(tool, id);
    assert.ok(task.contacts.some((contact) => contact.id === id && contact.name === EZO.name), '新しいページが選べる連絡先に入る');
    passThrough(tool, pageId);
    const after = read('manual-final.json');
    const page = after.symptom_pages.find((candidate) => candidate.id === pageId);
    assert.equal(page.fallback.contact, id, '③ の連絡先はエゾクロテン電設');
    // PC 用：そのページの ③ に名前が出る
    const html = readFileSync(join(work, 'manual.html'), 'utf8');
    const start = html.indexOf(`<article id="symptom-${pageId}"`);
    assert.ok(start >= 0, 'PC 用にページができる');
    const section = html.slice(start, html.indexOf('</article>', start));
    assert.ok(section.includes(PANEL_TITLE) && section.includes(EZO.name), 'PC 用のページの ③ に出る');
    // スマホ用：そのページのファイルに出る
    const file = readdirSync(join(work, PHONE_DIR)).find((name) => name.includes(PANEL_TITLE));
    assert.ok(file, 'スマホ用のファイルができる');
    assert.ok(readFileSync(join(work, PHONE_DIR, file), 'utf8').includes(EZO.name));
    // manual.json
    const bundle = JSON.parse(readFileSync(join(work, 'manual.json'), 'utf8')).manual;
    assert.equal(bundle.symptom_pages.find((candidate) => candidate.id === pageId).fallback.contact, id);
    assert.deepEqual(after.updates.map((update) => [update.kind, update.target, update.by, update.account, update.host]), [
      ['add_contact', id, '佐藤', 'user-a', 'OKJ-PC01'],
      ['add', pageId, '佐藤', 'user-a', 'OKJ-PC01'],
    ]);
  }));

test('足した連絡先の文が照合で指摘されたら、その連絡先だけを書き直す。上限で止まったら取り消せて、連絡先も回も戻る', () =>
  finished((tool) => {
    const { work, hikitsugi, write, read } = tool;
    hikitsugi('update-start', ['佐藤']);
    const before = { manual: read('manual-final.json'), round: read('state.json').round };
    const { id, check } = writeAddedContact(tool);
    check();
    for (let attempt = 0; ; attempt += 1) {
      const round = String(read('state.json').round);
      if (nextStep(work).step === 'editor') {
        write(`editor-${round}.json`, { rewrites: [], glossary: [] });
        hikitsugi('merge-edits', [round]);
      }
      const scope = read(`verify-scope-${round}.json`).statements;
      const role = read(`edited-${round}.json`).contacts.find((contact) => contact.id === id).role;
      write(`verification-${round}.json`, { results: scope.map((statement) => ({ statement, verdict: statement === role ? 'unsupported' : 'correct', reason: statement === role ? '答えにない' : '', checked: [], conflicts_with: [] })) });
      const result = hikitsugi('check-verification', [round]);
      if (/上限/.test(result)) break;
      assert.match(result, new RegExp(`直す部分：${id}`), '書き直すのは足した連絡先だけ');
      assert.deepEqual(nextStep(work), { step: 'writer', round: Number(round) + 1, part: id });
      hikitsugi('writer-task', [String(Number(round) + 1), id]);
      const task = read('writer-task.json');
      assert.equal(task.part, 'contact');
      assert.equal(task.revision.previous.contact.id, id, '差し戻しの回には、前の版に入った連絡先を直す');
      assert.equal(task.revision.update.add_contact, undefined);
      write(`writer-${Number(round) + 1}-${id}.json`, { statements: task.revision.previous.statements, contact: task.revision.previous.contact });
      hikitsugi('check-writer', [String(Number(round) + 1), id]);
      assert.ok(attempt < 3, '差し戻しは上限で止まる');
    }
    assert.equal(nextStep(work).step, 'not_passed');
    hikitsugi('update-cancel');
    assert.deepEqual(read('manual-final.json').contacts, before.manual.contacts, '足した連絡先は残らない');
    assert.equal(read('state.json').round, before.round);
    assert.equal(nextStep(work).step, 'update');
  }));

// ---- 機器を足す ----
const UPS_ANSWER = '停電用の予備の電池を事務所の棚の下の段に置きました。停電のときに共有の機器を数分だけ動かします。止まると停電のときに共有の機器がすぐ止まります。パスワードはありません。電池の箱は開けないでください。';
const UPS_NAME = '停電用の予備の電池';

/** 機器を足す更新を、Writer の出力を書いて検査まで進める。 */
function writeAddedDevice({ work, hikitsugi, write, read }, { answer = UPS_ANSWER, name = UPS_NAME, location = '事務所の棚の下の段にあります。', extra = [], device = {} } = {}) {
  assert.match(hikitsugi('update-add-device', [], answer), /。D\d+ を書きます$/);
  const { round } = read('state.json');
  const id = read('state.json').update.target;
  assert.deepEqual(nextStep(work), { step: 'writer', round, part: id });
  hikitsugi('writer-task', [String(round), id]);
  const task = read('writer-task.json');
  const evidence = task.revision.page_fix.evidence;
  const statements = [
    statement('STM-001', name, evidence),
    statement('STM-002', location, evidence),
    statement('STM-003', '停電のときに、共有の機器を数分だけ動かします。', evidence),
    statement('STM-004', '止まると、停電のときに共有の機器がすぐ止まります。', evidence),
    statement('STM-005', '電池の箱を開けないでください。', evidence),
    ...extra,
  ];
  write(`writer-${round}-${id}.json`, { statements, device: { id, name: 'STM-001', location: 'STM-002', purpose: 'STM-003', impact: 'STM-004', credential_location: null, caution: 'STM-005', ...device } });
  return { id, task, check: () => hikitsugi('check-writer', [String(round), id]) };
}

test('機器を足す：機器 1 件だけを書いて照合し、確認のあと「会社のIT」と manual.json に出る。ほかの機器と文は変わらない', () =>
  finished((tool) => {
    const { work, hikitsugi, read } = tool;
    hikitsugi('update-start', ['佐藤']);
    const before = read('manual-final.json');
    const { id, task, check } = writeAddedDevice(tool);
    assert.equal(id, 'D1');
    assert.equal(task.part, 'device');
    assert.deepEqual(task.revision.previous, { statements: [], device: null });
    assert.deepEqual(task.revision.update, { kind: 'add_device', add_device: { id: 'D1' } });
    assert.equal(read('writer-format.json').properties.device.required.includes('location'), true, '機器 1 件の形を渡す');
    check();
    const { scope, shown } = passThrough(tool, id);
    assert.match(shown, /^D1：停電用の予備の電池/);
    const after = read('manual-final.json');
    const added = after.devices.find((device) => device.id === 'D1');
    for (const ref of [added.name, added.location, added.purpose, added.impact, added.caution]) assert.ok(scope.includes(ref), `${ref} は照合にかける`);
    keepsStatements(before, after);
    assert.deepEqual(after.contacts, before.contacts);
    const html = readFileSync(join(work, 'manual.html'), 'utf8');
    const company = html.slice(html.indexOf('<section id="tab-company"'), html.indexOf('</section>', html.indexOf('<section id="tab-company"')));
    assert.ok(company.includes(UPS_NAME) && company.includes('事務所の棚の下の段'), '会社のIT に載る');
    assert.ok(html.includes('<td class="update-kind">機器の追加</td><td>佐藤</td><td>停電用の予備の電池</td>'), '更新の記録に種類と名前を出す');
    assert.ok(JSON.parse(readFileSync(join(work, 'manual.json'), 'utf8')).manual.devices.some((device) => device.id === 'D1'));
    const update = after.updates.at(-1);
    assert.deepEqual([update.kind, update.target, update.pages, update.by, update.account, update.host], ['add_device', 'D1', [], '佐藤', 'user-a', 'OKJ-PC01']);
    // 2 台目は D2
    writeAddedDevice(tool, { name: '2台目の電池', answer: UPS_ANSWER.replace(UPS_NAME, '2台目の電池') }).check();
    assert.equal(read('state.json').update.target, 'D2');
  }));

test('機器を足す：答えで「パスワードはない」と言われたときだけ「パスワード：ありません」と出す。記録がない機器には行を出さない', () =>
  finished((tool) => {
    const { work, hikitsugi, read } = tool;
    hikitsugi('update-start', ['佐藤']);
    const none = (evidence) => [statement('STM-006', 'パスワードはありません。', evidence)];
    const { id, task, check } = writeAddedDevice(tool, { extra: [], device: { credential_none: 'STM-006' } });
    // 文を足し直す：evidence は今回の答え
    const round = String(read('state.json').round);
    const raw = JSON.parse(readFileSync(join(work, `writer-${round}-${id}.json`), 'utf8'));
    tool.write(`writer-${round}-${id}.json`, { ...raw, statements: [...raw.statements, ...none(task.revision.page_fix.evidence)] });
    check();
    const { scope, shown } = passThrough(tool, id);
    assert.ok(scope.includes('STM-006') || read('manual-final.json').devices.find((d) => d.id === id).credential_none, 'パスワードがない文も照合にかける');
    assert.match(shown, /パスワード：ありません/);
    const added = read('manual-final.json').devices.find((device) => device.id === id);
    assert.ok(added.credential_none);
    assert.equal(added.credential_location, null);
    const html = readFileSync(join(work, 'manual.html'), 'utf8');
    const company = html.slice(html.indexOf('<section id="tab-company"'), html.indexOf('</section>', html.indexOf('<section id="tab-company"')));
    assert.equal(company.split('<dt>パスワード</dt><dd>ありません</dd>').length - 1, 1, '「ない」と言われた機器だけに出す');
    assert.ok(JSON.parse(readFileSync(join(work, 'manual.json'), 'utf8')).manual.devices.find((device) => device.id === id).credential_none, 'manual.json にも残る');
  }));

test('機器を足す：答えに「パスワードはない」がなければ、パスワードがないとは書けない。保管場所と一緒にも書けない', () =>
  finished((tool) => {
    tool.hikitsugi('update-start', ['佐藤']);
    const silent = UPS_ANSWER.replace('パスワードはありません。', '');
    const added = writeAddedDevice(tool, { answer: silent, device: { credential_none: 'STM-006' } });
    const round = String(tool.read('state.json').round);
    const path = join(tool.work, `writer-${round}-${added.id}.json`);
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const evidence = added.task.revision.page_fix.evidence;
    writeFileSync(path, JSON.stringify({ ...raw, statements: [...raw.statements, statement('STM-006', 'パスワードはありません。', evidence)] }));
    assert.throws(added.check, /答えで「ない」と言われたときだけ書けます/);
    // 文が「ない」と言っていなければ止める。保管場所と一緒にも書けない
    const fixed = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, JSON.stringify({ ...fixed, statements: fixed.statements.map((s) => (s.id === 'STM-006' ? { ...s, text: '電池の箱の中にあります。' } : s)), device: { ...fixed.device, credential_location: 'STM-005' } }));
    assert.throws(added.check, /一緒に書けません[\s\S]*パスワードがないことを書きます/);
  }));

test('最初に作るとき：共通部分の Writer の形は credential_none を必ず書き、「ない」の答えがなければ止める。前の版の機器（欄なし）も読める', () => {
  const common = writerFormat('common');
  assert.ok(common.properties.devices.items.required.includes('credential_none'));
  assert.ok(!MANUAL_SCHEMA.properties.devices.items.required.includes('credential_none'), 'manual.json では必須にしない（前の版を読むため）');
  const transcript = { entries: [
    { id: 'INT-001', status: 'answered', answer: '予備の電池にパスワードはありません。' },
    { id: 'INT-002', status: 'answered', answer: '予備の電池は棚にあります。' },
  ] };
  const statements = [{ id: 'STM-001', text: 'パスワードはありません。', evidence: ['INT-001'] }, { id: 'STM-002', text: 'パスワードはありません。', evidence: ['INT-002'] }];
  assert.deepEqual(credentialNoneProblems([{ id: 'D1', credential_location: null, credential_none: 'STM-001' }], statements, { transcript }), []);
  assert.match(credentialNoneProblems([{ id: 'D1', credential_location: null, credential_none: 'STM-002' }], statements, { transcript }).join(), /答えで「ない」と言われたときだけ/);
  assert.deepEqual(credentialNoneProblems([{ id: 'D1', credential_location: null }], statements, { transcript }), [], '欄のない前の版の機器は問題にしない');
  const old = JSON.parse(readFileSync(join(ROOT, 'samples/okojo/manual.json'), 'utf8')).manual;
  assert.ok(old.devices.every((device) => !('credential_none' in device)));
  assert.deepEqual(validate(MANUAL_SCHEMA, old), []);
});

test('機器を足す：置き場所に部屋の名前がなければ警告して止めない。同じ名前とパスワードの本体は止める', () =>
  finished((tool) => {
    tool.hikitsugi('update-start', ['佐藤']);
    const warned = writeAddedDevice(tool, { location: '棚の下の段にあります。' }).check();
    assert.match(warned, /置き場所に部屋の名前がありません（止めません）：停電用の予備の電池/);
    tool.hikitsugi('update-cancel');
    // パスワードの本体らしい答えは、記録の前に断る
    assert.throws(() => tool.hikitsugi('update-add-device', [], '予備の電池の管理画面のパスワードは abcd1234 です。'), /パスワードの本体/);
    const { check } = writeAddedDevice(tool, { extra: [statement('STM-006', 'パスワードは abcd1234 です。', 'INT-001')] });
    assert.throws(check, /認証情報の本体を書かないでください/);
    tool.hikitsugi('update-cancel');
    // 足した機器と同じ名前の機器は足せない
    writeAddedDevice(tool).check();
    passThrough(tool, 'D1');
    assert.throws(writeAddedDevice(tool).check, /D1 と同じ名前です/);
  }));

test('更新の記録の種類名：連絡先と機器は「変更」「追加」でそろえる', () => {
  assert.deepEqual(
    Object.fromEntries(['contact', 'add_contact', 'device', 'add_device', 'page', 'add', 'memo'].map((kind) => [kind, UPDATE_KIND_LABELS[kind]])),
    { contact: '連絡先の変更', add_contact: '連絡先の追加', device: '機器の変更', add_device: '機器の追加', page: '手順の修正', add: '症状の追加', memo: 'メモの取り込み' },
  );
});

// ---- 合格の条件（docs/design/stage1-update.md の「通ってほしい場面」）を 1 本の流れで確かめる ----
test('合格の条件：連絡先を足し、その連絡先を ③ にした症状ページを足し、機器を足す。記録に種類、名前、アカウント名、PC 名が並ぶ', () =>
  finished((tool) => {
    const { work, hikitsugi, read } = tool;
    withIdentity({ account: 'user-c', host: 'OKJ-PC09' }, () => {
      hikitsugi('update-start', ['佐藤']);
      // 1. エゾクロテン電設を連絡先として足す
      const contact = writeAddedContact(tool);
      contact.check();
      passThrough(tool, contact.id);
      // 1. 続けて分電盤まわりの症状ページを足し、③ にエゾクロテン電設を使う
      const { pageId } = writeAddedSymptom(tool, contact.id);
      passThrough(tool, pageId);
      // 2. 機器を 1 台足す
      const device = writeAddedDevice(tool);
      device.check();
      passThrough(tool, device.id);
    });
    const manual = read('manual-final.json');
    const bundle = JSON.parse(readFileSync(join(work, 'manual.json'), 'utf8')).manual;
    const html = readFileSync(join(work, 'manual.html'), 'utf8');
    const phone = writtenHtml(work);
    // 1. ③ の連絡先
    const page = manual.symptom_pages.find((candidate) => manual.statements.find((s) => s.id === candidate.title)?.text === PANEL_TITLE);
    assert.equal(page.fallback.contact, 'VEN-03');
    // 2. 会社のIT に載る
    assert.ok(html.slice(html.indexOf('<section id="tab-company"')).includes(UPS_NAME));
    // 3. 照合を通った文が、PC 用・スマホ用・manual.json に出る（機器はスマホ用の束にはもともと出さない）
    for (const text of [EZO.name, PANEL_TITLE]) {
      assert.ok(html.includes(text), `PC 用：${text}`);
      assert.ok(phone.includes(text), `スマホ用：${text}`);
    }
    assert.ok(bundle.contacts.some((c) => c.name === EZO.name) && bundle.symptom_pages.some((p) => p.id === page.id) && bundle.devices.some((d) => d.id === 'D1'), 'manual.json');
    // 4. 更新の記録
    assert.deepEqual(manual.updates.map(({ kind, by, account, host }) => [UPDATE_KIND_LABELS[kind], by, account, host]), [
      ['連絡先の追加', '佐藤', 'user-c', 'OKJ-PC09'],
      ['症状の追加', '佐藤', 'user-c', 'OKJ-PC09'],
      ['機器の追加', '佐藤', 'user-c', 'OKJ-PC09'],
    ]);
    assert.deepEqual(bundle.updates, manual.updates, 'manual.json にも同じ記録');
    for (const value of ['user-c', 'OKJ-PC09']) assert.ok(!html.includes(value) && !phone.includes(value), `${value} は画面に出さない`);
  }));

test('manual.json から作り直した説明書でも、足す更新を作り直しまで通せる。「分からない」の回答を根拠にした前の版の文で止まらない', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hikitsugi-stage1-bundle-'));
  try {
    const bundle = JSON.parse(readFileSync(join(ROOT, 'samples/okojo/manual.json'), 'utf8'));
    writeFileSync(join(dir, 'manual.json'), JSON.stringify(bundle));
    const work = join(dir, 'hikitsugi-work');
    const tool = {
      dir,
      work,
      hikitsugi: (command, args = [], stdin = '') => run(command, args, { work, stdin }),
      write: (name, value) => writeFileSync(join(work, name), JSON.stringify(value)),
      read: (name) => JSON.parse(readFileSync(join(work, name), 'utf8')),
    };
    const started = tool.hikitsugi('update-start', ['佐藤']);
    // サンプルには、manual.json に入れない「分からない」の回答を根拠にした文がある（STM-049 が INT-018 を引く）
    const state = tool.read('state.json');
    const omitted = state.bundle_omitted_evidence;
    assert.deepEqual(omitted, ['INT-018'], 'manual.json に入っていない根拠を覚える');
    assert.deepEqual(state.bundle_omitted_statements, ['STM-049']);
    // STM-049 は INT-011 も引くので、根拠がその回答だけの文ではない
    assert.deepEqual(state.bundle_unknown_only_statements, []);
    // 黙って除かない：件数と、引いている文の番号を画面に出す
    assert.match(started, /作り直しの検査から除いた根拠：1 件（INT-018）/);
    assert.match(started, /この回答を根拠にした前の版の文：1 件（STM-049）/);
    assert.doesNotMatch(started, /根拠がこの回答だけの文/);
    const contact = writeAddedContact(tool);
    contact.check();
    passThrough(tool, contact.id);
    const { pageId } = writeAddedSymptom(tool, contact.id);
    passThrough(tool, pageId);
    const device = writeAddedDevice(tool);
    device.check();
    passThrough(tool, device.id);
    const manual = tool.read('manual-final.json');
    assert.equal(manual.symptom_pages.find((page) => page.id === pageId).fallback.contact, contact.id);
    assert.ok(readFileSync(join(dir, 'manual.html'), 'utf8').includes(UPS_NAME));
    // 作り直した manual.json から、もう一度始められる
    rmSync(work, { recursive: true, force: true });
    tool.hikitsugi('update-start', ['佐藤']);
    assert.deepEqual(tool.read('state.json').bundle_omitted_evidence, omitted);
    // 新しく書く文が、作業フォルダの聞き取りにない根拠を引けば、今までどおり止まる
    const added = writeAddedContact(tool, { answer: EZO_ANSWER.replace('エゾクロテン電設', 'イタチ事務機'), contact: { name: 'イタチ事務機' } });
    const round = String(added.round);
    const raw = tool.read(`writer-${round}-${added.id}.json`);
    tool.write(`writer-${round}-${added.id}.json`, { ...raw, statements: raw.statements.map((s) => ({ ...s, evidence: [omitted[0]] })) });
    assert.throws(added.check);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('manual.json から作り直すとき、根拠が「分からない」の回答だけになる文は、番号を出して前の版のまま残し、作り直しまで通す', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hikitsugi-stage1-unknown-only-'));
  try {
    const bundle = JSON.parse(readFileSync(join(ROOT, 'samples/okojo/manual.json'), 'utf8'));
    const target = bundle.manual.statements.find((statement) => statement.id === 'STM-049');
    target.evidence = ['INT-018'];
    writeFileSync(join(dir, 'manual.json'), JSON.stringify(bundle));
    const work = join(dir, 'hikitsugi-work');
    const tool = {
      dir,
      work,
      hikitsugi: (command, args = [], stdin = '') => run(command, args, { work, stdin }),
      write: (name, value) => writeFileSync(join(work, name), JSON.stringify(value)),
      read: (name) => JSON.parse(readFileSync(join(work, name), 'utf8')),
    };
    const started = tool.hikitsugi('update-start', ['佐藤']);
    assert.match(started, /このうち根拠がこの回答だけの文：1 件（STM-049）。前任者が分からなかったことを書いた文として、前の版のまま残します/);
    assert.deepEqual(tool.read('state.json').bundle_unknown_only_statements, ['STM-049']);
    // 足す更新を作り直しまで通しても、その文は変わらずに残る
    const contact = writeAddedContact(tool);
    contact.check();
    passThrough(tool, contact.id);
    const kept = tool.read('manual-final.json').statements.find((statement) => statement.id === 'STM-049');
    assert.deepEqual(kept, target);
    // 表示では「社内で相談してください」が社内の相談先に置き換わるので、前半で確かめる
    assert.ok(readFileSync(join(dir, 'manual.html'), 'utf8').includes('更新の依頼先と、切れそうなときの対応は、記録がありません。'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('manual.json に「まだ分かっていないこと」の記録がないのに、記録にない根拠を引く文があれば、作業フォルダを作らずに止める', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hikitsugi-stage1-no-unknowns-'));
  try {
    const bundle = JSON.parse(readFileSync(join(ROOT, 'samples/okojo/manual.json'), 'utf8'));
    writeFileSync(join(dir, 'manual.json'), JSON.stringify({ ...bundle, unknowns: [] }));
    const work = join(dir, 'hikitsugi-work');
    assert.throws(() => run('update-start', ['佐藤'], { work }), /聞き取りの記録にない根拠があります：INT-018。manual.json に「まだ分かっていないこと」の記録がない/);
    assert.ok(!existsSync(work), '止めたときは作業フォルダを作らない');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('round の検査：回の番号がおかしい manual.json からは更新を始められず、足す更新の取り消しでも作業フォルダの外を消さない', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hikitsugi-stage1-round-'));
  try {
    const bundle = JSON.parse(readFileSync(join(ROOT, 'samples/okojo/manual.json'), 'utf8'));
    writeFileSync(join(dir, 'manual.json'), JSON.stringify({ ...bundle, round: '../../x' }));
    const work = join(dir, 'hikitsugi-work');
    assert.throws(() => run('update-start', ['佐藤'], { work, stdin: '' }), /回の番号が正しくありません/);
    assert.ok(!existsSync(work), '何も書かない');
    // 作り直せなかった作業フォルダでは、足す更新も始まらない
    mkdirSync(work);
    assert.throws(() => run('update-add-contact', ['vendor'], { work, stdin: EZO_ANSWER }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  finished((tool) => {
    tool.hikitsugi('update-start', ['佐藤']);
    tool.hikitsugi('update-add-device', [], UPS_ANSWER);
    const saved = tool.read('before-update.json');
    tool.write('before-update.json', { ...saved, state: { ...saved.state, round: '../1' } });
    assert.throws(() => tool.hikitsugi('update-cancel'), /回の番号が正しくありません/);
  });
});

test('段 1 の自動の通し：API を使わない検査（見慣れない番号の確認、退職する本人、番号でない番号、パスワード、回の番号）がすべて通る', async () => {
  const { apiFreeChecks } = await import('../eval/stage1-update.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'hikitsugi-stage1-auto-'));
  try {
    const results = apiFreeChecks(dir);
    assert.equal(results.length, 6);
    for (const result of results) assert.ok(result.passed, `${result.label}：${result.detail}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('評価の Writer の呼び出し：連絡先と機器の更新では、その 1 件の形で答えさせる', async () => {
  const { buildWriterRequest } = await import('../eval/lib/writing.mjs');
  const shape = (part) => Object.keys(buildWriterRequest({ ...sources, task: { part, revision: { previous: {}, findings: [] } } }).output_config.format.schema.properties).sort().join(',');
  assert.equal(shape('contact'), 'contact,statements');
  assert.equal(shape('device'), 'device,statements');
});
