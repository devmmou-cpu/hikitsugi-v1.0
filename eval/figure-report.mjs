#!/usr/bin/env node
// 手順の絵の測定（API なし）。通しの結果のフォルダから、手順の置き場所のうち絵が付く割合と、絵の種類を数える。
// 文と逆向きの矢印は、プログラムが動詞の一覧で向きを決めるので、組み立てた絵の矢印と文の動詞を照らして数える（0 のはず）。
// 使い方：node eval/figure-report.mjs <通しの結果のフォルダ>...

import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { arrowOf, arrowSidesInText, loadKit } from '../plugin/lib/figure-build.mjs';
import { firstStepFigures, pageFigureDetails, routineFigureDetails } from '../plugin/lib/figures.mjs';

const TUNING = /-(okojo|kuzuri|kinodoten)-pipeline$/;

export function measureFigures(manual, kit = loadKit()) {
  const byId = new Map(manual.statements.map((statement) => [statement.id, statement]));
  const slots = [
    ...manual.symptom_pages.flatMap((page) => {
      const hand = firstStepFigures(page, manual);
      const made = pageFigureDetails(page, manual, { kit });
      return [...page.first_steps, ...page.steps].map((id) => ({ id, hand, made }));
    }),
    ...manual.routines.flatMap((routine) => {
      const made = routineFigureDetails(routine, manual, { kit });
      return routine.steps.map((id) => ({ id, hand: new Map(), made }));
    }),
  ];
  // inherited：前の手順から機器を引き継いだ矢印の絵。no_device：矢印の動詞の文で、機器がなく引き継げなかったもの（絵なし）
  const count = { slots: slots.length, figured: 0, hand: 0, keys: 0, parts: 0, inherited: 0, no_device: 0, reversed: 0 };
  for (const slot of slots) {
    const text = byId.get(slot.id).text;
    if (slot.hand.has(slot.id)) {
      count.figured += 1;
      count.hand += 1;
      continue;
    }
    const detail = slot.made.get(slot.id);
    if (!detail) {
      if (arrowOf(text, kit) && !arrowSidesInText(text, kit) && !(manual.figure_off ?? []).includes(slot.id)) count.no_device += 1;
      continue;
    }
    count.figured += 1;
    if (detail.kind === 'keys') {
      count.keys += 1;
      continue;
    }
    count[detail.kind] += 1;
    // 組み立てた絵の矢印と、文の動詞から決まる向きが違えば数える
    const expected = arrowOf(text, kit);
    const right = detail.svg.includes(kit.arrows.right);
    const left = detail.svg.includes(kit.arrows.left);
    if ((expected?.direction === 'away') !== right || (expected?.direction === 'toward') !== left) count.reversed += 1;
  }
  return { ...count, rate: count.slots ? Math.round((count.figured / count.slots) * 1000) / 10 : 0 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const dir of process.argv.slice(2)) {
    if (!TUNING.test(basename(dir))) throw new Error(`調整用の会社の通しの結果だけを読みます：${dir}`);
    console.log(basename(dir), JSON.stringify(measureFigures(JSON.parse(readFileSync(join(dir, 'manual-final.json'), 'utf8')))));
  }
}
