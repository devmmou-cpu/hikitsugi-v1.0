// 枠の外を自由に足す段。挙げてもらい、種類を選び、中身を 1 問で聞く。AI も通信も使わない。

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadInput } from '../eval/lib/load-set.mjs';
import { freePageProblems, OPEN_LIMIT, openSummary, parseList, recordKind, recordList, stopOpen, writableItems } from '../plugin/lib/open-items.mjs';
import { withReplies, withoutReplies } from '../plugin/lib/reply.mjs';
import { renderManual } from '../plugin/renderer/render.mjs';
import { nextStep, run } from '../plugin/scripts/hikitsugi.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const input = loadInput(join(ROOT, 'eval/sets/okojo'));

test('挙がった物を 1 行ずつに分ける。「ない」は空。上限を超えた分は、まだ聞かない物に回す', () => {
  assert.deepEqual(parseList('・レジ\n2. 工場の機械につながる PC\n\nレジ'), ['レジ', '工場の機械につながる PC']);
  assert.deepEqual(parseList('ない'), []);
  assert.deepEqual(parseList('ありません。'), []);
  const names = Array.from({ length: OPEN_LIMIT + 2 }, (_, i) => `機器 ${i + 1}`);
  const { open, entry } = recordList({ entries: [] }, { answer: names.join('\n'), answeredAt: '2026-11-15T00:00:00Z' });
  assert.equal(entry.gap, 'GAP-903');
  assert.equal(open.items.length, OPEN_LIMIT);
  assert.deepEqual(open.not_asked, ['機器 6', '機器 7']);
  assert.throws(() => recordKind(open, 'person'), /device、contact、routine、out_of_scope/);
  // ここまでにすると、残りは「まだ聞いていないもの」
  const stopped = stopOpen(recordKind(open, 'out_of_scope'));
  assert.deepEqual(openSummary(stopped), { out_of_scope: ['機器 1'], not_asked: ['機器 2', '機器 3', '機器 4', '機器 5', '機器 6', '機器 7'] });
});

function atOpenItems(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'hikitsugi-open-'));
  const work = join(dir, 'work');
  const hikitsugi = (command, args = [], stdin = '') => run(command, args, { work, stdin });
  const read = (name) => JSON.parse(readFileSync(join(work, name), 'utf8'));
  const write = (name, value) => writeFileSync(join(work, name), JSON.stringify(value));
  try {
    const surveyPath = join(dir, 'survey.json');
    writeFileSync(surveyPath, JSON.stringify(input.survey));
    hikitsugi('init', [surveyPath, '田中', 'テスト', '会社']);
    const transcript = read('transcript.json');
    const entry = (n, answer) => ({ id: `INT-00${n}`, gap: 'GAP-001', covers: ['CHK-40'], question: '質問', answer, status: 'answered', answered_at: '2026-11-04T00:00:00Z' });
    write('transcript.json', { ...transcript, entries: [entry(1, '退職後1か月は、社長を通して答えます。')] });
    write('gaps.json', { schema_version: 1, company: input.survey.company, coverage: [], gaps: [] });
    write('state.json', { ...read('state.json'), interview_done: true });
    return fn({ work, hikitsugi, read });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('流れ：挙げてもらい、1 件ずつ種類を選んで中身を聞く。IT ではない物は中身を聞かない。答えのあった物だけを Writer に渡す', () =>
  atOpenItems(({ work, hikitsugi, read }) => {
    // 退職後の答えが 20 問にあるので、退職後の問いは出ずに、自由に足す段になる
    assert.equal(nextStep(work).stage, 'list');
    assert.match(hikitsugi('open-list', [], '測定室の検査用 PC\n月末の在庫の締め\n工場の掲示板'), /3 件を 1 件ずつ聞きます/);
    assert.deepEqual(nextStep(work).choices.map((choice) => choice.label), ['機器・ソフト', '相手（連絡先）', '決まった作業', 'IT ではない（載せない）']);
    hikitsugi('open-kind', ['device']);
    assert.match(nextStep(work).question, /^「測定室の検査用 PC」について教えてください。置き場所/);
    assert.match(hikitsugi('open-detail', [], '測定室の机の上の PC です。止まったら販売店に電話します。'), /INT-003/);
    hikitsugi('open-kind', ['out_of_scope']);
    assert.equal(nextStep(work).name, '工場の掲示板');
    hikitsugi('open-kind', ['device']);
    hikitsugi('open-unknown');
    assert.equal(nextStep(work).step, 'writer');
    const open = read('state.json').open;
    assert.deepEqual(writableItems(open), [{ name: '測定室の検査用 PC', kind: 'device', entry: 'INT-003' }]);
    assert.deepEqual(openSummary(open), { out_of_scope: ['月末の在庫の締め'], not_asked: ['工場の掲示板'] });
    hikitsugi('writer-task', ['1', 'common']);
    assert.deepEqual(read('writer-task.json').open_items, [{ name: '測定室の検査用 PC', kind: 'device', entry: 'INT-003' }]);
  }));

test('流れ：途中でやめられる。残りは、まだ聞いていないものに回る', () =>
  atOpenItems(({ work, hikitsugi, read }) => {
    hikitsugi('open-list', [], 'レジ\n業務ソフト');
    hikitsugi('open-stop');
    assert.equal(nextStep(work).step, 'writer');
    assert.deepEqual(openSummary(read('state.json').open).not_asked, ['レジ', '業務ソフト']);
    assert.throws(() => hikitsugi('open-kind', ['device']), /種類を聞く段ではありません/);
  }));

test('自由に足した物のページ：手順部品を置かない、「自分で直せる」を使わない、根拠はその物の答えだけ', () => {
  const page = { id: 'T9', title: 'STM-001', badge: { value: 'self', statement: 'STM-002' }, reassurance: 'STM-003', notes: [], first_steps: [], steps: ['STM-004', 'STM-005'], branches: [], exceptions: [], goal: null, first_goal: null, info_rows: [] };
  const statements = [
    { id: 'STM-001', text: '測定室の検査用 PC が止まった', evidence: ['INT-003'], library: null },
    { id: 'STM-002', text: '販売店に連絡します。', evidence: ['INT-003'], library: null },
    { id: 'STM-003', text: '検査のデータは消えません。', evidence: ['INT-007'], library: null },
    { id: 'STM-004', text: '', evidence: ['LIB-018'], library: 'LIB-018' },
    { id: 'STM-005', text: '販売店に電話してください。', evidence: ['INT-003'], library: null },
  ];
  const problems = freePageProblems(page, statements, new Set(['INT-003'])).join('\n');
  assert.match(problems, /「自分で直せる」は使えません/);
  assert.match(problems, /手順部品（LIB-018）は置けません/);
  assert.match(problems, /STM-003 の根拠は、その項目の答え（INT-003）だけです/);
  assert.deepEqual(freePageProblems({ ...page, badge: { value: 'vendor', statement: 'STM-002' }, steps: ['STM-005'], reassurance: 'STM-002' }, statements, new Set(['INT-003'])), []);
});

test('はじめに：対象外として挙がったものと、まだ聞いていないものを、題名だけ出す', () => {
  const manual = withReplies(withoutReplies(JSON.parse(readFileSync(join(ROOT, 'test/fixtures/manual-t1.json'), 'utf8'))));
  const html = renderManual({ ...manual, open_items: { out_of_scope: ['月末の在庫の締め'], not_asked: ['レジ'] } });
  const intro = html.match(/<section id="intro"[\s\S]*?<\/section>/)[0];
  assert.match(intro, /この説明書の対象外として挙がったもの<\/p>\n<ul class="open-items" role="list"><li>月末の在庫の締め<\/li><\/ul>/);
  assert.match(intro, /挙がったが、まだ聞いていないもの[\s\S]*<li>レジ<\/li>/);
});
