// 担当の引き継ぎ（説明書を作ったあとに、担当が代わるとき）。
// 去る人を、連絡先・相談先・パスワードの保管場所・決まった作業をする人にしている文と項目をすべて見つけ、直すまで完了させない。
// そのほかに名前が出てくる文（経緯の説明など）は、1 件ずつ「このままでよい」を確かめる。
// 文字列の照合で行うので、毎回同じ結果になる。

import { nameForms, namesOf, namesRetireeAsContact } from './retiree-check.mjs';

/** 退職した人の一覧。最初の前任者と、担当を引き継いで去った人。 */
export function departedNames(retiree, manual) {
  const handed = (manual?.updates ?? []).filter((update) => update.kind === 'handover').map((update) => update.from);
  return [...new Set([...namesOf(retiree), ...handed])];
}

/** 今の担当。引き継ぎの記録の最後の「新しい担当」と、その日付。記録がなければ null。 */
export function currentOwner(manual) {
  const last = (manual.updates ?? []).filter((update) => update.kind === 'handover').at(-1);
  return last ? { name: last.to, since: last.date } : null;
}

const mentions = (text, forms) => forms.some((form) => text.includes(form));

/**
 * 去る人が残っている場所。
 * @returns { blocking: [{ id, where, text }], other: [{ id, text }] }
 *   blocking は直すまで完了しないもの、other は 1 件ずつ確かめるもの
 */
export function takeoverHits(manual, from) {
  const forms = nameForms(from);
  const byId = new Map(manual.statements.map((statement) => [statement.id, statement]));
  const blocking = [];
  const seen = new Set();
  const block = (id, where, text) => {
    if (seen.has(id)) return;
    seen.add(id);
    blocking.push({ id, where, text });
  };
  for (const contact of manual.contacts) if (mentions(contact.name, forms)) block(contact.id, '連絡先', contact.name);
  for (const device of manual.devices) {
    for (const id of [device.credential_location, device.caution].filter(Boolean)) {
      const statement = byId.get(id);
      if (statement && mentions(statement.text, forms)) block(id, 'パスワードの保管場所や、してはいけないこと', statement.text);
    }
  }
  for (const routine of manual.routines) {
    for (const id of [routine.title, ...routine.steps]) {
      const statement = byId.get(id);
      if (statement && !statement.library && mentions(statement.text, forms)) block(id, '決まった作業', statement.text);
    }
  }
  for (const statement of manual.statements) {
    if (statement.library || seen.has(statement.id)) continue;
    if (namesRetireeAsContact(statement.text, from)) block(statement.id, '連絡・相談の相手', statement.text);
  }
  const other = manual.statements.filter((statement) => !statement.library && !seen.has(statement.id) && mentions(statement.text, forms)).map((statement) => ({ id: statement.id, text: statement.text }));
  return { blocking, other };
}
