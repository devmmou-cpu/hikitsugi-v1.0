// 枠の外を自由に足す段。20 問、定番の症状、退職後の問いのあと、書き始める前に「ほかに引き継ぐものはありますか」と聞く。
// 挙がった物ごとに、種類（機器・ソフト、相手、決まった作業、IT ではない）を選んでもらい、中身を 1 問で聞く。上限 5 件。
// 根拠は前任者の答えだけ。承認済みの手順部品がない物に、手順を作らない。業務そのものの手順（経理の締めなど）は載せない。
// 問いの文と流れはプログラムが決める（AI に振り分けさせない）。

import { appendExtraEntry } from './transcript.mjs';

export const OPEN_GAP = 'GAP-903';
export const OPEN_ITEM = 'CHK-00';
export const OPEN_LIMIT = 5;

export const LIST_QUESTION = 'ほかに引き継ぐものはありますか。会社の IT と、それにつながる機器やソフトを、1 行に 1 つずつ書いてください（例：工場の機械につながる PC、レジ、業務ソフト）。経理の締めのような業務の手順は、この説明書の対象外です。なければ「ない」と書いてください。';
export const KIND_CHOICES = [
  { value: 'device', label: '機器・ソフト', description: '置き場所、役割、止まるとどうなるか、困ったときの相手を聞きます' },
  { value: 'contact', label: '相手（連絡先）', description: '名前、電話番号、何の相手かを聞きます' },
  { value: 'routine', label: '決まった作業', description: '間隔、やり方、終わったことの確かめ方を聞きます' },
  { value: 'out_of_scope', label: 'IT ではない（載せない）', description: '題名だけを「対象外として挙がったもの」に並べます' },
];
export const DETAIL_QUESTIONS = {
  device: (name) => `「${name}」について教えてください。置き場所（ソフトなら入っている PC）、何に使うか、止まるとどうなるか、困ったときの相手（名前と電話番号）、パスワードを置いてある場所、してはいけないこと、止まったときにしていたことを、分かるものだけ書いてください。パスワードそのものは書かないでください。`,
  contact: (name) => `「${name}」について教えてください。名前、電話番号、何の相手か、受付の時間や連絡の手段、契約書の控えの場所を、分かるものだけ書いてください。`,
  routine: (name) => `「${name}」について教えてください。どのくらいの間隔か（毎週・毎月・毎年。毎年なら何月）、やり方、終わったことを何で確かめるか、だれがしているかを、分かるものだけ書いてください。`,
};

/** 挙がった物を 1 行ずつに分ける。「ない」なら空。箇条書きの記号は外す。 */
export function parseList(answer) {
  const text = String(answer ?? '').trim();
  if (!text || /^(?:ない|ありません|なし|特にない|特にありません)[。.]?$/.test(text)) return [];
  return [...new Set(text.split(/\r?\n/).map((line) => line.replace(/^\s*(?:[-・*•]|\d+[.)．、])\s*/, '').trim()).filter(Boolean))];
}

/** 挙げてもらう問いの答えを記録し、聞く物（上限まで）と、まだ聞かない物に分ける。 */
export function recordList(transcript, { answer, answeredAt }) {
  const names = parseList(answer);
  const added = appendExtraEntry(transcript, { gap: OPEN_GAP, covers: [OPEN_ITEM], question: LIST_QUESTION, answer: answer.trim() || 'ない', status: 'answered', answeredAt });
  return { transcript: added.transcript, entry: added.entry, open: { list: added.entry.id, items: names.slice(0, OPEN_LIMIT).map((name) => ({ name })), not_asked: names.slice(OPEN_LIMIT), index: 0, stopped: false } };
}

/** 次に聞く物と段（kind か detail）。全部聞いたか、やめたなら null。 */
export function nextOpenStep(open) {
  if (!open || open.stopped) return null;
  const item = open.items[open.index];
  if (!item) return null;
  return { item, stage: item.kind ? 'detail' : 'kind' };
}

/** 種類を記録する。IT ではない物は中身を聞かずに次へ進む。 */
export function recordKind(open, kind) {
  if (!KIND_CHOICES.some((choice) => choice.value === kind)) throw new Error('種類は device、contact、routine、out_of_scope のどれかです');
  const step = nextOpenStep(open);
  if (!step || step.stage !== 'kind') throw new Error('種類を聞く段ではありません');
  const items = open.items.map((item, index) => (index === open.index ? { ...item, kind } : item));
  return { ...open, items, index: kind === 'out_of_scope' ? open.index + 1 : open.index };
}

/** 中身の答えを記録して、次の物へ進む。 */
export function recordDetail(transcript, open, { answer, status, answeredAt }) {
  const step = nextOpenStep(open);
  if (!step || step.stage !== 'detail') throw new Error('中身を聞く段ではありません');
  const added = appendExtraEntry(transcript, { gap: OPEN_GAP, covers: [OPEN_ITEM], question: DETAIL_QUESTIONS[step.item.kind](step.item.name), answer, status, answeredAt });
  const items = open.items.map((item, index) => (index === open.index ? { ...item, entry: added.entry.id, status } : item));
  return { transcript: added.transcript, open: { ...open, items, index: open.index + 1 } };
}

/** ここまでにする。残りは「まだ聞いていないもの」に回す。 */
export function stopOpen(open) {
  const rest = open.items.slice(open.index).map((item) => item.name);
  return { ...open, items: open.items.slice(0, open.index), not_asked: [...rest, ...open.not_asked], stopped: true };
}

/** Writer に渡す、載せる物（答えのあった、機器・相手・決まった作業）。 */
export const writableItems = (open) => (open?.items ?? []).filter((item) => item.kind && item.kind !== 'out_of_scope' && item.entry && item.status === 'answered').map(({ name, kind, entry }) => ({ name, kind, entry }));

/** 説明書に残す一覧（はじめにに出す）：対象外として挙がったもの、まだ聞いていないもの。 */
export function openSummary(open) {
  if (!open) return null;
  const outOfScope = open.items.filter((item) => item.kind === 'out_of_scope').map((item) => item.name);
  const notAsked = [...open.items.filter((item) => item.kind !== 'out_of_scope' && (!item.entry || item.status !== 'answered')).map((item) => item.name), ...open.not_asked];
  return { out_of_scope: outOfScope, not_asked: notAsked };
}

/**
 * 自由に足した項目から作った文の検査。根拠は、その項目の答えだけ。自由な項目のページには、手順部品を置かず、「自分で直せる」を使わない。
 * @param pieces { statements, devices, contacts, routines, pages } のうち、自由な項目から作ったものの ID の一覧
 */
export function freePageProblems(page, statements, allowed) {
  const problems = [];
  const byId = new Map(statements.map((statement) => [statement.id, statement]));
  if (page.badge?.value === 'self') problems.push(`${page.id}：自由に足した項目のページに「自分で直せる」は使えません（承認済みの手順部品のない物なので）`);
  const ids = [page.title, page.badge?.statement, page.reassurance, ...page.notes, ...page.first_steps, ...page.steps, ...page.branches, ...page.exceptions, page.goal, page.first_goal, ...(page.info_rows ?? [])].filter(Boolean);
  for (const id of ids) {
    const statement = byId.get(id);
    if (!statement) continue;
    if (statement.library) problems.push(`${page.id}：自由に足した項目のページに手順部品（${statement.library}）は置けません`);
    else if (statement.evidence.some((ref) => !allowed.has(ref))) problems.push(`${page.id}：${id} の根拠は、その項目の答え（${[...allowed].join('、')}）だけです`);
  }
  return problems;
}
