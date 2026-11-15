// 退職する担当者を、連絡先として案内している文章を見つける。
// AI の判断ではなく文字列の照合で行うので、毎回同じ結果になる。/hikitsugi:start と評価の両方で使う。

const ACTION = '連絡|電話|相談|転送|報告|知らせ|問い合わせ|問合せ|聞い|聞く|聞け|聞き|聞か|送っ|送る|送り|送信|伝え|頼';
const PLACE = '連絡先|転送先|相談先|報告先|問い合わせ先|問合せ先|窓口';

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 退職した人の名前の一覧。最初の前任者のほか、担当を引き継いで去った人も入る。1 人なら文字列でもよい。 */
export const namesOf = (retiree) => (Array.isArray(retiree) ? retiree : [retiree]).filter((name) => typeof name === 'string' && name.trim());

/** 名前の呼び方の一覧。「田中 太郎」なら、全体と名字で探す。敬称は外す。 */
export const nameForms = (name) => {
  const plain = name.trim().replace(/(さん|様|氏)$/, '');
  const compact = plain.replace(/\s+/g, '');
  return [...new Set([compact, plain.split(/\s+/)[0]])].filter(Boolean);
};

/** 文章の中で、退職する担当者を連絡先、転送先、相談先として書いているか。 */
export function namesRetireeAsContact(text, retiree) {
  if (Array.isArray(retiree)) return namesOf(retiree).some((name) => namesRetireeAsContact(text, name));
  if (!retiree?.trim()) return false;
  return text.split('。').some((sentence) =>
    nameForms(retiree).some((form) => {
      const who = `${escapeRegExp(form)}(?:さん|様|氏)?`;
      // 「田中さんに連絡」「田中さんへ転送」「田中さんと社長に連絡」「田中さんにも相談」
      const asTarget = new RegExp(`${who}(?:に|へ|と|や|、|・|まで)[^。]*?(?:${ACTION})`);
      // 「連絡先は田中さん」「田中さんが相談先です」
      const asPlace = new RegExp(`(?:${PLACE})[^。]*${who}|${who}[^。]*(?:${PLACE})`);
      return asTarget.test(sentence) || asPlace.test(sentence);
    }),
  );
}

/** 検査に当たった文章と連絡先を、検証結果の形で返す。 */
export function retireeFindings(manual, retiree) {
  const reason = '退職する担当者を連絡先、転送先、相談先として案内しています（文字列の照合）。社内の相談先の先頭に置き換えてください。記録に置き換え先がなければ「記録がありません。社内で相談してください」と書いてください。';
  const hits = new Set(manual.statements.filter((statement) => namesRetireeAsContact(statement.text, retiree)).map((statement) => statement.id));
  // 連絡先の一覧そのものに載っている場合は、役割の文章に当てて、その部分を書き直してもらう
  const forms = namesOf(retiree).flatMap(nameForms);
  for (const contact of manual.contacts) {
    if (forms.some((form) => contact.name.includes(form))) hits.add(contact.role);
  }
  return [...hits].map((statement) => ({ statement, verdict: 'dangerous', reason, checked: [], conflicts_with: [] }));
}

/** 連絡先の一覧に、退職する担当者そのものが載っていないか。Writer の段階で止めるための、形の問題の文を返す。 */
export function retireeContactProblems(contacts, retiree) {
  const forms = namesOf(retiree).flatMap(nameForms);
  return contacts
    .filter((contact) => forms.some((form) => contact.name.includes(form)))
    .map((contact) => `${contact.id}: 退職する担当者を連絡先に載せないでください。説明書を読むころには連絡できません。社内の相談先の先頭に置き換えてください`);
}

/** 検証結果に、文字列の照合の結果を上書きする。AI の判定より優先する。 */
export function applyRetireeCheck(verification, manual, retiree) {
  const findings = retireeFindings(manual, retiree);
  const hit = new Set(findings.map((finding) => finding.statement));
  return {
    verification: { ...verification, results: [...verification.results.filter((result) => !hit.has(result.statement)), ...findings] },
    hits: findings.length,
  };
}
