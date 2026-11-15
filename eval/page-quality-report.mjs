#!/usr/bin/env node
// ページの質の測定（API なし）。通しの結果のフォルダから、次を数える。
// - 物に触る手順のあるページのうち、見分け方・待つ時間・確かめ方がそろっているページ、「記録がありません」と明示されているページ
// - 根拠のない数字（待つ時間）の文
// - 退職後に聞く道の 1 文
// - 決まった部分の問数と、答える時間の見積もり
// 使い方：node eval/page-quality-report.mjs <通しの結果のフォルダ>...

import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { evidenceReader } from '../plugin/lib/procedures.mjs';
import { missingNote, pageChecks, unsupportedWaits, PAGE_GAP } from '../plugin/lib/page-quality.mjs';
import { AFTER_LEAVING_GAP } from '../plugin/lib/after-leaving.mjs';
import { COMMON_GAP } from '../plugin/lib/common-symptoms.mjs';
import { OPEN_GAP } from '../plugin/lib/open-items.mjs';
import { loadInput } from './lib/load-set.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const TUNING = /-(okojo|kuzuri|kinodoten)-pipeline$/;
// 見積もりの単価（段 2 の設計と同じ）：自由に答える 1 問 0.9 分、選ぶ 1 回 1 分、選択から始める退職後の問い 0.5 分
const MINUTES = { free: 0.9, select: 1, choice: 0.5 };

/** 通しの結果 1 つの測定。transcript は、追加の質問まで入った最後の記録を使う。 */
export function measure(dir) {
  const company = basename(dir).match(TUNING)[1];
  const manual = JSON.parse(readFileSync(join(dir, 'manual-final.json'), 'utf8'));
  // 最後の記録：transcript-final（この段のあとの通し）、なければ段ごとの保存、なければ 20 問の記録
  const final = join(dir, 'transcript-final.json');
  const latest = ['page-gaps', 'after-leaving', 'common-symptoms'].map((name) => join(dir, `${name}.json`)).find(existsSync);
  const transcript = existsSync(final) ? JSON.parse(readFileSync(final, 'utf8')) : latest ? JSON.parse(readFileSync(latest, 'utf8')).transcript : JSON.parse(readFileSync(join(dir, 'transcript.json'), 'utf8'));
  const survey = loadInput(join(ROOT, 'eval/sets', company)).survey;
  const byId = new Map(manual.statements.map((statement) => [statement.id, statement.text]));
  const pages = manual.symptom_pages.map((page) => ({ page, checks: pageChecks(page, manual) })).filter(({ checks }) => checks);
  const complete = pages.filter(({ checks }) => !checks.missing.length && !checks.said_none.length);
  const saidNone = pages.filter(({ checks }) => !checks.missing.length && checks.said_none.length);
  const noted = pages.filter(({ page }) => missingNote(page, manual));
  const entries = transcript.entries;
  // 20 問の本体。定番の症状、手順の抜け、退職後、ほかに引き継ぐもの（11/15 から）、前任者の確認の直し（GAP-000）は除く
  const interview = entries.filter((entry) => ![COMMON_GAP, PAGE_GAP, AFTER_LEAVING_GAP, OPEN_GAP, 'GAP-000'].includes(entry.gap)).length;
  const common = entries.filter((entry) => entry.gap === COMMON_GAP);
  const selection = common.length ? 1 : 0;
  const followups = Math.max(0, common.length - selection);
  const afterLeaving = entries.filter((entry) => entry.gap === AFTER_LEAVING_GAP).length;
  const gapQuestions = entries.filter((entry) => entry.gap === PAGE_GAP).length;
  // ほかに引き継ぐものの問い。種類の選択も、書く問いと同じ時間で多めに見積もる
  const openQuestions = entries.filter((entry) => entry.gap === OPEN_GAP).length;
  const minutes = interview * MINUTES.free + selection * MINUTES.select + followups * MINUTES.free + afterLeaving * MINUTES.choice + gapQuestions * MINUTES.free + openQuestions * MINUTES.free;
  return {
    company,
    physical_pages: pages.length,
    complete: complete.length,
    said_none: saidNone.length,
    program_note: noted.length,
    explicit_rate: pages.length ? (complete.length + saidNone.length + noted.length) / pages.length : null,
    pages: pages.map(({ page, checks }) => ({ id: page.id, title: byId.get(page.title), needs: checks.needs, missing: checks.missing, said_none: checks.said_none })),
    unsupported_waits: unsupportedWaits(manual, evidenceReader({ survey, transcript })),
    after_leaving: manual.after_leaving ? byId.get(manual.after_leaving) : null,
    questions: { interview, selection, followups, after_leaving: afterLeaving, page_gaps: gapQuestions, open_items: openQuestions, total: interview + selection + followups + afterLeaving + gapQuestions + openQuestions },
    minutes_estimate: Math.round(minutes * 10) / 10,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const dir of process.argv.slice(2)) {
    if (!TUNING.test(basename(dir))) throw new Error(`調整用の会社の通しの結果だけを読みます：${dir}`);
    const result = measure(dir);
    console.log(JSON.stringify(result, null, 2));
  }
}
