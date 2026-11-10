// テストの起動時に読み込む。更新の記録に残るアカウント名と PC 名を、架空の値にする。
// 実際の PC のアカウント名と PC 名を、テストの出力や作ったファイルに残さないため。

import { IDENTITY_ENV } from '../plugin/lib/identity.mjs';

export const TEST_IDENTITY = { account: 'user-a', host: 'OKJ-PC01' };

process.env[IDENTITY_ENV] ??= JSON.stringify(TEST_IDENTITY);
