#!/usr/bin/env node
// 段 2 の測定（模擬評価）。保存した通しの結果から、API を使わずに数える。
// - 定番の一覧のうち、題名にその症状の語がある手順ページの割合
// - 「ない」と答えた症状と、事実がない症状に、定番の症状の段からページや手順ができていないこと（0 件）
// - 聞き取りの問数（20 問の本体と、定番の症状の段）と、答える時間の見積もり
// 使い方：node eval/common-symptoms-eval.mjs <通しの結果のフォルダ>...（holdout の結果は渡さない）

import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { approvedSymptoms, COMMON_GAP } from '../plugin/lib/common-symptoms.mjs';
import { pageStatementIds } from '../plugin/lib/page-check.mjs';
import { loadCommonFacts } from './lib/common-stage.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// 録画の通しで、20 問に答える部分が約 18 分だった（README）。1 問約 0.9 分として見積もる。実測ではない
const MINUTES_PER_QUESTION = 0.9;
const TUNING = ['okojo', 'kuzuri', 'kinodoten'];

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const compact = (text) => String(text ?? '').normalize('NFKC').replace(/\s+/g, '');

/** 1 回分の通しの結果を数える。 */
export function measure(dir, symptoms = approvedSymptoms()) {
  const company = basename(dir).match(/-(okojo|kuzuri|kinodoten)-pipeline$/)?.[1];
  if (!company) throw new Error(`調整用 3 社の通しの結果ではありません：${dir}`);
  const manual = readJson(join(dir, 'manual-final.json'));
  const transcript = readJson(join(dir, 'transcript.json'));
  // 定番の症状の段のある通しでは、記録は common-symptoms.json の側にある
  const full = existsSync(join(dir, 'common-symptoms.json')) ? readJson(join(dir, 'common-symptoms.json')).transcript : transcript;
  const facts = loadCommonFacts(join(ROOT, 'eval/sets', company));
  const text = new Map(manual.statements.map((statement) => [statement.id, statement]));
  const commonEntries = new Set(full.entries.filter((entry) => entry.gap === COMMON_GAP).map((entry) => entry.id));
  const selection = full.entries.find((entry) => entry.gap === COMMON_GAP && entry.question.startsWith('定番の症状の一覧'))?.id ?? null;
  const pages = manual.symptom_pages.map((page) => {
    const ids = pageStatementIds(page);
    const evidence = new Set(ids.flatMap((id) => text.get(id)?.evidence ?? []));
    return { id: page.id, title: compact(text.get(page.title)?.text), fromCommon: [...evidence].some((ref) => commonEntries.has(ref)) };
  });
  const status = (symptom) => {
    const fact = facts?.facts.find((candidate) => candidate.symptom === symptom.id);
    return fact ? (fact.consulted ? 'ある' : 'ない') : '事実なし';
  };
  const rows = symptoms.map((symptom) => {
    const matching = pages.filter((page) => symptom.words.some((word) => page.title.includes(compact(word))));
    return { id: symptom.id, label: symptom.label, supplement: status(symptom), pages: matching.map((page) => page.id), from_common: matching.filter((page) => page.fromCommon).map((page) => page.id) };
  });
  // 「ない」と「事実なし」の症状に、定番の症状の段からできたページ。「ない」の症状はページそのものがあれば数える（どれも前はページのなかった症状）
  const violations = rows.filter((row) => row.supplement !== 'ある' && (row.from_common.length || (row.supplement === 'ない' && row.pages.length)));
  const selectionCited = manual.statements.filter((statement) => selection && statement.evidence.includes(selection)).map((statement) => statement.id);
  const main = transcript.entries.filter((entry) => entry.gap !== COMMON_GAP && entry.gap !== 'GAP-000').length;
  const extra = commonEntries.size;
  return {
    label: '模擬評価',
    dir: basename(dir),
    company,
    with_common_stage: commonEntries.size > 0,
    pages_ratio: `${rows.filter((row) => row.pages.length).length}/${rows.length}`,
    consulted_with_page: `${rows.filter((row) => row.supplement === 'ある' && row.pages.length).length}/${rows.filter((row) => row.supplement === 'ある').length}`,
    violations: violations.map(({ id, supplement, pages: found }) => ({ id, supplement, pages: found })),
    selection_cited: selectionCited,
    questions: { interview: main, common_stage: extra, minutes_estimate: Number(((main + Math.max(0, extra - 1)) * MINUTES_PER_QUESTION + (extra ? 1 : 0)).toFixed(1)) },
    rows,
  };
}

function main(dirs) {
  if (!dirs.length) {
    console.error('使い方：node eval/common-symptoms-eval.mjs <通しの結果のフォルダ>...');
    return 2;
  }
  const results = dirs.map((dir) => measure(dir));
  for (const result of results) {
    if (!TUNING.includes(result.company)) throw new Error('調整用 3 社だけを数えます');
    console.log(`${result.dir}（${result.label}）：ページになった割合 ${result.pages_ratio}、ある症状のページ ${result.consulted_with_page}、ない・事実なしへのページ ${result.violations.length} 件、選ぶ段を根拠にした文 ${result.selection_cited.length} 件、問数 ${result.questions.interview}＋${result.questions.common_stage}（約 ${result.questions.minutes_estimate} 分の見積もり）`);
  }
  console.log(JSON.stringify(results, null, 2));
  return results.every((result) => !result.violations.length && !result.selection_cited.length) ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv.slice(2));
