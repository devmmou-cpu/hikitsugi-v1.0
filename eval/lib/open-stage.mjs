// 評価の、枠の外を自由に足す段。記録の足し方と問いは /hikitsugi:start と同じ関数（plugin/lib/open-items.mjs）を使う。
// 模擬の田中さんの答えは、補足の事実（hidden/open_items.json）からプログラムが決める。挙げる物は事実の name、種類は kind、中身は answer。
// 事実のない会社（holdout など）は「ない」と答える。20 問と定番の症状の段の条件は前と変えない。

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { nextOpenStep, openSummary, recordDetail, recordKind, recordList, writableItems } from '../../plugin/lib/open-items.mjs';

export function loadOpenFacts(setDir) {
  const path = join(setDir, 'hidden/open_items.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

export function runOpenItems({ transcript, openFacts, clock = () => new Date().toISOString() }) {
  const facts = openFacts?.items ?? [];
  const listed = recordList(transcript, { answer: facts.length ? facts.map((fact) => fact.name).join('\n') : 'ない', answeredAt: clock() });
  let current = listed.transcript;
  let { open } = listed;
  for (let step = nextOpenStep(open); step; step = nextOpenStep(open)) {
    const fact = facts.find((candidate) => candidate.name === step.item.name);
    if (step.stage === 'kind') open = recordKind(open, fact?.kind ?? 'out_of_scope');
    else {
      const recorded = recordDetail(current, open, { answer: fact?.answer ?? '分からない。', status: fact ? 'answered' : 'unknown', answeredAt: clock() });
      current = recorded.transcript;
      open = recorded.open;
    }
  }
  return { transcript: current, open, items: writableItems(open), summary: openSummary(open) };
}
