// 退職後に聞く道（最小の形）。退職後しばらく、社長などを通して前任者に聞けるかを、答えがあった会社だけ「はじめに」に 1 文で載せる。
// 必須項目の「退職後の連絡」（CHK-40）の答えが 20 問の中にあれば、それを使う。なければ 1 問だけ、選択から聞く。
// 前任者の個人の連絡先は記録しない（社長を通す道なので要らない）。期限で表示を切り替える仕組みは作らない。

import { appendExtraEntry } from './transcript.mjs';

export const AFTER_LEAVING_GAP = 'GAP-902';
export const AFTER_LEAVING_ITEM = 'CHK-40';
export const AFTER_LEAVING_QUESTION = '退職したあと、困ったときに、社長を通してあなたに聞いてもよいですか。';
export const AFTER_LEAVING_DETAIL = 'いつごろまで、どうやって（社長から電話、など）聞けばよいですか。あなたの電話番号やアドレスは書かないでください。';
export const AFTER_LEAVING_CHOICES = [
  { value: 'yes', label: '聞いてよい', description: '続けて、いつごろまでと、聞き方を 1 行で聞きます' },
  { value: 'no', label: '聞かないでほしい', description: '説明書には何も載せません' },
  { value: 'unknown', label: '分からない', description: '説明書には何も載せません' },
];

// 答えが退職後のことを言っているか
const ABOUT = /退職|辞め|やめた/u;
// 個人の連絡先の形（電話番号、メールアドレス、URL）
export const CONTACT_SHAPE = /\d{2,4}\s*-\s*\d{2,4}\s*-\s*\d{3,4}|0\d{9,10}|[A-Za-z0-9._%+-]+\s*[@＠]|https?:\/\//u;

const coversAfterLeaving = (entry) => entry.gap === AFTER_LEAVING_GAP || (entry.covers ?? []).includes(AFTER_LEAVING_ITEM);

/** 退職後に聞く道の答え。20 問の中の「退職後の連絡」の答えか、この段の答え。なければ null。 */
export function afterLeavingEntries(transcript) {
  return transcript.entries.filter((entry) => coversAfterLeaving(entry) && entry.status === 'answered' && ABOUT.test(entry.answer));
}

/** この段の問いが要るか。20 問の中に退職後の答えがなく、この段でもまだ聞いていないとき。 */
export function needsAfterLeaving(transcript) {
  if (transcript.entries.some((entry) => entry.gap === AFTER_LEAVING_GAP)) return false;
  return afterLeavingEntries(transcript).length === 0;
}

/** 選んだ答えを聞き取りの記録にする。「聞いてよい」のときだけ、1 行の答えを付ける。 */
export function recordAfterLeaving(transcript, { choice, detail = '', answeredAt }) {
  const chosen = AFTER_LEAVING_CHOICES.find((candidate) => candidate.value === choice);
  if (!chosen) throw new Error('答えは yes（聞いてよい）、no（聞かないでほしい）、unknown（分からない）のどれかです');
  if (choice === 'yes' && !detail.trim()) throw new Error('「聞いてよい」のときは、いつごろまでと聞き方を 1 行で教えてください');
  if (CONTACT_SHAPE.test(detail)) throw new Error('電話番号やアドレスは記録しません。社長を通して聞く道だけを書いてください');
  const answer = choice === 'yes' ? `退職したあとも、社長を通して聞いてよい。${detail.trim()}` : choice === 'no' ? '退職したあとは、聞かないでほしい。' : '分からない。';
  return appendExtraEntry(transcript, {
    gap: AFTER_LEAVING_GAP,
    covers: [AFTER_LEAVING_ITEM],
    question: `${AFTER_LEAVING_QUESTION}${choice === 'yes' ? AFTER_LEAVING_DETAIL : ''}`,
    answer,
    status: choice === 'unknown' ? 'unknown' : 'answered',
    answeredAt,
  });
}

/**
 * Writer の共通部分の after_leaving を確かめる。
 * 根拠は退職後の答えだけ。社内の相手（社長など）を通す道であること。電話番号やアドレスの形を書かない。
 * 退職する本人の名前を書かないことは、ほかの文と同じ検査（statementProblems）で止める。
 */
export function afterLeavingProblems(output, statements, transcript) {
  const id = output.after_leaving;
  const allowed = new Set(afterLeavingEntries(transcript).map((entry) => entry.id));
  const said = transcript.entries.some((entry) => entry.gap === AFTER_LEAVING_GAP && entry.status === 'answered' && entry.answer.startsWith('退職したあとも'));
  if (!id) return said ? ['after_leaving：前任者が「退職したあとも、社長を通して聞いてよい」と答えています。after_leaving に 1 文を書いてください'] : [];
  const statement = statements.find((candidate) => candidate.id === id);
  if (!statement) return [`after_leaving：statements にない文章です（${id}）`];
  const problems = [];
  if (!allowed.size) problems.push('after_leaving：退職後に聞いてよいという答えがないので、書けません。null にしてください');
  else if (!statement.evidence.some((ref) => allowed.has(ref))) problems.push(`after_leaving：根拠は退職後の答え（${[...allowed].join('、')}）にしてください`);
  const internal = (output.contacts ?? []).filter((contact) => contact.id.startsWith('INH-')).map((contact) => contact.name);
  if (![...internal, '社長'].some((name) => statement.text.includes(name))) problems.push('after_leaving：社内の相手（社長など）を通して聞く道として書いてください');
  if (CONTACT_SHAPE.test(statement.text)) problems.push('after_leaving：電話番号やアドレスは書かないでください');
  return problems;
}
