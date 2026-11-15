// 段 2：定番の症状。20 問のあとに番号つきの一覧で選んでもらい、選ばれた症状だけ 3 問まで追加で聞く。
// 設計は docs/design/stage2-common-symptoms.md。偽の答えで流れを確かめる（API は使わない）。

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadAnswers, loadInput } from '../eval/lib/load-set.mjs';
import { approvedSymptoms, commonSymptomsOf, commonUnknownLines, coveredBy, loadCommonList, notConsultedLabels, parseSelection, planFollowups, selectionEvidenceProblems, selectionQuestion } from '../plugin/lib/common-symptoms.mjs';
import { loadLibrary } from '../plugin/lib/procedures.mjs';
import { withReplies } from '../plugin/lib/reply.mjs';
import { symptomGaps } from '../plugin/lib/symptom-check.mjs';
import { QUESTION_LIMIT } from '../plugin/lib/transcript.mjs';
import { validate } from '../plugin/lib/validate.mjs';
import { writePhoneBundle } from '../plugin/renderer/phone.mjs';
import { NO_PAGE_HEADING, renderManual } from '../plugin/renderer/render.mjs';
import { COMMANDS, nextStep, run, STDIN_COMMANDS } from '../plugin/scripts/hikitsugi.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SET = join(ROOT, 'eval/sets/okojo');
const input = loadInput(SET);
const gold = loadAnswers(SET);
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

test('一覧：本人が承認した 15 件で、形が正しく、補える部品は手順部品にある並びだけ', () => {
  const list = loadCommonList();
  assert.deepEqual(validate(readJson(join(ROOT, 'plugin/schemas/common-symptoms.schema.json')), list), []);
  assert.deepEqual(list.symptoms.map((symptom) => symptom.id), Array.from({ length: 15 }, (_, i) => `CS-${String(i + 1).padStart(2, '0')}`));
  assert.ok(list.symptoms.every((symptom) => symptom.status === 'approved' && symptom.reviewed_by && symptom.reviewed_on === '2026-11-13'));
  const sequences = new Set(loadLibrary().sequences.map((sequence) => sequence.id));
  for (const symptom of list.symptoms) for (const part of symptom.parts) assert.ok(sequences.has(part), `${symptom.id} の ${part}`);
});

test('一覧：承認していない症状は、選ぶ段に出さない', () => {
  const list = loadCommonList();
  const drafted = { ...list, symptoms: list.symptoms.map((symptom, index) => (index === 0 ? { ...symptom, status: 'draft' } : symptom)) };
  const shown = approvedSymptoms(drafted);
  assert.equal(shown.length, 14);
  assert.ok(!selectionQuestion(shown).includes(list.symptoms[0].label));
  assert.match(selectionQuestion(shown), /^社員から、次の相談を受けたことはありますか。[\s\S]*\n1\. PC が遅い・固まる/);
});

test('選ぶ段の答え：番号だけを拾い、「なし」は選ばなかったことにする。一覧にない番号と、番号のない答えは聞き直す', () => {
  assert.deepEqual(parseSelection('1、4'), { selected: ['CS-01', 'CS-04'], problems: [] });
  assert.deepEqual(parseSelection('１３と１、１'), { selected: ['CS-01', 'CS-13'], problems: [] }, '全角と重なりも読む');
  assert.deepEqual(parseSelection('なし'), { selected: [], problems: [] });
  assert.match(parseSelection('16').problems.join(), /一覧にない番号です：16/);
  assert.match(parseSelection('たぶんある').problems.join(), /番号か「なし」/);
  assert.match(parseSelection('1 と なし').problems.join(), /両方あります/);
});

test('追加の質問：本体の 20 問で答えがあった症状は聞かず、残りを一覧の順に 3 問まで聞く。超えた分は聞けなかった症状にする', () => {
  const transcript = { entries: [{ id: 'INT-001', gap: 'GAP-001', status: 'answered', answer: '全社でネットがつながらないときはクロテン通信に電話します。複合機でスキャンすると、データが NAS のスキャン用フォルダに入ります。' }] };
  assert.equal(coveredBy(approvedSymptoms()[3], transcript), 'INT-001');
  // 症状の語があるだけで、困りごとの言い方のない文は、答えがあったとは数えない（1 回目の通しで、選んだ症状が消えた）
  assert.equal(coveredBy(approvedSymptoms()[14], transcript), null);
  const plan = planFollowups(['CS-01', 'CS-02', 'CS-04', 'CS-11', 'CS-13'], transcript);
  assert.deepEqual(plan, { ask: ['CS-01', 'CS-02', 'CS-11'], covered: [{ id: 'CS-04', evidence: 'INT-001' }], over: ['CS-13'] });
});

/** 聞き取りの本体を 1 問で終え、定番の症状の段まで進める。 */
function interviewed(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'hikitsugi-common-'));
  const work = join(dir, 'work');
  const hikitsugi = (command, args = [], stdin = '') => run(command, args, { work, stdin });
  const write = (name, value) => writeFileSync(join(work, name), JSON.stringify(value));
  const read = (name) => readJson(join(work, name));
  try {
    const surveyPath = join(dir, 'survey.json');
    writeFileSync(surveyPath, JSON.stringify(input.survey));
    hikitsugi('init', [surveyPath, '田中', 'テスト', '会社']);
    const coverage = gold.gaps.items.map((item) => ({ item: item.item, state: item.state, evidence: item.evidence }));
    write('gaps.json', { coverage, gaps: [{ id: 'GAP-001', items: gold.gaps.items.filter((i) => i.state !== 'filled').map((i) => i.item), why: '理由', priority: 'high', question_hint: 'ヒント' }] });
    hikitsugi('check-gaps');
    write('next.json', { action: 'ask', gap: 'GAP-001', covers: ['CHK-37'], question: 'よくある問い合わせを教えてください', unfilled: [] });
    hikitsugi('check-next');
    hikitsugi('record', ['answered'], '全社でネットがつながらないときは、クロテン通信に電話します。');
    // 本体の聞き取りは 1 問で終えたことにする（tests/pipeline.test.mjs と同じ作り）
    write('gaps.json', { schema_version: 1, company: input.survey.company, coverage, gaps: [{ id: 'GAP-001', items: ['CHK-37'], why: '理由', priority: 'high', question_hint: 'ヒント' }] });
    write('next.json', { action: 'finish', gap: '', covers: [], question: '', unfilled: [] });
    assert.match(hikitsugi('check-next'), /続けて、定番の症状を選んでもらいます/);
    return fn({ work, hikitsugi, read });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('CLI を起動して、選ぶ段と追加の質問の答えを標準入力で渡せる（11/15、実物の流れで答えが空になって止まっていた）', () =>
  interviewed(({ work }) => {
    const cli = (args, input) => execFileSync(process.execPath, [fileURLToPath(new URL('../plugin/scripts/hikitsugi.mjs', import.meta.url)), ...args], { input, encoding: 'utf8', env: { ...process.env, HIKITSUGI_WORK: work } });
    cli(['common-list'], '');
    assert.match(cli(['common-select'], '1'), /相談されたことがある症状：印刷できない/);
    cli(['common-next'], '');
    assert.match(cli(['common-record', 'answered'], '印刷できないときは、イタチ事務機に電話します。'), /定番の症状の聞き取りを終えました/);
  }));

test('標準入力を読むコマンドの一覧は、回答を受け取るコマンド（関数の引数が 3 つ）と同じ', () => {
  const takes = Object.entries(COMMANDS).filter(([, handler]) => handler.length >= 3).map(([name]) => name).sort();
  assert.deepEqual([...STDIN_COMMANDS].sort(), takes);
});

test('流れ：20 問のあとに一覧を出し、選ばれた症状だけ追加で聞いて、Writer に進む。選ぶ段と追加の質問は 20 問に数えない', () =>
  interviewed(({ work, hikitsugi, read }) => {
    assert.deepEqual(nextStep(work), { step: 'common-symptoms', stage: 'select' });
    assert.match(hikitsugi('common-list'), /\n15\. スキャンした書類が届かない$/);
    assert.throws(() => hikitsugi('common-select', [], 'ある'), /番号か「なし」/);
    const shown = hikitsugi('common-select', [], '1、4、2、11、13');
    assert.match(shown, /相談されたことがある症状：印刷できない、PC が遅い・固まる、全社でネットがつながらない、ファイルを消した・上書きした、Teams の会議で音が出ない・映らない/);
    assert.match(shown, /聞き取りで答えがあったので、追加では聞かない症状：全社でネットがつながらない/);
    assert.match(shown, /聞かない症状：Teams の会議で音が出ない・映らない/);
    assert.deepEqual(nextStep(work), { step: 'common-symptoms', stage: 'followup', asked: 0, left: 3 });
    assert.equal(hikitsugi('common-next'), '社員から「印刷できない」と相談されたとき、どうしましたか。誰に連絡したか、何を確かめたかも教えてください。');
    hikitsugi('common-record', ['answered'], '印刷できないときは、PC を再起動してもらい、直らなければイタチ事務機に電話します。');
    assert.match(hikitsugi('common-next'), /「PC が遅い・固まる」/);
    assert.throws(() => hikitsugi('common-record', ['answered'], 'パスワードは abcd1234 です。'), /パスワードの本体/);
    hikitsugi('common-record', ['unknown']);
    assert.match(hikitsugi('common-record', ['later']), /追加 3 \/ 3 問）。定番の症状の聞き取りを終えました/);
    // 書き始める前に、退職後に聞く道を 1 問聞く（20 問に答えがないため）
    assert.equal(nextStep(work).step, 'after-leaving');
    hikitsugi('after-leaving', ['unknown']);
    // 自由に足す段（任意）。ここでは「ない」
    assert.deepEqual(nextStep(work).stage, 'list');
    hikitsugi('open-list', [], 'ない');
    assert.equal(nextStep(work).step, 'writer');
    const all = read('transcript.json').entries;
    // 最後の 2 件は、退職後に聞く道（GAP-902）と、自由に足す段（GAP-903）の記録。定番の症状の記録はその前まで
    assert.deepEqual(all.slice(-2).map((entry) => entry.gap), ['GAP-902', 'GAP-903']);
    assert.deepEqual(all.at(-2).covers, ['CHK-40']);
    const entries = all.slice(0, -2);
    assert.equal(entries.length, 5);
    assert.ok(entries.slice(1).every((entry) => entry.gap === 'GAP-900' && entry.covers[0] === 'CHK-37'));
    assert.ok(entries.length - 4 < QUESTION_LIMIT, '本体は 1 問だけ');
    // manual.json に残す形
    const common = commonSymptomsOf(read('state.json').common);
    const outcome = Object.fromEntries(common.items.map((item) => [item.id, item.outcome]));
    assert.equal(outcome['CS-01'], 'consulted');
    assert.equal(outcome['CS-04'], 'covered');
    assert.equal(outcome['CS-13'], 'not_asked');
    assert.equal(outcome['CS-15'], 'not_consulted');
    assert.equal(common.items.find((item) => item.id === 'CS-15').evidence, common.selection);
  }));

test('流れ：本体が 20 問で終わっても、選ぶ段と追加の質問は記録できる', () =>
  interviewed(({ work, hikitsugi, read }) => {
    const transcript = read('transcript.json');
    const filler = Array.from({ length: QUESTION_LIMIT - 1 }, (_, i) => ({ ...transcript.entries[0], id: `INT-${String(i + 2).padStart(3, '0')}`, answer: `答え ${i + 2}。` }));
    writeFileSync(join(work, 'transcript.json'), JSON.stringify({ ...transcript, entries: [...transcript.entries, ...filler] }));
    hikitsugi('common-select', [], '1');
    hikitsugi('common-record', ['answered'], '印刷できないときは、イタチ事務機に電話します。');
    assert.equal(read('transcript.json').entries.length, QUESTION_LIMIT + 2);
    // 書き始める前に、退職後に聞く道を 1 問聞く（20 問に答えがないため）
    assert.equal(nextStep(work).step, 'after-leaving');
    hikitsugi('after-leaving', ['unknown']);
    // 自由に足す段（任意）。ここでは「ない」
    assert.deepEqual(nextStep(work).stage, 'list');
    hikitsugi('open-list', [], 'ない');
    assert.equal(nextStep(work).step, 'writer');
  }));

test('流れ：一覧に「分からない」と答えたら、追加では聞かず、「まだ分かっていないこと」に 1 行で出る', () =>
  interviewed(({ work, hikitsugi, read }) => {
    assert.match(hikitsugi('common-select', ['unknown']), /「まだ分かっていないこと」に 1 行で載せます/);
    // 書き始める前に、退職後に聞く道を 1 問聞く（20 問に答えがないため）
    assert.equal(nextStep(work).step, 'after-leaving');
    hikitsugi('after-leaving', ['unknown']);
    // 自由に足す段（任意）。ここでは「ない」
    assert.deepEqual(nextStep(work).stage, 'list');
    hikitsugi('open-list', [], 'ない');
    assert.equal(nextStep(work).step, 'writer');
    // 最後の 2 件は退職後に聞く道と自由に足す段の記録なので、その前を見る
    const entry = read('transcript.json').entries.at(-3);
    assert.equal(entry.status, 'unknown');
    assert.deepEqual(commonSymptomsOf(read('state.json').common), { selection: entry.id, unknown: true, items: [] });
  }));

test('Writer：選んで追加の質問に答えた症状は、題名にその語のページがなければ「手順ページのない困りごと」に挙がる。選ぶ段の答えは根拠にできない', () => {
  const manual = withReplies(readJson(join(ROOT, 'test/fixtures/manual-full.json')));
  const transcript = {
    entries: [
      { id: 'INT-030', gap: 'GAP-900', covers: ['CHK-37'], status: 'answered', answer: '1、15', question: '選ぶ' },
      { id: 'INT-031', gap: 'GAP-900', covers: ['CHK-37'], status: 'answered', answer: '印刷できないときは、PC を再起動してもらいます。', question: '追加' },
      { id: 'INT-032', gap: 'GAP-900', covers: ['CHK-37'], status: 'answered', answer: 'スキャンが届かないときは、イタチ事務機に連絡します。', question: '追加' },
    ],
  };
  const common = { selection: 'INT-030', asked: [{ id: 'CS-01', evidence: 'INT-031' }, { id: 'CS-15', evidence: 'INT-032' }] };
  const gaps = symptomGaps(manual, transcript, '田中', common);
  // サンプルには「スキャンした書類が届かない」のページがあるので、印刷だけが挙がる
  assert.deepEqual(gaps, [{ id: 'SYM-1', sources: ['INT-031'], detail: '定番の症状「印刷できない」：印刷できないときは、PC を再起動してもらいます。' }]);
  assert.deepEqual(symptomGaps(manual, transcript, '田中'), [], '定番の症状の記録は、ふつうの困りごとの照合にはかけない');
  // 20 問の聞き取りに答えがあったとして追加で聞かなかった症状も、ページがなければ挙げる（選んだ症状を黙って消さない）
  const main = { entries: [{ id: 'INT-005', gap: 'GAP-001', covers: ['CHK-10'], status: 'answered', answer: '印刷できないときはイタチ事務機に電話します。', question: 'q' }] };
  assert.deepEqual(symptomGaps(manual, main, '田中', { selection: 'INT-030', asked: [], covered: [{ id: 'CS-01', evidence: 'INT-005' }] }).map((gap) => gap.sources), [['INT-005']]);
  assert.match(selectionEvidenceProblems([{ id: 'STM-900', evidence: ['INT-030'] }], common).join(), /定番の症状を選んだ答えです/);
  assert.deepEqual(selectionEvidenceProblems([{ id: 'STM-900', evidence: ['INT-031'] }], common), []);
});

test('表示：相談を受けたことがない症状は、PC 用とスマホ用の「当てはまる症状がないとき」に題名だけ並ぶ。前の版の説明書には出ない', () => {
  const manual = withReplies(readJson(join(ROOT, 'test/fixtures/manual-full.json')));
  const items = approvedSymptoms().map(({ id }) => ({ id, outcome: id === 'CS-01' ? 'consulted' : id === 'CS-13' ? 'not_asked' : 'not_consulted', evidence: 'INT-030' }));
  const withCommon = { ...manual, common_symptoms: { selection: 'INT-030', unknown: false, items } };
  // サンプルにページのある症状（ネット、Wi-Fi、共有フォルダなど）は、選ばれていなくても「ページがない症状」に並べない
  const listed = notConsultedLabels(withCommon);
  assert.ok(listed.includes('画面が映らない（モニター）') && listed.includes('PC が遅い・固まる'));
  for (const label of ['全社でネットがつながらない', '共有フォルダが見えない・開けない', 'スキャンした書類が届かない']) assert.ok(!listed.includes(label), `${label} はページがある`);
  const html = renderManual(withCommon);
  const help = html.slice(html.indexOf('<section id="tab-help"'), html.indexOf('</section>', html.indexOf('id="help-no-page"')));
  assert.ok(help.includes(NO_PAGE_HEADING));
  assert.ok(help.includes('<li>画面が映らない（モニター）</li>'));
  assert.ok(!help.includes('<li>印刷できない</li>'), '相談されたことがある症状は並べない');
  assert.ok(!help.includes('<li>Teams の会議で音が出ない・映らない</li>'), '聞けなかった症状は「まだ分かっていないこと」の側');
  assert.deepEqual(commonUnknownLines(withCommon), ['相談されたことがあるが、対応を聞けなかった症状：Teams の会議で音が出ない・映らない']);
  assert.ok(!renderManual(manual).includes(NO_PAGE_HEADING), '欄のない前の版では出さない');
  const dir = mkdtempSync(join(tmpdir(), 'hikitsugi-common-phone-'));
  try {
    writePhoneBundle(withCommon, dir);
    const last = readdirSync(dir).find((name) => name.startsWith('99 '));
    const page = readFileSync(join(dir, last), 'utf8');
    assert.ok(page.includes(NO_PAGE_HEADING) && page.includes('<li>画面が映らない（モニター）</li>'));
    assert.equal(readdirSync(dir).filter((name) => name.endsWith('.html')).length, manual.symptom_pages.length + 2, 'ファイルは増やさない');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
