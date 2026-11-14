// 手順部品の操作。文面はプログラムが組み立て、モデルには書かせない。
// /hikitsugi:start と評価の両方で使う。

import { readFileSync } from 'node:fs';
import { bodyFields, manualProblems, parseInfoRow } from './page-check.mjs';

const LIBRARY_PATH = new URL('../library/procedures.json', import.meta.url);

export const loadLibrary = () => JSON.parse(readFileSync(LIBRARY_PATH, 'utf8'));

/** モデルに渡す部分。承認の状態や確認者は渡さない。 */
export const libraryForAgents = (library = loadLibrary()) => ({
  sequences: library.sequences,
  procedures: library.procedures.map(({ id, use_for, text, kinds, needs_table, directional }) => ({ id, use_for, text, kinds, needs_table, ...(directional ? { directional } : {}) })),
});

const compact = (text) => text.normalize('NFKC');

/** 根拠の ID から、照合に使う文字列を返す。使えない根拠は null。 */
export function evidenceReader({ survey, transcript }) {
  const inv = new Map(survey.items.map((item) => [item.id, item]));
  const int = new Map(transcript.entries.map((entry) => [entry.id, entry]));
  return (ref) => {
    // ドライブ文字のように、調査データでは項目名の側にある値も認める
    if (inv.get(ref)?.status === 'ok') return `${inv.get(ref).key} ${inv.get(ref).value}`;
    if (int.get(ref)?.status === 'answered') return int.get(ref).answer;
    return null;
  };
}

/** 部品を使った文章の文面を組み立てる。構造化出力で null が返ることがあるので、項目ごと外す。 */
export function composeStatements(rawStatements, library = loadLibrary()) {
  const parts = new Map(library.procedures.map((part) => [part.id, part]));
  const problems = [];
  const statements = rawStatements.map(({ library: partId, ...statement }) => {
    if (!partId) {
      if (statement.evidence.some((ref) => ref.startsWith('LIB-'))) problems.push(`${statement.id}: 部品の指定がないのに、部品を根拠にしています`);
      if (!statement.evidence.length) problems.push(`${statement.id}: 根拠（evidence）が空です。空にできるのは、部品を使う文章だけです`);
      return statement;
    }
    const part = parts.get(partId);
    if (!part) {
      problems.push(`${statement.id}: 存在しない部品です: ${partId}`);
      return { ...statement, library: partId };
    }
    return { id: statement.id, text: part.text, evidence: [partId], library: partId };
  });
  return { statements, problems };
}

/** ページの中の部品の置き場所、順番、表との関係を確かめる。 */
function partProblems(page, statements, library) {
  const parts = new Map(library.procedures.map((part) => [part.id, part]));
  const byId = new Map(statements.map((statement) => [statement.id, statement]));
  const partOf = (id) => parts.get(byId.get(id)?.library);
  const problems = [];
  const fields = bodyFields(page);
  for (const [field, ids] of Object.entries(fields)) {
    for (const id of ids) {
      const part = partOf(id);
      if (!part) continue;
      if (!part.kinds.includes(field)) problems.push(`${page.id}: ${part.id} は ${field} に置けません（置ける場所：${part.kinds.join('、')}）`);
      if (part.needs_table && !page.info_rows.length) problems.push(`${page.id}: ${part.id} は会社の情報の表を指しますが、表（info_rows）がありません`);
      if (part.text.includes('連絡先へ') && !page.fallback) problems.push(`${page.id}: ${part.id} は連絡先へ案内しますが、fallback がありません`);
    }
  }
  const used = [...page.first_steps, ...page.steps].map((id) => partOf(id)?.id).filter(Boolean);
  for (const sequence of library.sequences) {
    const order = [...sequence.first, ...sequence.steps];
    const positions = used.filter((id) => order.includes(id)).map((id) => order.indexOf(id));
    if (positions.some((position, i) => i > 0 && position < positions[i - 1])) {
      problems.push(`${page.id}: 部品の順番が「${sequence.title}」と違います`);
    }
  }
  return problems;
}

/**
 * 手順の文が、調査データだけを根拠にしていないかを確かめる。手順は部品か聞き取りから作る。
 * 調査データの値は資料で、ソフト名のように PC の中の誰かが書ける。そこから後任の操作を作らせない。
 * 聞き取りの中身と文が合っているかは、プログラムでは見ない（Verifier の照合）。
 */
export function stepSourceProblems(ownerId, stepIds, statements) {
  const byId = new Map(statements.map((statement) => [statement.id, statement]));
  return stepIds
    .filter((id) => byId.has(id) && !byId.get(id).library && byId.get(id).evidence.every((ref) => ref.startsWith('INV-')))
    .map((id) => `${ownerId}: ${id} は手順の文ですが、調査データだけを根拠にしています。手順は部品か聞き取りのとおりに書いてください。どちらにもなければ書かないでください`);
}

/** 表の値が、その文章の根拠に本当にあるかを確かめる。値を書き写した誤りをプログラムで止める。 */
function infoRowProblems(page, statements, readEvidence) {
  const byId = new Map(statements.map((statement) => [statement.id, statement]));
  const problems = [];
  for (const id of page.info_rows) {
    const statement = byId.get(id);
    const row = statement && parseInfoRow(statement.text);
    if (!row) continue;
    const refs = statement.evidence.filter((ref) => !ref.startsWith('LIB-'));
    const texts = refs.map(readEvidence).filter((text) => text !== null).map(compact);
    const values = row.type === 'drive' ? [row.drive, row.path] : [row.value];
    for (const value of values) {
      if (!texts.some((text) => text.includes(compact(value)))) problems.push(`${page.id}: ${id} の値「${value}」が根拠にありません`);
    }
  }
  return problems;
}

/** 連絡先の名前と電話番号が、使える根拠のどこかにあるかを確かめる。 */
export function contactEvidenceProblems(contacts, { survey, transcript }) {
  const all = compact(
    [
      ...survey.items.filter((item) => item.status === 'ok').map((item) => `${item.key} ${item.value}`),
      ...transcript.entries.filter((entry) => entry.status === 'answered').map((entry) => entry.answer),
    ].join('\n'),
  );
  return contacts.flatMap((contact) => [
    ...(all.includes(compact(contact.name)) ? [] : [`${contact.id}: 名前「${contact.name}」が根拠にありません`]),
    ...(!contact.phone || all.includes(compact(contact.phone)) ? [] : [`${contact.id}: 電話番号が根拠にありません`]),
  ]);
}

// ---- 向きのある部品 ----
// コピーのように、元と先を取り違えると控えを壊す部品（directional）。部品は「コピーするフォルダー」「コピー先」としか言わないので、
// 前の手順に「〈元〉から、〈先〉へ〜してください。」の文があり、元と先の名前が、その文の根拠にあるときだけ使える。

const DIRECTION = /([^、。]+?)\s*から[、\s]*([^。]+?)\s*(?:へ|に)\s*(?:手で)?\s*(?:コピー|戻|移|貼り付|上書き|入れ|置|保存)/u;
// 「〈元〉を〈先〉へコピーする」。「を」の前が元になるのは、コピーと移動だけ（「ファイルを〜へ戻す」の「を」は物で、元の場所ではない）
const DIRECTION_OBJECT = /([^、。]+?)\s*を[、\s]*([^。]+?)\s*(?:へ|に)\s*(?:手で)?\s*(?:コピー|移)/u;
const RESTORE = /戻|復元/u;
// 戻す範囲（フォルダーごとか、消したファイルだけか）を書いた文
const SCOPE = /フォルダー?ごと|ファイルだけ|ファイルのみ|すべてのファイル|全部のファイル|ファイルを(?:すべて|全部)|範囲/u;
export const SCOPE_UNKNOWN = '戻す範囲（フォルダーごとか、消したファイルだけか）は、記録がありません。';
// 照合では、空白、長音（「フォルダ」と「フォルダー」）、「の」（「外付け USB」と「外付けの USB」）を区別しない
const loose = (text) => text.normalize('NFKC').replace(/\s+/g, '').replace(/[ーの]/g, '');

/** 文から、元と先の場所を読む。「〈元〉から、〈先〉へ戻して」の形でなければ null。 */
export function directionOf(text) {
  const match = String(text ?? '').match(DIRECTION) ?? String(text ?? '').match(DIRECTION_OBJECT);
  if (!match) return null;
  // 「消したファイルは〜から」の主題や、「毎週金曜：〜を」の見出しは、元の場所に含めない
  const from = match[1].replace(/^.*[は：:]/u, '').trim() || match[1].trim();
  const to = match[2].trim();
  return from && to ? { from, to } : null;
}

const directionalParts = (library) => new Set(library.procedures.filter((part) => part.directional).map((part) => part.id));

/** 手順の並び1つで、最初の向きのある部品と、その前にある向きの文。部品がなければ null。 */
function directionUse(stepIds = [], byId, directional, heading = null) {
  const index = stepIds.findIndex((id) => directional.has(byId.get(id)?.library));
  if (index < 0) return null;
  const before = [...(heading ? [heading] : []), ...stepIds.slice(0, index)].map((id) => byId.get(id)).filter((statement) => statement && !statement.library);
  const found = before.map((statement) => ({ statement, direction: directionOf(statement.text) })).filter((item) => item.direction).at(-1) ?? null;
  return { part: byId.get(stepIds[index]).library, statement: found?.statement ?? null, direction: found?.direction ?? null };
}

/**
 * 向きのある部品の前に、根拠つきの向きの文があるかを確かめる。
 * @param stepLists 手順の並びの一覧（ページの ① と ②、定期作業の手順）
 * @param heading 手順の真上に出る題名の ID（定期作業）。題名の向きも数える。ページの題名は症状なので数えない
 */
export function directionProblems(ownerId, stepLists, statements, readEvidence, library = loadLibrary(), heading = null) {
  const directional = directionalParts(library);
  const byId = new Map(statements.map((statement) => [statement.id, statement]));
  const problems = [];
  for (const stepIds of stepLists) {
    const use = directionUse(stepIds, byId, directional, heading);
    if (!use) continue;
    if (!use.statement) {
      problems.push(`${ownerId}: ${use.part} は向きのある部品です（逆にすると控えを壊します）。部品の前の手順に「〈元の場所〉から、〈先の場所〉へ〜してください。」の文を、根拠にある場所の名前で置いてください。根拠に向きがなければ、部品を使わず、答えの文だけで書いてください`);
      continue;
    }
    const texts = use.statement.evidence.filter((ref) => !ref.startsWith('LIB-')).map(readEvidence).filter((text) => text !== null).map(loose);
    const { from, to } = use.direction;
    if (loose(from) === loose(to)) problems.push(`${ownerId}: ${use.statement.id} の元と先が同じです（「${from}」）`);
    for (const [label, place] of [['元', from], ['先', to]]) {
      if (!texts.some((text) => text.includes(loose(place)))) problems.push(`${ownerId}: ${use.statement.id} の${label}の場所「${place}」が、その文の根拠にありません。根拠にある名前で書いてください`);
    }
  }
  return problems;
}

/**
 * 戻す操作で、戻す範囲の記録がないときに、向きの文の下に出す決まった文。文章の ID ごとに返す。
 * 範囲を書いた文がページ（または定期作業）のどこかにあれば出さない。
 */
export function scopeNotes(stepLists, ownStatementIds, statements, library = loadLibrary(), heading = null) {
  const directional = directionalParts(library);
  const byId = new Map(statements.map((statement) => [statement.id, statement]));
  const scoped = ownStatementIds.filter(Boolean).some((id) => byId.get(id) && !byId.get(id).library && SCOPE.test(byId.get(id).text));
  const notes = new Map();
  if (scoped) return notes;
  for (const stepIds of stepLists) {
    const use = directionUse(stepIds, byId, directional, heading);
    if (use?.statement && RESTORE.test(use.statement.text)) notes.set(use.statement.id, SCOPE_UNKNOWN);
  }
  return notes;
}

/** ページの向きの文の下に出す決まった文。 */
export const pageScopeNotes = (page, manual, library = loadLibrary()) => scopeNotes([page.first_steps, page.steps], Object.values(bodyFields(page)).flat(), manual.statements, library);

/** 定期作業の向きの文の下に出す決まった文。 */
export const routineScopeNotes = (routine, manual, library = loadLibrary()) => scopeNotes([routine.steps], [routine.title, ...routine.steps], manual.statements, library, routine.title);

/** ページ1つの、部品と表の問題。 */
export function pageDetailProblems(page, statements, sources, library = loadLibrary()) {
  const readEvidence = evidenceReader(sources);
  return [
    ...partProblems(page, statements, library),
    ...infoRowProblems(page, statements, readEvidence),
    ...stepSourceProblems(page.id, [...page.first_steps, ...page.steps], statements),
    ...directionProblems(page.id, [page.first_steps, page.steps], statements, readEvidence, library),
  ];
}

/**
 * Writer の出力の、部品を使った文章を組み立て、形を確かめる。
 * @returns { manual, problems } problems は、部品の指定の誤りや、根拠にない値の一覧
 */
export function composeProcedures(manual, sources, { library = loadLibrary(), retiree } = {}) {
  const { statements, problems } = composeStatements(manual.statements, library);
  const composed = { ...manual, statements };
  for (const page of manual.symptom_pages) problems.push(...pageDetailProblems(page, statements, sources, library));
  for (const routine of manual.routines ?? []) problems.push(...directionProblems(routine.id, [routine.steps], statements, evidenceReader(sources), library, routine.title));
  problems.push(...contactEvidenceProblems(manual.contacts, sources), ...manualProblems(composed, retiree));
  return { manual: composed, problems };
}

/** 取扱説明書が使っている部品のうち、承認されていないもの（存在しないものを含む）を返す。 */
export function unapprovedParts(manual, library = loadLibrary()) {
  const status = new Map(library.procedures.map((part) => [part.id, part.status]));
  const used = new Set(manual.statements.flatMap((s) => s.evidence.filter((ref) => ref.startsWith('LIB-'))));
  return [...used].filter((id) => status.get(id) !== 'approved').sort();
}
