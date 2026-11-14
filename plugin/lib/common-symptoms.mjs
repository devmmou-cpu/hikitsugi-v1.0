// 定番の症状。聞き取りの 20 問のあとに、番号つきの一覧を文で出し、相談されたことがあるものを選んでもらう。
// 選ばれた症状だけ、3 問まで追加で聞く。選ぶ段と追加の質問は 20 問の外で数える（設計は docs/design/stage2-common-symptoms.md）。
// 一覧は本人が承認したもの（approved）だけを使う。/hikitsugi:start と評価の両方で使う。

import { readFileSync } from 'node:fs';
import { appendExtraEntry, hasCredential } from './transcript.mjs';
import { NOT_TROUBLE, TROUBLE_SIGN } from './trouble-sign.mjs';

const LIST_PATH = new URL('../checklist/common-symptoms.json', import.meta.url);

// 選ぶ段と追加の質問の記録の印。transcript の形（GAP-数字3桁）に合わせる。本体の空白は GAP-001 から
export const COMMON_GAP = 'GAP-900';
// 定番の症状は「よくある問い合わせ」の項目を埋める答え
export const COMMON_ITEM = 'CHK-37';
export const FOLLOWUP_LIMIT = 3;

export const loadCommonList = () => JSON.parse(readFileSync(LIST_PATH, 'utf8'));

/** 承認済みの症状だけを返す。承認していないものは聞き取りに出さない。 */
export const approvedSymptoms = (list = loadCommonList()) => list.symptoms.filter((symptom) => symptom.status === 'approved' && symptom.reviewed_by && symptom.reviewed_on);

const compact = (text) => String(text ?? '').normalize('NFKC').replace(/\s+/g, '');

/** 選ぶ段の質問。番号は、承認済みの一覧の並びの 1 から。 */
export function selectionQuestion(symptoms = approvedSymptoms()) {
  return [
    '社員から、次の相談を受けたことはありますか。相談されたことがあるものの番号を、「1、4」のように書いてください。ひとつもなければ「なし」と書いてください。',
    ...symptoms.map((symptom, index) => `${index + 1}. ${symptom.label}`),
  ].join('\n');
}

// 記録に残す質問文。一覧の全文は長いので、短くする
export const SELECTION_RECORD = '定番の症状の一覧のうち、社員から相談されたことがあるもの（番号）';

/**
 * 選ぶ段の答えを読む。番号だけを拾う。「なし」は選ばなかったことにする。
 * @returns { selected: string[], problems: string[] }
 */
export function parseSelection(answer, symptoms = approvedSymptoms()) {
  const text = compact(answer);
  const problems = [];
  if (hasCredential(answer)) problems.push('回答にパスワードの本体が含まれています。保管場所だけを記録してください');
  const numbers = [...text.matchAll(/\d+/g)].map((match) => Number(match[0]));
  const none = /^(?:なし|ない|ありません|ひとつもない|ひとつもありません|どれもない|どれもありません)[。.]?$/.test(text);
  if (!numbers.length && !none) problems.push('番号か「なし」で答えてもらってください');
  if (numbers.length && /なし/.test(text)) problems.push('番号と「なし」が両方あります。どちらかで答えてもらってください');
  const outside = numbers.filter((number) => number < 1 || number > symptoms.length);
  if (outside.length) problems.push(`一覧にない番号です：${outside.join('、')}（1〜${symptoms.length}）`);
  const selected = [...new Set(numbers.filter((number) => number >= 1 && number <= symptoms.length))].sort((a, b) => a - b).map((number) => symptoms[number - 1].id);
  return { selected, problems };
}

/** 追加の質問。決まった形にして、プログラムが作る。 */
export const followupQuestion = (symptom) => `社員から「${symptom.label}」と相談されたとき、どうしましたか。誰に連絡したか、何を確かめたかも教えてください。`;

/**
 * 本体の聞き取りの答えに、その症状の困りごとの文があるか。あれば追加では聞かない。
 * 症状の語があるだけの文（「スキャンすると NAS に入ります」など）は数えない。困りごとや対応先の言い方がある文だけを数える。
 */
export function coveredBy(symptom, transcript) {
  const words = symptom.words.map(compact);
  const about = (answer) => answer.split('。').some((sentence) => words.some((word) => compact(sentence).includes(word)) && TROUBLE_SIGN.test(sentence) && !NOT_TROUBLE.test(sentence));
  const entry = transcript.entries.find((candidate) => candidate.gap !== COMMON_GAP && candidate.status === 'answered' && about(candidate.answer));
  return entry?.id ?? null;
}

/**
 * 選ばれた症状を、追加で聞くもの、本体で答えがあったもの、上限で聞けないものに分ける。
 * 聞く順は一覧の並び。
 */
export function planFollowups(selected, transcript, symptoms = approvedSymptoms()) {
  const ask = [];
  const covered = [];
  const over = [];
  for (const symptom of symptoms.filter((candidate) => selected.includes(candidate.id))) {
    const by = coveredBy(symptom, transcript);
    if (by) covered.push({ id: symptom.id, evidence: by });
    else if (ask.length < FOLLOWUP_LIMIT) ask.push(symptom.id);
    else over.push(symptom.id);
  }
  return { ask, covered, over };
}

/**
 * 選ぶ段の答えを記録に足し、追加で聞く症状を決める。/hikitsugi:start と評価の両方で使う。
 * @param status answered か unknown
 * @returns { transcript, common, entry, problems }。problems があれば何も足さない
 */
export function recordSelection(transcript, { answer, status = 'answered', answeredAt }, symptoms = approvedSymptoms()) {
  const add = (fields) => appendExtraEntry(transcript, { gap: COMMON_GAP, covers: [COMMON_ITEM], question: SELECTION_RECORD, answeredAt, ...fields });
  if (status === 'unknown') {
    const added = add({ answer: '分かりません。', status: 'unknown' });
    return { ...added, common: { stage: 'done', selection: added.entry.id, unknown: true, selected: [], ask: [], covered: [], over: [], asked: [] }, problems: [] };
  }
  const { selected, problems } = parseSelection(answer, symptoms);
  if (problems.length) return { transcript, common: null, entry: null, problems };
  const added = add({ answer, status: 'answered' });
  const plan = planFollowups(selected, added.transcript, symptoms);
  return { ...added, common: { stage: plan.ask.length ? 'followup' : 'done', selection: added.entry.id, unknown: false, selected, ...plan, asked: [] }, problems: [] };
}

/** 次に追加で聞く症状。なければ null。 */
export const nextFollowup = (common, symptoms = approvedSymptoms()) => (common?.stage === 'followup' ? symptoms.find((symptom) => symptom.id === common.ask[common.asked.length]) ?? null : null);

/** 追加の質問の答えを記録に足す。 */
export function recordFollowup(transcript, common, { answer, status, answeredAt }, symptoms = approvedSymptoms()) {
  const symptom = nextFollowup(common, symptoms);
  if (!symptom) throw new Error('定番の症状の追加の質問をする段階ではありません');
  const added = appendExtraEntry(transcript, { gap: COMMON_GAP, covers: [COMMON_ITEM], question: followupQuestion(symptom), answer, status, answeredAt });
  const asked = [...common.asked, { id: symptom.id, evidence: added.entry.id, status }];
  return { ...added, common: { ...common, asked, stage: asked.length >= common.ask.length ? 'done' : 'followup' } };
}

/**
 * manual.json に残す形。選ばれなかった症状は「相談を受けたことがない」として 99 のページに題名を並べる。
 * @param common state.json の common（選ぶ段の結果と、追加の質問の記録）
 */
export function commonSymptomsOf(common, symptoms = approvedSymptoms()) {
  if (!common?.selection) return null;
  if (common.unknown) return { selection: common.selection, unknown: true, items: [] };
  const asked = new Map((common.asked ?? []).map((entry) => [entry.id, entry.evidence]));
  const covered = new Map((common.covered ?? []).map((entry) => [entry.id, entry.evidence]));
  const items = symptoms.map(({ id }) => {
    if (asked.has(id)) return { id, outcome: 'consulted', evidence: asked.get(id) };
    if (covered.has(id)) return { id, outcome: 'covered', evidence: covered.get(id) };
    if ((common.over ?? []).includes(id) || (common.ask ?? []).includes(id)) return { id, outcome: 'not_asked', evidence: common.selection };
    return { id, outcome: 'not_consulted', evidence: common.selection };
  });
  return { selection: common.selection, unknown: false, items };
}

/** 一覧の題名を、今の承認済みの一覧から引く。一覧から外れた症状は出さない。 */
const labelsOf = (ids, list) => {
  const byId = new Map(list.symptoms.filter((symptom) => symptom.status === 'approved').map((symptom) => [symptom.id, symptom.label]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
};

/**
 * 相談を受けたことがないと答えた症状の題名。99 のページに並べる。
 * 題名にその症状の語がある手順ページがあれば並べない。20 問の聞き取りからページができている症状を「ページがない」と出さないため。
 */
export function notConsultedLabels(manual, list = loadCommonList()) {
  const text = new Map(manual.statements.map((statement) => [statement.id, statement.text]));
  const titles = manual.symptom_pages.map((page) => compact(text.get(page.title)));
  const words = new Map(list.symptoms.map((symptom) => [symptom.id, symptom.words.map(compact)]));
  const hasPage = (id) => (words.get(id) ?? []).some((word) => titles.some((title) => title.includes(word)));
  return labelsOf((manual.common_symptoms?.items ?? []).filter((item) => item.outcome === 'not_consulted' && !hasPage(item.id)).map((item) => item.id), list);
}

/** 「まだ分かっていないこと」に足す 1 行。選んだが上限で聞けなかった症状。選ぶ段の「分からない」は、記録から自動で出る。 */
export function commonUnknownLines(manual, list = loadCommonList()) {
  const labels = labelsOf((manual.common_symptoms?.items ?? []).filter((item) => item.outcome === 'not_asked').map((item) => item.id), list);
  return labels.length ? [`相談されたことがあるが、対応を聞けなかった症状：${labels.join('、')}`] : [];
}

/** 選ぶ段の答えは、ページの文の根拠にしない。選んだことは、手順の根拠にならないため。 */
export function selectionEvidenceProblems(statements, common) {
  if (!common?.selection) return [];
  return statements.filter((statement) => (statement.evidence ?? []).includes(common.selection)).map((statement) => `${statement.id}: ${common.selection} は定番の症状を選んだ答えです。手順やページの文の根拠にはできません`);
}
