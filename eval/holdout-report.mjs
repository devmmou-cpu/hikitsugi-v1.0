#!/usr/bin/env node
// holdout の最終の確認（v1.0、1 回だけ）で、通しの結果のフォルダから、数と件数だけを取り出す。
// 文章、答え、隠し情報は読んで数えるだけで、出力しない（出すのは数、件数、状態の名前だけ）。API は使わない。
// 使い方：node eval/holdout-report.mjs <通しの結果のフォルダ> [--search <search-result-1.json>] [--staff <staff-result-1.json>]

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { COMMON_GAP } from '../plugin/lib/common-symptoms.mjs';
import { OPEN_GAP } from '../plugin/lib/open-items.mjs';
import { missingNote, pageChecks, PAGE_GAP, unsupportedWaits } from '../plugin/lib/page-quality.mjs';
import { evidenceReader } from '../plugin/lib/procedures.mjs';
import { measureFigures } from './figure-report.mjs';
import { loadInput } from './lib/load-set.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const countBy = (items, key) => items.reduce((out, item) => ({ ...out, [key(item)]: (out[key(item)] ?? 0) + 1 }), {});

export function holdoutCounts(dir, set) {
  const summary = readJson(join(dir, 'summary.json'));
  const manual = readJson(join(dir, 'manual-final.json'));
  const transcript = readJson(join(dir, existsSync(join(dir, 'transcript-final.json')) ? 'transcript-final.json' : 'transcript.json'));
  const survey = loadInput(join(ROOT, 'eval/sets', set)).survey;
  const statements = new Map(manual.statements.map((statement) => [statement.id, statement]));
  const entries = transcript.entries;
  const commonEntries = new Set(entries.filter((entry) => entry.gap === COMMON_GAP).map((entry) => entry.id));
  // 定番の症状の段の答えだけを根拠にしてできたページ（20 問の答えも根拠にしたページは、もとからできるページ）
  const fromCommon = manual.symptom_pages.filter((page) => {
    const evidence = new Set(Object.values(page).flat().filter((id) => typeof id === 'string' && statements.has(id)).flatMap((id) => statements.get(id).evidence ?? []));
    const fromInterview = [...evidence].some((ref) => ref.startsWith('INT-') && !commonEntries.has(ref));
    return [...evidence].some((ref) => commonEntries.has(ref)) && !fromInterview;
  }).length;
  const physical = manual.symptom_pages.map((page) => ({ page, checks: pageChecks(page, manual) })).filter(({ checks }) => checks);
  const last = summary.rounds?.at(-1);
  return {
    status: summary.status,
    cost_usd: summary.cost_usd,
    verifier_rounds: summary.rounds?.length ?? 0,
    final_verdicts: last?.counts ?? null,
    retiree_hits: last?.retiree_hits ?? null,
    leaks_remaining: summary.leaks?.at(-1)?.remaining ?? null,
    coverage: { covered: summary.stages?.interview?.covered ?? null, items: summary.stages?.interview?.items ?? null },
    questions: summary.questions ?? null,
    answers_by_status: {
      common: countBy(entries.filter((entry) => entry.gap === COMMON_GAP), (entry) => entry.status),
      page_gaps: countBy(entries.filter((entry) => entry.gap === PAGE_GAP), (entry) => entry.status),
      open_items: countBy(entries.filter((entry) => entry.gap === OPEN_GAP), (entry) => entry.status),
    },
    symptom_pages: manual.symptom_pages.length,
    pages_only_from_common_stage: fromCommon,
    page_quality: {
      physical_pages: physical.length,
      complete: physical.filter(({ checks }) => !checks.missing.length && !checks.said_none.length).length,
      said_none: physical.filter(({ checks }) => !checks.missing.length && checks.said_none.length).length,
      program_note: physical.filter(({ page }) => missingNote(page, manual)).length,
    },
    unsupported_waits: unsupportedWaits(manual, evidenceReader({ survey, transcript })).length,
    free_pages: manual.symptom_pages.filter((page) => page.source === 'free').length,
    free_pages_self: manual.symptom_pages.filter((page) => page.source === 'free' && page.badge?.value === 'self').length,
    figures: measureFigures(manual),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { set: { type: 'string' }, search: { type: 'string' }, staff: { type: 'string' } } });
  const [dir] = positionals;
  if (!dir || !values.set) throw new Error('使い方：node eval/holdout-report.mjs <通しの結果のフォルダ> --set <会社> [--search <file>] [--staff <file>]');
  const out = holdoutCounts(dir, values.set);
  if (values.search) out.search_top3 = readJson(values.search).top3;
  if (values.staff) out.staff_top3 = readJson(values.staff).top3;
  console.log(JSON.stringify(out, null, 2));
}
