// 更新した人の PC のアカウント名と PC 名を読む。更新の記録に残すためで、本人確認ではない。
// テスト、サンプル、撮影では、環境変数 HIKITSUGI_IDENTITY で架空の値を渡し、実際の名前を残さない。

import { hostname, userInfo } from 'node:os';

export const IDENTITY_ENV = 'HIKITSUGI_IDENTITY';

const clean = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/**
 * アカウント名と PC 名を返す。取れなかった値は null。
 * 環境変数があればその値を使い、source を env にする。記録を見れば、OS から読んだ値かどうかが分かる。
 */
export function machineIdentity(env = process.env) {
  if (env[IDENTITY_ENV]) {
    let given;
    try {
      given = JSON.parse(env[IDENTITY_ENV]);
    } catch {
      throw new Error(`${IDENTITY_ENV} は {"account":"…","host":"…"} の形で指定してください`);
    }
    return { account: clean(given?.account), host: clean(given?.host), source: 'env' };
  }
  const read = (fn) => {
    try {
      return clean(fn());
    } catch {
      return null;
    }
  };
  return { account: read(() => userInfo().username), host: read(() => hostname()), source: 'os' };
}

const plainName = (name) => name.trim().replace(/\s+/g, ' ').replace(/(さん|様|氏)$/, '');

/**
 * 今回名乗った名前が、過去の記録で別のアカウント名と組になっていれば、そのアカウント名の一覧を返す。
 * アカウント名の欄のない前の版の記録と、今回のアカウント名が取れないときは比べない。
 */
export function otherAccountsOf(updates, by, account) {
  if (!account) return [];
  const name = plainName(by);
  return [...new Set((updates ?? []).filter((update) => update.account && plainName(update.by) === name && update.account !== account).map((update) => update.account))];
}
