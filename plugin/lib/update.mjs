// 完成した取扱説明書を、あとから直すための部品。hikitsugi update の流れで使う。
// manual.json は、作業フォルダがなくても更新を始められるように、render が説明書の隣に置く。

import { pageStatementIds } from './page-check.mjs';
import { hasCredential } from './transcript.mjs';
import { chainFields } from './records.mjs';
import { identityFields } from './identity.mjs';

export const BUNDLE_NAME = 'manual.json';
export const CREDENTIAL_MEMO = '（パスワードらしい値があるので、この文は残していません）';

const compact = (text) => text.normalize('NFKC').replace(/\s+/g, '');

/**
 * manual.json の中身を作る。OneDrive に置くので、説明書が引用している調査と聞き取りだけを入れる。
 * 連絡先の名前と番号の照合に使う回答も入れる。「分からない」の回答と、退職する本人向けの一覧は入れない。
 */
export function bundleOf({ manual, survey, transcript, state, unknowns: unknownsOf }) {
  const { before_leaving: _private, ...shared } = manual;
  const cited = new Set(manual.statements.flatMap((statement) => statement.evidence));
  const contactWords = manual.contacts.flatMap((contact) => [contact.name, contact.phone]).filter(Boolean).map(compact);
  const entries = transcript.entries.filter((entry) => entry.status === 'answered' && (cited.has(entry.id) || contactWords.some((word) => compact(entry.answer).includes(word))));
  const items = survey.items.filter((item) => cited.has(item.id) || contactWords.some((word) => compact(`${item.key} ${item.value}`).includes(word)));
  return {
    schema_version: 1,
    kind: 'hikitsugi-manual',
    company: state.company,
    company_name: state.company_name,
    retiree: state.retiree,
    round: state.round,
    round_base: state.round_base ?? 0,
    manual: shared,
    sources: { survey: { ...survey, items }, transcript: { ...transcript, entries } },
    // 質問の短い文だけを残す。「分からない」の回答そのものは入れない。作業フォルダを作り直しても表紙の欄が消えないように
    unknowns: unknownsOf ?? [],
  };
}

/** 更新の対象の種類を返す。 */
export function targetKind(manual, id) {
  if (manual.symptom_pages.some((page) => page.id === id)) return 'page';
  if (manual.contacts.some((contact) => contact.id === id)) return 'contact';
  if (manual.devices.some((device) => device.id === id)) return 'device';
  if ((manual.routines ?? []).some((routine) => routine.id === id)) return 'routine';
  return null;
}

/**
 * 連絡先の番号が変わったとき、文の中に書かれた古い番号も新しい番号にする。
 * 番号だけの機械的な置き換えで、根拠に今回の回答を足す。文が変わるので Verifier の照合にかかる。
 * ほかの連絡先が同じ番号を使っているときは、どちらの番号か分からないので置き換えない。
 */
export function withContactPhone(manual, contactId, oldPhone, newPhone, evidence) {
  if (!oldPhone || !newPhone || oldPhone === newPhone) return manual;
  if (manual.contacts.some((contact) => contact.id !== contactId && contact.phone === oldPhone)) return manual;
  return {
    ...manual,
    statements: manual.statements.map((statement) => (statement.text.includes(oldPhone) ? { ...statement, text: statement.text.replaceAll(oldPhone, newPhone), evidence: [...new Set([...statement.evidence, evidence])] } : statement)),
  };
}

/** 更新の対象の連絡先を使っているページ。 */
export const pagesOfContact = (manual, id) => manual.symptom_pages.filter((page) => page.fallback?.contact === id).map((page) => page.id);

/** 連絡先を使うページと、文の中にその番号を書いているページ。更新の行を出すページ。 */
function pagesWithContact(manual, id) {
  const { phone } = manual.contacts.find((contact) => contact.id === id);
  const byId = new Map(manual.statements.map((statement) => [statement.id, statement]));
  const named = phone ? manual.symptom_pages.filter((page) => pageStatementIds(page).some((ref) => byId.get(ref)?.text.includes(phone))).map((page) => page.id) : [];
  return manual.symptom_pages.map((page) => page.id).filter((pageId) => pagesOfContact(manual, id).includes(pageId) || named.includes(pageId));
}

const SUMMARY_MAX = 60;

/** 更新の記録の種類の名前。連絡先と機器は「変更」「追加」でそろえる。 */
export const UPDATE_KIND_LABELS = { contact: '連絡先の変更', add_contact: '連絡先の追加', device: '機器の変更', add_device: '機器の追加', page: '手順の修正', add: '症状の追加', memo: 'メモの取り込み', routine: '決まった作業の変更', add_routine: '決まった作業の追加', handover: '担当の引き継ぎ' };

/** 足す連絡先の ID。業者は VEN-、社内の相談先は INH- の続きの番号にする。 */
export function nextContactId(manual, type) {
  const prefix = { vendor: 'VEN', internal: 'INH' }[type];
  if (!prefix) throw new Error('連絡先の種類は vendor（業者）か internal（社内の相談先）です');
  const number = Math.max(0, ...manual.contacts.filter((contact) => contact.id.startsWith(`${prefix}-`)).map((contact) => Number(contact.id.slice(4)))) + 1;
  if (number > 99) throw new Error(`${prefix} の連絡先はこれ以上足せません`);
  return `${prefix}-${String(number).padStart(2, '0')}`;
}

/** 足す機器の ID。今の D1、D2… の続き。ほかの形の ID とも重ならないようにする。 */
/** 足す決まった作業の ID。今の R の続き（R-01 の形の会社もあるので、数字だけを見る）。 */
export function nextRoutineId(manual) {
  const used = new Set(manual.routines.map((routine) => routine.id));
  let number = Math.max(0, ...manual.routines.map((routine) => Number(routine.id.match(/(\d+)$/)?.[1] ?? 0))) + 1;
  while (used.has(`R${number}`)) number += 1;
  return `R${number}`;
}

/**
 * 決まった作業を足す・直す更新の、共通部分の出力を確かめる。足すときは 1 件だけ足し、ID と間隔は決めたとおり。
 * どちらも、対象でない作業は前の版のまま（ID、間隔、題名と手順の文章の ID）。
 */
export function routineUpdateProblems(previous, output, update) {
  const problems = [];
  const before = new Map(previous.routines.map((routine) => [routine.id, routine]));
  const after = new Map(output.routines.map((routine) => [routine.id, routine]));
  const target = update.add_routine?.id ?? update.target;
  for (const [id, routine] of before) {
    if (id === target) continue;
    if (JSON.stringify(after.get(id)) !== JSON.stringify(routine)) problems.push(`決まった作業 ${id} は変えないでください（今回の対象は ${target} だけです）`);
  }
  if (update.add_routine) {
    const added = after.get(update.add_routine.id);
    if (!added) problems.push(`足す決まった作業 ${update.add_routine.id} がありません`);
    else if (added.frequency !== update.add_routine.frequency) problems.push(`${update.add_routine.id} の間隔は ${update.add_routine.frequency} です`);
    const extra = [...after.keys()].filter((id) => !before.has(id) && id !== update.add_routine.id);
    if (extra.length) problems.push(`足す決まった作業は 1 件だけです：${extra.join(', ')}`);
  } else if (!after.has(target)) problems.push(`直す決まった作業 ${target} がありません`);
  return problems;
}

export function nextDeviceId(manual) {
  const used = new Set(manual.devices.map((device) => device.id));
  let number = Math.max(0, ...manual.devices.map((device) => Number(device.id.match(/^D(\d+)$/)?.[1] ?? 0))) + 1;
  while (used.has(`D${number}`)) number += 1;
  return `D${number}`;
}

/**
 * 電話番号の形。明らかに番号でないものだけを止め、見慣れない形は確認を求める（本人の判断）。
 * - empty：空（記録がない）
 * - standard：市外局番からの 10 桁（03-0000-0102 の形）
 * - unusual：フリーダイヤル、携帯、内線つきなど、番号ではあるが見慣れない形。止めずに確認を求める
 * - invalid：数字が 2 つ未満か、数字と区切り以外の文字がある（「内線」「代表」は除く）
 */
export function phoneShape(phone) {
  const text = String(phone ?? '').normalize('NFKC').trim();
  if (!text) return 'empty';
  const digits = text.replace(/\D/g, '');
  const rest = text.replace(/内線|代表|ext\.?|ext/gi, '').replace(/[\d\s\-‐－ー()（）+#]/g, '');
  if (digits.length < 2 || rest) return 'invalid';
  if (/^0(?!120|800|[5789]0)\d{1,4}-\d{1,4}-\d{3,4}$/.test(text) && digits.length === 10) return 'standard';
  return 'unusual';
}


/**
 * 更新の記録に残す、内容の一言。本人の答えが60字に収まればそのまま。
 * 超えるときは、60字の中で最後の「。」か「、」で切って「…」を付ける。切れ目がなければ60字で切る。
 */
export function updateSummary(answer) {
  const chars = [...answer.replace(/\s+/g, ' ').trim()];
  if (chars.length <= SUMMARY_MAX) return chars.join('');
  const head = chars.slice(0, SUMMARY_MAX);
  const breakAt = Math.max(head.lastIndexOf('。'), head.lastIndexOf('、'));
  return `${head.slice(0, breakAt > 0 ? breakAt : SUMMARY_MAX).join('')}…`;
}

/**
 * 更新の印を付ける。角印は更新で確認した人と最新の確認日を出し、前任者の確認の記録は残す。
 * identity は更新した PC のアカウント名と PC 名。manual.json にだけ残り、画面には出さない。取れなかった値は残さない。
 */
export function withUpdateMark(manual, { target, by, date, summary, kind: updateKind, identity }) {
  const kind = targetKind(manual, target);
  const pages = kind === 'page' ? [target] : kind === 'contact' ? pagesWithContact(manual, target) : [];
  const updates = [...(manual.updates ?? []), { target, pages, by, date, ...(updateKind ? { kind: updateKind } : {}), ...(summary ? { summary } : {}), ...identityFields(identity), ...chainFields(manual) }];
  return {
    ...manual,
    review: { ...manual.review, updated_by: [...new Set(updates.map((update) => update.by))].join('・'), updated_on: date },
    updates,
  };
}

/** 更新の印から、ページの最新の更新を返す。なければ null。 */
export const latestUpdateOf = (manual, pageId) => (manual.updates ?? []).filter((update) => update.pages.includes(pageId)).at(-1) ?? null;

/** 更新で変わったページの ID と、変わった文の数を返す。文の数は文面で比べるので、番号が変わっても数えない。 */
export function changeSummary(before, after) {
  const textOf = (manual) => new Map(manual.statements.map((statement) => [statement.id, statement.text]));
  const pageText = (manual, page) => {
    const text = textOf(manual);
    // 連絡先の番号は文ではないが、そのページに出るので一緒に比べる
    const contact = manual.contacts.find((candidate) => candidate.id === page.fallback?.contact);
    return JSON.stringify([page, contact?.name, contact?.phone]).replace(/STM-\d+/g, (id) => text.get(id) ?? id);
  };
  const old = new Map(before.symptom_pages.map((page) => [page.id, page]));
  const pages = after.symptom_pages.filter((page) => !old.has(page.id) || pageText(before, old.get(page.id)) !== pageText(after, page)).map((page) => page.id);
  const left = new Map();
  for (const { text } of before.statements) left.set(text, (left.get(text) ?? 0) + 1);
  let added = 0;
  for (const { text } of after.statements) {
    if (left.get(text)) left.set(text, left.get(text) - 1);
    else added += 1;
  }
  const removed = [...left.values()].reduce((sum, count) => sum + count, 0);
  return { pages, statements: Math.max(added, removed) };
}

/** 検証の言い方を作り直すページ。題名、判定の文、① のどれかが変わったページと、新しいページ。 */
export function pagesNeedingPhrases(before, after) {
  const textsOf = (manual, page) => {
    const text = new Map(manual.statements.map((statement) => [statement.id, statement.text]));
    return JSON.stringify([page.title, page.badge.statement, ...page.first_steps].map((id) => text.get(id)));
  };
  const old = new Map(before.symptom_pages.map((page) => [page.id, page]));
  return after.symptom_pages.filter((page) => !old.has(page.id) || textsOf(before, old.get(page.id)) !== textsOf(after, page)).map((page) => page.id);
}

/** メモのまとめの文を、ページごとに分ける。1行目は「ページ名：メモ」で、続きの行はそのメモに足す。 */
export function parseMemos(text, manual) {
  const names = new Map();
  const statement = new Map(manual.statements.map((entry) => [entry.id, entry.text]));
  for (const page of manual.symptom_pages) names.set(statement.get(page.title), page.id);
  for (const contact of manual.contacts) names.set(contact.name, contact.id);
  for (const device of manual.devices) names.set(statement.get(device.name), device.id);
  const known = [...names.keys()].sort((a, b) => b.length - a.length);
  const items = [];
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf('：');
    const found = known.find((candidate) => line.startsWith(`${candidate}：`));
    const name = at > 0 ? line.slice(0, at).trim() : null;
    if (found) items.push({ target: names.get(found), name: found, text: line.slice(found.length + 1).trim() });
    else if (name && !items.length) items.push({ target: null, name, text: line.slice(at + 1).trim() });
    else if (line.trim() && items.length) items.at(-1).text = `${items.at(-1).text}\n${line.trim()}`;
    else if (line.trim()) items.push({ target: null, name: '', text: line.trim() });
  }
  // パスワードらしい値のあるメモは、本文を列にも担当にも渡さない。保管場所を本人に聞く
  return items.filter((item) => item.text.trim()).map((item) => (hasCredential(item.text) ? { ...item, text: CREDENTIAL_MEMO, has_credential: true } : { ...item, has_credential: false }));
}
