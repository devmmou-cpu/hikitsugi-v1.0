// 評価の、手順の絵の段。Figure Planner を API で呼び、プラグインと同じ検査（plugin/lib/figures.mjs）を通ったものだけを入れる。
import { loadKit } from '../../plugin/lib/figure-build.mjs';
import { figureCandidatesOf, partsForPlanner, validateFigures } from '../../plugin/lib/figures.mjs';
import { evidenceReader, loadLibrary } from '../../plugin/lib/procedures.mjs';
import { buildRequest, callAgent, clientOf, loadAgent, tagged } from './adapters/live.mjs';

export function figureSchema(kit = loadKit()) {
  const item = { type: 'object', additionalProperties: false, required: ['part', 'label'], properties: { part: { enum: Object.keys(kit.parts) }, label: { type: 'string' } } };
  return { type: 'object', additionalProperties: false, required: ['figures'], properties: { figures: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['step', 'items'], properties: { step: { type: 'string' }, items: { type: 'array', items: item } } } } } };
}

/** 候補の手順を作る。根拠の文は、聞き取りの答え、調査の値、部品の文面。 */
export function candidatesFor({ manual, survey, transcript }) {
  const library = new Map(loadLibrary().procedures.map((part) => [part.id, part.text]));
  const reader = evidenceReader({ survey, transcript });
  return figureCandidatesOf(manual, (ref) => (ref.startsWith('LIB-') ? library.get(ref) ?? null : reader(ref)));
}

export async function runFigurePlannerLive({ manual, survey, transcript, client, record = () => {} }) {
  const steps = candidatesFor({ manual, survey, transcript });
  if (!steps.length) return { candidates: 0, figures: [], dropped: [] };
  const api = await clientOf(client);
  const agent = loadAgent('plugin/agents/figure-planner.md');
  const parsed = await callAgent({ api, agent, params: buildRequest(agent, figureSchema(), tagged({ parts: partsForPlanner(), steps })), record, estimate: false });
  const { kept, dropped } = validateFigures(parsed, steps);
  return { candidates: steps.length, figures: kept, dropped };
}
