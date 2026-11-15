// 操作の図。部品と同じ承認制で、本人が承認した図だけを、共有フォルダの ① の3手順にだけ付ける。
// ほかの手順には、承認済みの型と部品から組み立てる絵（plugin/lib/figure-build.mjs）を付ける。

import { readFileSync } from 'node:fs';
import { loadLibrary } from './procedures.mjs';
import { figureCandidate, figureProblems, loadKit, readKeys, stepFigureDetails, stepFigures } from './figure-build.mjs';

const FIGURES_PATH = new URL('../library/figures.json', import.meta.url);
const FIGURE_SEQUENCE = 'network-drive';

export const loadFigures = () => JSON.parse(readFileSync(FIGURES_PATH, 'utf8')).figures;

/**
 * ページの ① に付ける図を、文章の ID ごとの svg で返す。
 * ① が共有フォルダの手順と同じ部品の並びのときだけ。同じ部品を別のページや「それでも直らなければ」で使っても付けない。
 */
export function firstStepFigures(page, manual, { figures = loadFigures(), library = loadLibrary() } = {}) {
  const byId = new Map(manual.statements.map((statement) => [statement.id, statement]));
  const order = library.sequences.find((sequence) => sequence.id === FIGURE_SEQUENCE).first;
  const used = page.first_steps.map((id) => byId.get(id)?.library);
  if (used.length !== order.length || used.some((part, index) => part !== order[index])) return new Map();
  return new Map(page.first_steps.flatMap((id) => {
    const figure = figures[byId.get(id).library];
    return figure?.status === 'approved' ? [[id, figure.svg.replace('<svg ', '<svg class="step-figure" ')]] : [];
  }));
}

/**
 * ページの手順（① と ②）に付ける絵を、文章の ID ごとの svg で返す。
 * 承認済みの手描きの図（共有フォルダの ① の 3 手順）を先にし、ほかの手順には、型と部品から作る絵（キーの絵、部品を並べる絵）を付ける。
 * 自由に足した項目のページ（source が free）には付けない（承認済みの部品のない物なので）。
 */
export function pageFigures(page, manual, { figures = loadFigures(), library = loadLibrary(), kit } = {}) {
  const hand = firstStepFigures(page, manual, { figures, library });
  if (page.source === 'free') return hand;
  const made = pageFigureDetails(page, manual, { skip: new Set(hand.keys()), kit });
  return new Map([...hand, ...[...made].map(([id, detail]) => [id, detail.svg])]);
}

/**
 * 型から作る絵の中身（手描きの図を除く）。ページの ① と ② は別の並び（機器の引き継ぎは並びの中だけ）。
 * 確認の画面の【絵】の行と、評価の測定に使う。自由に足した項目のページは空。
 */
export function pageFigureDetails(page, manual, { skip, kit } = {}) {
  if (page.source === 'free') return new Map();
  const hand = skip ?? new Set(firstStepFigures(page, manual).keys());
  const options = { skip: hand, ...(kit ? { kit } : {}) };
  return new Map([...stepFigureDetails(page.first_steps, manual, options), ...stepFigureDetails(page.steps, manual, options)]);
}

/** 前任者の確認の画面に出す、ページの絵の中身の説明（文字）。機器を前の手順から引き継いだ絵は、どの手順からかを見せる（違えば「この絵は外す」）。 */
export function figureLines(page, manual, kit = loadKit()) {
  const byId = new Map(manual.statements.map((statement) => [statement.id, statement]));
  return [...pageFigureDetails(page, manual, { kit })].map(([id, detail]) => {
    const what = detail.kind === 'keys' ? detail.keys.join(' ＋ ') : detail.items.map(({ part, label }) => `${kit.parts[part].name}${label ? `「${label}」` : ''}`).join(' → ');
    const from = detail.kind === 'inherited' ? `（機器は ${detail.from}「${byId.get(detail.from).text}」から）` : '';
    return `${id}「${byId.get(id).text}」の絵：${what}${from}`;
  });
}

/** 決まった作業の手順に付ける絵。 */
export const routineFigures = (routine, manual, options = {}) => stepFigures(routine.steps, manual, options);
export const routineFigureDetails = (routine, manual, options = {}) => stepFigureDetails(routine.steps, manual, options);

/**
 * 絵の候補の手順（Figure Planner に渡す）。部品でない文で物の部品の語があり、キーの絵にも手描きの図にもならない手順。
 * 自由に足した項目のページは除く。/hikitsugi:start と評価の両方で使う。
 * @param readRef 根拠の ID から文字列を返す関数（部品は文面）
 */
export function figureCandidatesOf(manual, readRef, kit = loadKit()) {
  const byId = new Map(manual.statements.map((statement) => [statement.id, statement]));
  const slots = [
    ...manual.symptom_pages.filter((page) => page.source !== 'free').flatMap((page) => {
      const hand = new Set(firstStepFigures(page, manual).keys());
      return [...page.first_steps, ...page.steps].filter((id) => !hand.has(id));
    }),
    ...manual.routines.flatMap((routine) => routine.steps),
  ];
  return [...new Set(slots)].map((id) => byId.get(id)).filter((statement) => statement && !readKeys(statement.text) && figureCandidate(statement, kit))
    .map((statement) => ({ step: statement.id, text: statement.text, evidence: statement.evidence.map(readRef).filter(Boolean) }));
}

/** Figure Planner に渡す部品の一覧（形の SVG は渡さない）。 */
export const partsForPlanner = (kit = loadKit()) => Object.entries(kit.parts).map(([id, { name, words }]) => ({ id, name, words }));

/**
 * 担当が返した並べ方を検査する。通ったものは決めたときの文と一緒に返し、通らなかったものは理由と一緒に返す。
 * @param written { figures: [{ step, items }] }
 * @param candidates figureCandidatesOf の結果
 */
export function validateFigures(written, candidates, kit = loadKit()) {
  const byStep = new Map(candidates.map((candidate) => [candidate.step, candidate]));
  const kept = [];
  const dropped = [];
  for (const figure of written.figures ?? []) {
    const candidate = byStep.get(figure.step);
    const problems = candidate ? figureProblems(figure, candidate.text, candidate.evidence, kit) : [`${figure.step}：絵の候補の手順ではありません`];
    if (problems.length) dropped.push({ step: figure.step, problems });
    else kept.push({ step: figure.step, text: candidate.text, items: figure.items.map(({ part, label }) => ({ part, label: label ?? '' })) });
  }
  return { kept, dropped };
}
