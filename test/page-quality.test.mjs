// ページの質（物に触る手順の見分け方、待つ時間、直ったかの確かめ方）と、退職後に聞く道。AI も通信も使わない。

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadInput } from '../eval/lib/load-set.mjs';
import { runAfterLeaving, runPageGaps } from '../eval/lib/page-quality-stage.mjs';
import { afterLeavingProblems, needsAfterLeaving, recordAfterLeaving } from '../plugin/lib/after-leaving.mjs';
import { commonSchema } from '../plugin/lib/assemble.mjs';
import { missingNote, pageChecks, pageGapQuestion, pageGaps, unsupportedWaits } from '../plugin/lib/page-quality.mjs';
import { evidenceReader } from '../plugin/lib/procedures.mjs';
import { withoutReplies, withReplies } from '../plugin/lib/reply.mjs';
import { validate } from '../plugin/lib/validate.mjs';
import { renderPhoneBundle } from '../plugin/renderer/phone.mjs';
import { renderManual } from '../plugin/renderer/render.mjs';
import { nextStep, run } from '../plugin/scripts/hikitsugi.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const input = loadInput(join(ROOT, 'eval/sets/okojo'));
const fixture = () => withoutReplies(JSON.parse(readFileSync(join(ROOT, 'test/fixtures/manual-t1.json'), 'utf8')));

/** 物に触る手順のページを足した説明書。steps は [ID, 文] の並び。 */
function withPhysicalPages(pages) {
  const base = fixture();
  const [template] = base.symptom_pages;
  const statements = [...base.statements];
  const add = (id, text) => statements.push({ id, text, evidence: ['INT-001'], library: null });
  const symptomPages = pages.map(({ id, title, steps, notes = [], goal = null }, index) => {
    add(`STM-8${index}0`, title);
    for (const [sid, text] of [...steps, ...notes, ...(goal ? [goal] : [])]) add(sid, text);
    return { ...template, id, title: `STM-8${index}0`, steps: steps.map(([sid]) => sid), notes: notes.map(([sid]) => sid), goal: goal?.[0] ?? null };
  });
  return { ...base, statements, symptom_pages: [template, ...symptomPages] };
}

const AP_PAGE = { id: 'T2', title: '工場の Wi-Fi が切れる', steps: [['STM-811', '工場の入口に近い柱の上にある AP の、電源アダプターを抜いてください。'], ['STM-812', '10秒待ってください。'], ['STM-813', '電源アダプターを差し直してください。']] };
const CABLE_A = { id: 'T3', title: '不審なメールが届いた', steps: [['STM-821', 'LAN ケーブルを抜いてください。']] };
const CABLE_B = { id: 'T4', title: '感染が疑われる', steps: [['STM-831', 'LAN ケーブルを抜いてください。']] };
const NAS_PAGE = { id: 'T5', title: '停電のあと NAS が動かない', steps: [['STM-841', 'NAS の電源ボタンを押してください。']] };
const LAPTOP = { id: 'T6', title: 'ノート PC の電源が入らない', steps: [['STM-851', 'ノート PC に、電源アダプターをつないでください。']] };

test('物に触る手順のページを見つけ、足りない項目を出す。画面の操作の部品は数えない', () => {
  const manual = withPhysicalPages([AP_PAGE, CABLE_A]);
  // 共有フォルダの部品だけのページは、物に触る手順のページではない
  assert.equal(pageChecks(manual.symptom_pages[0], manual), null);
  assert.deepEqual(pageChecks(manual.symptom_pages[1], manual), { physical: ['STM-811', 'STM-813'], needs: ['mark', 'wait', 'confirm'], missing: ['confirm'], said_none: [] });
  // ケーブルを抜くだけの手順には、待つ時間は要らない
  assert.deepEqual(pageChecks(manual.symptom_pages[2], manual).needs, ['mark', 'confirm']);
  assert.deepEqual(pageChecks(manual.symptom_pages[2], manual).missing, ['mark', 'confirm']);
});

test('「差し込み口」「つないである」は、電源を入れ直す手順と数えない（待つ時間を求めない）', () => {
  const manual = withPhysicalPages([
    { id: 'T3', title: '不審なメール', steps: [['STM-821', 'PC の裏の四角い差し込み口にある LAN ケーブルを、爪を押しながら引いて抜いてください。']] },
    { id: 'T4', title: '感染', steps: [['STM-831', '疑われる PC につないである LAN ケーブルを抜いてください。']] },
  ]);
  assert.deepEqual(pageChecks(manual.symptom_pages[1], manual).needs, ['mark', 'confirm']);
  assert.deepEqual(pageChecks(manual.symptom_pages[2], manual).needs, ['mark', 'confirm']);
  assert.deepEqual(pageChecks(withPhysicalPages([AP_PAGE]).symptom_pages[1], withPhysicalPages([AP_PAGE])).needs, ['mark', 'wait', 'confirm']);
});

test('そろっているページ、「記録がありません」と書いたページは、聞かない', () => {
  const complete = { ...AP_PAGE, goal: ['STM-819', '工場の PC の Wi-Fi の一覧に工場の名前が出れば、直っています。'] };
  const saidNone = { ...CABLE_A, notes: [['STM-829', 'LAN ケーブルの置き場所と目印は、記録がありません。直ったかの確かめ方も、記録がありません。']] };
  const manual = withPhysicalPages([complete, saidNone]);
  assert.deepEqual(pageChecks(manual.symptom_pages[1], manual).missing, []);
  assert.deepEqual(pageChecks(manual.symptom_pages[2], manual).said_none, ['mark', 'confirm']);
  assert.deepEqual(pageGaps(manual), []);
});

test('聞くページは、電源の入れ直しとケーブルを先にし、同じ手順の文は 1 問にまとめる', () => {
  const manual = withPhysicalPages([LAPTOP, CABLE_A, CABLE_B, AP_PAGE]);
  const gaps = pageGaps(manual);
  assert.deepEqual(gaps.map((gap) => gap.pages), [['T6'], ['T3', 'T4'], ['T2']]);
  assert.deepEqual(gaps[0].missing, ['mark', 'wait', 'confirm']);
  const question = pageGapQuestion(gaps[1]);
  assert.match(question, /^「不審なメールが届いた」のページの手順「LAN ケーブルを抜いてください。」について教えてください。/);
  assert.match(question, /どこにあって、何が目印ですか.*直ったことは、何で分かりますか.*分からないものは「分からない」/);
  assert.doesNotMatch(question, /どのくらい待ちますか/);
});

test('足りない項目が残ったページには、決まった文を出す（数字や見分け方は書かない）', () => {
  const manual = withReplies(withPhysicalPages([AP_PAGE, CABLE_A]));
  assert.equal(missingNote(manual.symptom_pages[1], manual), '直ったかの確かめ方は、記録がありません。分からないときは、③ の相手に聞いてください。');
  assert.equal(missingNote(manual.symptom_pages[0], manual), null);
  const html = renderManual(manual);
  const article = html.match(/<article[^>]*id="symptom-T3"[\s\S]*?<\/article>/)[0];
  assert.ok(article.includes('触る物の置き場所と目印、直ったかの確かめ方は、記録がありません。'));
  assert.equal(renderPhoneBundle(manual).filter((file) => file.html.includes('は、記録がありません。分からないときは')).length, 2);
});

test('根拠のない待つ時間の数字を見つける', () => {
  const sources = { survey: input.survey, transcript: { ...input.transcript, entries: [...input.transcript.entries, { id: 'INT-950', gap: 'GAP-901', covers: ['CHK-00'], question: '質問', answer: '差し直したら 2〜3分待ちます。', status: 'answered', answered_at: '2026-11-14T00:00:00Z' }] } };
  const manual = { statements: [
    { id: 'STM-001', text: '2〜3分待ってください。', evidence: ['INT-950'], library: null },
    { id: 'STM-002', text: '5分待ってください。', evidence: ['INT-950'], library: null },
    { id: 'STM-003', text: '30分の会議のあとに確かめてください。', evidence: ['INT-950'], library: null },
  ] };
  assert.deepEqual(unsupportedWaits(manual, evidenceReader(sources)).map((found) => found.statement), ['STM-002']);
});

// ---- プラグインの流れ ----
function atPageGaps(pages, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'hikitsugi-page-gap-'));
  const work = join(dir, 'hikitsugi-work');
  const surveyPath = join(dir, 'survey-input.json');
  writeFileSync(surveyPath, JSON.stringify(input.survey));
  const hikitsugi = (command, args = [], stdin = '') => run(command, args, { work, stdin });
  const write = (name, value) => writeFileSync(join(work, name), JSON.stringify(value));
  const read = (name) => JSON.parse(readFileSync(join(work, name), 'utf8'));
  try {
    run('init', [surveyPath, '田中', '会社'], { work });
    const manual = withReplies(withPhysicalPages(pages));
    write('survey.json', { ...input.survey, items: [] });
    const entry = (n, answer) => ({ id: `INT-00${n}`, gap: 'GAP-001', covers: ['CHK-01'], question: '質問', answer, status: 'answered', answered_at: '2026-11-04T00:00:00Z' });
    write('transcript.json', { ...read('transcript.json'), entries: [entry(1, '保守はカワウソシステムサービスで、連絡先は 03-0000-0102 です。')] });
    write('gaps.json', { schema_version: 1, company: 'okojo', coverage: [], gaps: [] });
    for (const name of ['manual-final.json', 'manual-1.json', 'edited-1.json']) write(name, manual);
    write('verification-1.json', { schema_version: 1, company: 'okojo', round: 1, results: manual.statements.map(({ id }) => ({ statement: id, verdict: 'correct', reason: '', checked: [], conflicts_with: [] })) });
    write('state.json', { company: 'okojo', company_name: '会社', retiree: '田中', round: 1, interview_done: true, passed: true });
    return fn({ work, hikitsugi, write, read });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('確認の前に手順の抜けを 3 問まで聞き、答えのあったページだけを書き直す', () =>
  atPageGaps([LAPTOP, CABLE_A, CABLE_B, AP_PAGE, NAS_PAGE], ({ work, hikitsugi, read }) => {
    const first = nextStep(work);
    assert.equal(first.step, 'page-gap');
    assert.equal(first.page, 'T6');
    assert.equal(first.left, 3);
    assert.deepEqual(first.missing, ['触る物の置き場所と目印', '待つ時間', '直ったかの確かめ方']);
    assert.throws(() => hikitsugi('page-gap-answer', ['T9'], '棚の上です'), /手順の抜けのページではありません/);
    assert.match(hikitsugi('page-gap-answer', ['T6'], 'アダプターはノート PC の袋の中の黒いものです。30分充電して、画面にロゴが出れば直っています。'), /INT-002.*残り 2 問/);
    const added = read('transcript.json').entries.at(-1);
    assert.equal(added.gap, 'GAP-901');
    // 同じ手順の 2 ページは 1 問。「分からない」は書き直さない
    assert.deepEqual(nextStep(work).pages, ['T3', 'T4']);
    assert.match(hikitsugi('page-gap-unknown', ['T3']), /残り 1 問/);
    assert.equal(nextStep(work).page, 'T2');
    // 3 問を聞き終えたら、4 つ目（T5）は聞かずに、答えのあったページだけを書き直す
    assert.match(hikitsugi('page-gap-answer', ['T2'], '差し直したら 2〜3分待ちます。ランプが緑になれば直っています。'), /2 ページを、答えのとおりに書き直します：T6、T2/);
    assert.deepEqual(nextStep(work), { step: 'writer', round: 2, part: 'T6' });
    hikitsugi('writer-task', ['2', 'T6']);
    const task = read('writer-task.json');
    assert.equal(task.revision.page_fix.evidence, 'INT-002');
    assert.match(task.revision.page_fix.comment, /答えにないものは書かず、数字を作らないでください/);
    const state = read('state.json');
    assert.equal(state.page_gap_questions, 3);
    assert.deepEqual(Object.keys(state.page_gaps).sort(), ['T2', 'T3', 'T4', 'T6']);
  }));

test('全部「分からない」なら書き直さず、記録がないことを決まった文で出す', () =>
  atPageGaps([CABLE_A], ({ work, hikitsugi, read }) => {
    assert.equal(nextStep(work).step, 'page-gap');
    assert.match(hikitsugi('page-gap-unknown', ['T3']), /書き直すページはありません/);
    assert.equal(nextStep(work).step, 'phrases');
    assert.match(hikitsugi('review-show', ['T3']), /【記録がないもの】\n触る物の置き場所と目印、直ったかの確かめ方は、記録がありません。/);
    assert.equal(read('state.json').passed, true);
  }));

// ---- 退職後に聞く道 ----
const entry = (id, answer, extra = {}) => ({ id, gap: 'GAP-001', covers: ['CHK-39', 'CHK-40'], question: '質問', answer, status: 'answered', answered_at: '2026-11-14T00:00:00Z', ...extra });

test('20 問の中に退職後の答えがあれば聞かない。なければ 1 問だけ聞く', () => {
  assert.equal(needsAfterLeaving({ entries: [entry('INT-001', '社内で詳しいのは係長です。退職後の2週間は、社長を通して質問をもらえば答えます。')] }), false);
  assert.equal(needsAfterLeaving({ entries: [entry('INT-001', '社内で詳しいのは係長です。')] }), true);
  const added = recordAfterLeaving({ entries: [] }, { choice: 'no', answeredAt: '2026-11-14T00:00:00Z' });
  assert.equal(added.entry.answer, '退職したあとは、聞かないでほしい。');
  assert.equal(needsAfterLeaving(added.transcript), false);
  assert.throws(() => recordAfterLeaving({ entries: [] }, { choice: 'yes', detail: 'tanaka@example.com にどうぞ', answeredAt: '' }), /記録しません/);
  assert.throws(() => recordAfterLeaving({ entries: [] }, { choice: 'maybe', answeredAt: '' }), /yes/);
});

test('退職後の 1 文：根拠は退職後の答え、社内の相手を通す、個人の連絡先を書かない', () => {
  const transcript = { entries: [entry('INT-005', '退職後1か月は、社長経由のメールで質問に答えられます。'), entry('INT-006', '複合機はイタチ事務機です。')] };
  const contacts = [{ id: 'INH-01', name: '社長' }];
  const statements = (text, evidence = ['INT-005']) => [{ id: 'STM-100', text, evidence, library: null }];
  const ok = '前任の担当者には、退職後1か月まで、社長を通してメールで聞けます。';
  assert.deepEqual(afterLeavingProblems({ after_leaving: 'STM-100', contacts }, statements(ok), transcript), []);
  assert.match(afterLeavingProblems({ after_leaving: 'STM-100', contacts }, statements(ok, ['INT-006']), transcript).join(), /根拠は退職後の答え/);
  assert.match(afterLeavingProblems({ after_leaving: 'STM-100', contacts }, statements('前任の担当者に直接聞けます。'), transcript).join(), /社内の相手/);
  assert.match(afterLeavingProblems({ after_leaving: 'STM-100', contacts }, statements('社長を通して 03-0000-0199 に電話できます。'), transcript).join(), /電話番号やアドレス/);
  assert.match(afterLeavingProblems({ after_leaving: 'STM-100', contacts }, statements(ok), { entries: [] }).join(), /null にしてください/);
  // この段で「聞いてよい」と答えたのに書かなければ、書くよう求める
  const said = recordAfterLeaving({ entries: [] }, { choice: 'yes', detail: '1か月、社長からメールで', answeredAt: '' }).transcript;
  assert.match(afterLeavingProblems({ after_leaving: null, contacts }, [], said).join(), /after_leaving に 1 文を書いてください/);
  // 欄は任意（前の版の共通部分も形の検査を通る）
  assert.ok(!commonSchema().required.includes('after_leaving'));
  assert.ok(commonSchema().properties.after_leaving);
});

test('はじめに（PC 用と印刷）に、退職後に聞く道を出す。前任者の名前は出さない', () => {
  const manual = withReplies(fixture());
  manual.statements.push({ id: 'STM-990', text: '前任の担当者には、退職後1か月まで、社長を通して聞けます。', evidence: ['INT-001'], library: null });
  const html = renderManual({ ...manual, after_leaving: 'STM-990' });
  const intro = html.match(/<section id="intro"[\s\S]*?<\/section>/)[0];
  assert.match(intro, /前任者に聞くとき<\/p>\n<p class="intro-text">前任の担当者には、退職後1か月まで、社長を通して聞けます。/);
  assert.doesNotMatch(renderManual(withReplies(fixture())), /前任者に聞くとき/);
});

// ---- 評価の段 ----
test('評価：手順の抜けは 3 問まで聞き、答えのあったページの直しの指示を返す', async () => {
  const manual = withPhysicalPages([LAPTOP, CABLE_A, CABLE_B, AP_PAGE]);
  const asked = [];
  const answers = ['袋の中の黒いアダプターです。', null, '2〜3分待ちます。'];
  const result = await runPageGaps({
    manual,
    transcript: { ...input.transcript, entries: input.transcript.entries.slice(0, 1) },
    askTanaka: async (question) => {
      const answer = answers[asked.length];
      asked.push(question);
      return answer ? { answer, status: 'answered' } : { answer: '分かりません。', status: 'unknown' };
    },
    clock: () => '2026-11-14T00:00:00Z',
  });
  assert.equal(asked.length, 3);
  assert.deepEqual(result.asked.map((entry) => [entry.pages, entry.status]), [[['T6'], 'answered'], [['T3', 'T4'], 'unknown'], [['T2'], 'answered']]);
  assert.deepEqual(Object.keys(result.fixes), ['T6', 'T2']);
  assert.equal(result.transcript.entries.filter((e) => e.gap === 'GAP-901').length, 3);
});

test('評価：退職後の答えが 20 問にあれば聞かない。電話番号の入った答えは「分からない」として記録する', async () => {
  const answered = { entries: [entry('INT-001', '退職後1か月は、社長経由のメールで答えます。')] };
  const skipped = await runAfterLeaving({ transcript: answered, askTanaka: async () => assert.fail('聞かない') });
  assert.deepEqual([skipped.asked, skipped.sources], [false, ['INT-001']]);
  const phone = await runAfterLeaving({ transcript: { entries: [] }, askTanaka: async () => ({ answer: '03-0000-0199 に電話してください。', status: 'answered' }), clock: () => '' });
  assert.equal(phone.choice, 'unknown');
  assert.equal(phone.rejected_contact_shape, true);
  const yes = await runAfterLeaving({ transcript: { entries: [] }, askTanaka: async () => ({ answer: '1か月は社長を通して答えます。', status: 'answered' }), clock: () => '' });
  assert.equal(yes.transcript.entries[0].answer, '退職したあとも、社長を通して聞いてよい。1か月は社長を通して答えます。');
  assert.equal(validate(JSON.parse(readFileSync(join(ROOT, 'plugin/schemas/transcript.schema.json'), 'utf8')), { ...input.transcript, entries: yes.transcript.entries.map((e) => ({ ...e, answered_at: '2026-11-14T00:00:00Z' })) }).length, 0);
});
