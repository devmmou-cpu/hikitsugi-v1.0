// 段 2：定番の症状の評価の段と測定（模擬評価）。API は使わない。

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { measure } from '../eval/common-symptoms-eval.mjs';
import { loadCommonFacts, mockSelection, runCommonSymptoms, withCommonFacts } from '../eval/lib/common-stage.mjs';
import { withReplies } from '../plugin/lib/reply.mjs';
import { validate } from '../plugin/lib/validate.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SET = join(ROOT, 'eval/sets/okojo');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

test('評価：模擬の田中さんは、補足の事実で「ある」の症状だけを番号で選ぶ。補足の事実のない会社は「分からない」', () => {
  const okojo = loadCommonFacts(SET);
  assert.deepEqual(mockSelection(okojo), { answer: '1、2、11', status: 'answered' });
  assert.deepEqual(mockSelection(null), { answer: '', status: 'unknown' });
  assert.deepEqual(mockSelection({ facts: okojo.facts.filter((fact) => !fact.consulted) }), { answer: 'なし', status: 'answered' });
  // 補足の事実は照合語と必須項目を持たない形で足す（採点に使わない）
  const merged = withCommonFacts({ rules: [], facts: [{ id: 'F-01', covers: ['CHK-01'], status: 'answered', answer: 'a', match: ['a'] }] }, okojo);
  assert.ok(merged.facts.slice(1).every((fact) => fact.covers.length === 0 && fact.match.length === 0));
});

test('評価：定番の症状の段を、/hikitsugi:start と同じ記録の形で最後まで進める', async () => {
  const transcript = { schema_version: 1, company: 'okojo', entries: [{ id: 'INT-001', gap: 'GAP-001', covers: ['CHK-37'], question: '質問', answer: '全社でネットがつながらないときはクロテン通信に電話します。', status: 'answered', answered_at: 't' }] };
  const asked = [];
  const result = await runCommonSymptoms({ transcript, selection: { answer: '1、4、11', status: 'answered' }, askTanaka: async (question) => { asked.push(question); return { answer: '分かりません。', status: 'unknown' }; }, clock: () => 't' });
  assert.equal(asked.length, 2, 'ネットは 20 問の答えにあるので聞かない');
  assert.equal(result.questions, 3);
  assert.equal(result.common.stage, 'done');
  assert.deepEqual(validate(readJson(join(ROOT, 'plugin/schemas/transcript.schema.json')), result.transcript), []);
});

test('評価の測定：「ない」の症状のページと、選ぶ段を根拠にした文を数える', () => {
  const root = mkdtempSync(join(tmpdir(), 'hikitsugi-common-measure-'));
  try {
    const dir = join(root, '20261113T000000-okojo-pipeline');
    mkdirSync(dir);
    const manual = withReplies(readJson(join(ROOT, 'test/fixtures/manual-full.json')));
    const entries = [
      { id: 'INT-001', gap: 'GAP-001', covers: ['CHK-37'], question: 'q', answer: 'a', status: 'answered', answered_at: 't' },
      { id: 'INT-002', gap: 'GAP-900', covers: ['CHK-37'], question: '定番の症状の一覧のうち、社員から相談されたことがあるもの（番号）', answer: '1', status: 'answered', answered_at: 't' },
    ];
    writeFileSync(join(dir, 'manual-final.json'), JSON.stringify(manual));
    writeFileSync(join(dir, 'transcript.json'), JSON.stringify({ entries: entries.slice(0, 1) }));
    writeFileSync(join(dir, 'common-symptoms.json'), JSON.stringify({ transcript: { entries } }));
    const clean = measure(dir);
    assert.equal(clean.label, '模擬評価');
    assert.deepEqual(clean.violations, []);
    assert.deepEqual(clean.questions, { interview: 1, common_stage: 1, minutes_estimate: 1.9 });
    // 「ない」と答えた症状（オコジョ精工の Teams）のページができたら数える。選ぶ段を根拠にした文も数える
    const page = manual.symptom_pages[0];
    const title = manual.statements.find((statement) => statement.id === page.title);
    const broken = { ...manual, statements: manual.statements.map((statement) => (statement.id === title.id ? { ...statement, text: 'Teams の会議で音が出ない', evidence: ['INT-002'] } : statement)) };
    writeFileSync(join(dir, 'manual-final.json'), JSON.stringify(broken));
    const found = measure(dir);
    assert.deepEqual(found.violations.map((row) => row.id), ['CS-13']);
    // 20 問の聞き取りからできるページが、追加の質問の答えを根拠に足しただけなら数えない（2 回目の通しのクズリ運輸）
    const followup = { id: 'INT-099', gap: 'GAP-900', covers: ['CHK-37'], question: '追加', answer: 'a', status: 'answered', answered_at: 't' };
    writeFileSync(join(dir, 'common-symptoms.json'), JSON.stringify({ transcript: { entries: [...entries, followup] }, common: { asked: [{ id: 'CS-01', evidence: 'INT-099' }] } }));
    const sharedTitle = { ...manual, statements: manual.statements.map((statement) => (statement.id === title.id ? { ...statement, text: 'パスワードを忘れた人がいる', evidence: ['INT-001', 'INT-099'] } : statement)) };
    writeFileSync(join(dir, 'manual-final.json'), JSON.stringify(sharedTitle));
    assert.deepEqual(measure(dir).violations, []);
    const onlyFollowup = { ...sharedTitle, statements: sharedTitle.statements.map((statement) => ({ ...statement, evidence: statement.evidence.map((ref) => (ref.startsWith('INT-') ? 'INT-099' : ref)) })) };
    writeFileSync(join(dir, 'manual-final.json'), JSON.stringify(onlyFollowup));
    assert.ok(measure(dir).violations.some((row) => row.id === 'CS-08'), '追加の質問の答えだけでできた、事実なしの症状のページは数える');
    assert.deepEqual(found.selection_cited, [title.id]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
