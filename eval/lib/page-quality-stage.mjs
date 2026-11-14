// 評価の、ページの質の段。記録の足し方と質問の文は /hikitsugi:start と同じ関数（plugin/lib）を使う。
// - 退職後に聞く道：20 問と定番の症状のあと、書き始める前。20 問の中に答えがあれば聞かない
// - 手順の抜け：Verifier の合格のあと、確認の前。3 問まで。答えのあったページだけを書き直す
// 補足の事実（hidden/page_facts.json）は、手順の抜けの模擬の田中さんにだけ渡す。20 問と定番の症状の段の条件を前と変えないため。

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AFTER_LEAVING_DETAIL, AFTER_LEAVING_QUESTION, afterLeavingEntries, CONTACT_SHAPE, needsAfterLeaving, recordAfterLeaving } from '../../plugin/lib/after-leaving.mjs';
import { PAGE_GAP_LIMIT, pageGapComment, pageGapQuestion, pageGaps, recordPageGap } from '../../plugin/lib/page-quality.mjs';
import { clientOf } from './adapters/live.mjs';
import { withCommonFacts } from './common-stage.mjs';
import { createMockTanaka } from './mock-tanaka.mjs';

/** 調整用の会社の補足の事実。ない会社（holdout など）は null。 */
export function loadPageFacts(setDir) {
  const path = join(setDir, 'hidden/page_facts.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

/** 補足の事実を、模擬の田中さんの事実の形にして足す。照合語と必須項目は持たせない（採点に使わない）。 */
export const withPageFacts = (hidden, pageFacts) => ({
  ...hidden,
  facts: [...hidden.facts, ...(pageFacts?.facts ?? []).map(({ id, status, answer }) => ({ id, covers: [], status, answer, match: [] }))],
});

const now = () => new Date().toISOString();

/**
 * 退職後に聞く道。20 問の中に答えがあれば聞かない。
 * 模擬の田中さんは選択肢を選べないので、答えの事実があれば「聞いてよい」とその答え、なければ「分からない」とする。
 */
export async function runAfterLeaving({ transcript, askTanaka, clock = now }) {
  if (!needsAfterLeaving(transcript)) return { transcript, asked: false, sources: afterLeavingEntries(transcript).map((entry) => entry.id) };
  const { answer, status } = await askTanaka(`${AFTER_LEAVING_QUESTION}${AFTER_LEAVING_DETAIL}`);
  // 電話番号やアドレスを含む答えは記録しない（プラグインでは聞き直す）。模擬では「分からない」として扱う
  const contactShape = status === 'answered' && CONTACT_SHAPE.test(answer);
  const choice = status === 'answered' && !contactShape ? 'yes' : 'unknown';
  const added = recordAfterLeaving(transcript, { choice, detail: choice === 'yes' ? answer : '', answeredAt: clock() });
  return { transcript: added.transcript, asked: true, choice, sources: [added.entry.id], ...(contactShape ? { rejected_contact_shape: true } : {}) };
}

export async function runAfterLeavingLive({ transcript, hidden, commonFacts, client, record = () => {} }) {
  const api = await clientOf(client);
  return runAfterLeaving({ transcript, askTanaka: createMockTanaka({ hidden: withCommonFacts(hidden, commonFacts), api, record }) });
}

/**
 * 手順の抜けの質問。3 問まで。答えのあったページの直しの指示（page_fixes）を返す。
 * @returns { transcript, asked: [{ pages, missing, status, entry }], fixes: { ページ: { comment, evidence } } }
 */
export async function runPageGaps({ manual, transcript, askTanaka, clock = now }) {
  let current = transcript;
  const asked = [];
  const fixes = {};
  for (const gap of pageGaps(manual).slice(0, PAGE_GAP_LIMIT)) {
    const { answer, status } = await askTanaka(pageGapQuestion(gap));
    const added = recordPageGap(current, gap, { answer: status === 'answered' ? answer : '分からない。', status: status === 'answered' ? 'answered' : 'unknown', answeredAt: clock() });
    current = added.transcript;
    asked.push({ pages: gap.pages, missing: gap.missing, status, entry: added.entry.id });
    if (status === 'answered') for (const page of gap.pages) fixes[page] = { comment: pageGapComment(gap, added.entry.id), evidence: added.entry.id };
  }
  return { transcript: current, asked, fixes };
}

export async function runPageGapsLive({ manual, transcript, hidden, commonFacts, pageFacts, client, record = () => {} }) {
  const api = await clientOf(client);
  const askTanaka = createMockTanaka({ hidden: withPageFacts(withCommonFacts(hidden, commonFacts), pageFacts), api, record });
  return runPageGaps({ manual, transcript, askTanaka });
}
