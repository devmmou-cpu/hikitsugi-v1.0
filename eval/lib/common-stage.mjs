// 評価の、定番の症状の段（段 2）。20 問の聞き取りのあとに、模擬の田中さんが一覧から選び、追加の質問に答える。
// 記録の足し方は /hikitsugi:start と同じ関数（plugin/lib/common-symptoms.mjs）を使う。
// 補足の事実（hidden/common_symptoms.json）は、この段の模擬の田中さんにだけ渡す。20 問の聞き取りの条件を前と変えないため。

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { approvedSymptoms, followupQuestion, nextFollowup, recordFollowup, recordSelection, selectionQuestion } from '../../plugin/lib/common-symptoms.mjs';
import { clientOf } from './adapters/live.mjs';
import { createMockTanaka } from './mock-tanaka.mjs';

/** 調整用の会社の補足の事実。ない会社（holdout など）は null。 */
export function loadCommonFacts(setDir) {
  const path = join(setDir, 'hidden/common_symptoms.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

/**
 * 選ぶ段の模擬の答え。補足の事実で consulted が true の症状だけを、一覧の番号で答える。
 * 補足の事実がない会社は、事実にないことなので「分からない」と答える（模擬の田中さんの決まり）。
 */
export function mockSelection(commonFacts, symptoms = approvedSymptoms()) {
  if (!commonFacts) return { answer: '', status: 'unknown' };
  const consulted = new Set(commonFacts.facts.filter((fact) => fact.consulted).map((fact) => fact.symptom));
  const numbers = symptoms.map((symptom, index) => (consulted.has(symptom.id) ? index + 1 : null)).filter(Boolean);
  return { answer: numbers.length ? numbers.join('、') : 'なし', status: 'answered' };
}

/** 補足の事実を、模擬の田中さんの事実の形にして足す。照合語と必須項目は持たせない（採点に使わない）。 */
export const withCommonFacts = (hidden, commonFacts) => ({
  ...hidden,
  facts: [...hidden.facts, ...(commonFacts?.facts ?? []).map(({ id, status, answer }) => ({ id, covers: [], status, answer, match: [] }))],
});

/**
 * 定番の症状の段を最後まで実行する。
 * @param selection 選ぶ段の答え { answer, status }
 * @param askTanaka 追加の質問を受け取り { answer, status } を返す関数
 */
export async function runCommonSymptoms({ transcript, selection, askTanaka, clock = () => new Date().toISOString(), symptoms = approvedSymptoms() }) {
  const selected = recordSelection(transcript, { ...selection, answeredAt: clock() }, symptoms);
  if (selected.problems.length) throw new Error(`選ぶ段の答えを読めません：${selected.problems.join(' / ')}`);
  let current = selected;
  const questions = [selectionQuestion(symptoms)];
  for (let symptom = nextFollowup(current.common, symptoms); symptom; symptom = nextFollowup(current.common, symptoms)) {
    const question = followupQuestion(symptom);
    questions.push(question);
    const { answer, status } = await askTanaka(question);
    current = recordFollowup(current.transcript, current.common, { answer, status, answeredAt: clock() }, symptoms);
  }
  return { transcript: current.transcript, common: current.common, questions: questions.length };
}

export async function runCommonSymptomsLive({ transcript, hidden, commonFacts, client, record = () => {} }) {
  const api = await clientOf(client);
  const askTanaka = createMockTanaka({ hidden: withCommonFacts(hidden, commonFacts), api, record });
  return runCommonSymptoms({ transcript, selection: mockSelection(commonFacts), askTanaka });
}
