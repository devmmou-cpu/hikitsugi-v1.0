// 作成と更新の記録の「要約値の鎖」。記録の書き換えに気づくためのもので、防ぐものではない（鍵を使わないので、作り直せる）。
// 各記録に、前の記録の要約値（prev）と、その時点の中身の要約値（content）を持たせる。
// 作成の記録は review、更新と担当の引き継ぎの記録は updates[]。要約値のない前の版の記録とは比べない。
// 本人確認ではない。誰が書き換えたかを確かに追うには、OneDrive の版履歴を見る。

import { createHash } from 'node:crypto';

/** 決まった順の JSON。キーの順で要約値が変わらないようにする。 */
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}

/** 要約値（SHA-256 の先頭 16 字）。 */
export const digestOf = (value) => createHash('sha256').update(stableJson(value)).digest('hex').slice(0, 16);

/** 中身の要約値。後任が読む中身（文、ページ、連絡先、決まった作業、機器）だけを見る。 */
export const contentDigest = (manual) => digestOf({ statements: manual.statements, symptom_pages: manual.symptom_pages, contacts: manual.contacts, routines: manual.routines, devices: manual.devices, after_leaving: manual.after_leaving ?? null });

/** 記録の並び（作成、更新の順）。 */
export const recordsOf = (manual) => [...(manual.review ? [manual.review] : []), ...(manual.updates ?? [])];

/** 作成の記録から updated_by と updated_on を除いたもの（更新のたびに変わる欄なので、鎖に入れない）。 */
const creationPart = ({ updated_by: _by, updated_on: _on, ...rest }) => rest;
const recordForDigest = (record, index) => (index === 0 && 'confirmed_on' in record ? creationPart(record) : record);

/** 最後の記録の要約値。次の記録の prev になる。記録がなければ null。 */
export function lastRecordDigest(manual) {
  const records = recordsOf(manual);
  return records.length ? digestOf(recordForDigest(records.at(-1), records.length - 1)) : null;
}

/** 新しい記録に付ける要約値。manual は記録を足す直前の（更新を済ませた）説明書。 */
export const chainFields = (manual) => ({ prev: lastRecordDigest(manual), content: contentDigest(manual) });

/**
 * 鎖を確かめる。要約値を持つ最初の記録から始める。
 * @returns 問題の文の一覧（空なら、気づける書き換えはない）
 */
export function chainProblems(manual) {
  const records = recordsOf(manual);
  const start = records.findIndex((record) => 'content' in record);
  if (start < 0) return [];
  const problems = [];
  for (let index = start + 1; index < records.length; index += 1) {
    if (!('prev' in records[index])) continue;
    if (records[index].prev !== digestOf(recordForDigest(records[index - 1], index - 1))) problems.push(`記録 ${index + 1} 件目の前の記録が、記録したときと違います（書き換えか、消した記録があります）`);
  }
  const last = records.at(-1);
  if ('content' in last && last.content !== contentDigest(manual)) problems.push('最後の記録のあと、プラグインの外で中身（文や連絡先）が変わっています');
  return problems;
}
