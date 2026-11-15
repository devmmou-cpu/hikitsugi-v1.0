# 公開前の点検と、入れる手順の確かめ（2026-11-15）

v1.0 の順番 5「公開の準備」の 5 と 6。Claude が行い、本人の確認待ち。ブランチと作業フォルダは消していない（下は案だけ）。

## 1. 入れる手順（マーケットプレイスから最初の質問まで）
リポジトリの直下に `.claude-plugin/marketplace.json`（マーケットプレイスの名前 `hikitsugi`、プラグインは `./plugin`）を置いた。

### 確かめたこと（Claude Code 2.1.325、Mac）
| 確かめたこと | 結果 |
|---|---|
| `claude plugin validate .`（マーケットプレイス）と `claude plugin validate plugin` | 合格。警告 2 件：アイコンがない（公式のプラグインの一覧に出すときだけ要る）、`plugin/.DS_Store`（手元にあるだけで、リポジトリには入っていない） |
| 別の設定フォルダ（`CLAUDE_CONFIG_DIR`）で、リポジトリのクローンをマーケットプレイスとして足し、`claude plugin install hikitsugi@hikitsugi` | 入って有効になった |
| 1 行の形 `claude plugin install hikitsugi --marketplace <場所>` | マーケットプレイスの追加から入れるまで、1 行で通った |
| 空のフォルダで `claude -p "/hikitsugi:start"`（ヘッドレス、API キー） | 2 手、$0.10 で、最初の質問（会社名、退職する人の名前、まとめた調査データの有無）が出た。作業フォルダはまだ作らない |

普段の設定を変えないよう、設定フォルダは確かめ用に別に作った。

### 確かめていないこと
- GitHub からの取得（リポジトリが Private のため。上の確かめは、手元のクローンをマーケットプレイスにした）
- 対話の画面での `/plugin` の操作と、入れたあとの再起動の要否
- Windows での入れ方

### 利用者が打つ行の数
| 打つ場所 | 行 |
|---|---|
| ターミナル | `claude plugin install hikitsugi --marketplace <公開するリポジトリ>` |
| ターミナル | `mkdir handover && cd handover` |
| ターミナル | `claude` |
| Claude Code | `/hikitsugi:start` |

合計 4 行。`<公開するリポジトリ>` は、リポジトリ名が決まってから README に書く（仮の名前は書かない）。今の README の「B. 動かす」は、同梱の調査データを使うためにリポジトリを clone する手順で、行の数は同じ 4 行（clone、フォルダ、`claude --plugin-dir`、`/hikitsugi:start`）。

### 公開する前（Private のあいだ）の確かめ方
1. **手元：** 次の 4 行で、上の表と同じことを確かめられる（`<作業用>` は空のフォルダ）。
   ```
   export CLAUDE_CONFIG_DIR=<作業用>/config
   claude plugin install hikitsugi --marketplace <リポジトリのフォルダ>
   mkdir <作業用>/handover && cd <作業用>/handover
   claude -p "/hikitsugi:start"
   ```
2. **GitHub の Private のまま（本人の PC）：** 1 の 2 行目の `<リポジトリのフォルダ>` を `<owner>/<repo>` にする。手元の git の認証で取得できるかは、まだ確かめていない
3. **公開したあと：** GitHub にログインしていない環境（別の設定フォルダと、認証のない git）で 1 と同じことをし、最初の質問が出るまでを確かめる

## 2. 秘密情報の点検（すべての履歴）
いつもの点検（`node scripts/check-secrets.mjs`）は、今のブランチの履歴だけを見る。公開に備え、すべてのブランチとタグとリモートの参照（26 個）の履歴の追加行を、同じ形で走査した（値は出さない）。

| 調べたもの | 結果 |
|---|---|
| API キー、GitHub・AWS・Slack のトークン、秘密鍵、キーの代入の形 | 0 件 |
| この PC のアカウント名と PC 名（OS から読んだ 3 語） | 0 件 |
| E5 の評価用ダミー（調整用 3 社） | 決められた場所（各社の `eval/sets/<会社>/input/statements.json`）だけ |

holdout の 2 社のダミーは、開かない約束なので、この走査では調べていない（`eval/lib/integrity.mjs` の検査が、今の中身で見ている）。

## 3. 実在の会社のデータ
すべての履歴の追加行と、これまでに入ったファイルの名前（345 個）を見た。

| 調べたもの | 結果 |
|---|---|
| 調査の結果のファイル（`hikitsugi-survey-*.json`） | 0 件。調査の固定データ（`test/fixtures/survey-raw/`）は架空のオコジョ精工のもの |
| 会社名の形（株式会社など） | 許可した 5 社の名前だけ（ほかは、テストの違反の例「株式会社テスト」と、正規表現の書き方の一部） |
| 03-0000-01xx 以外の電話番号の形 | 6 種類。どれもテストの違反の例か、実在しえない形（0120-000-000、06-0000-0000、03-0000-0200 など）。ただし `03-1234-5678` は実在しうる形だった |
| ドメイン | 出典（東京商工会議所、IPA）、anthropic.com、github.com、claude.ai、npm、example.com だけ。ただし `admin.okojo-seiko.com` は実在しうる形だった |

- テストの違反の例 2 つ（`03-1234-5678`、`admin.okojo-seiko.com`）は、実在しえない形（`03-0000-0299`、`admin.okojo-seiko.example.com`）に置き換えた。検査が違反として見つけることは変わらない。前の文字列は履歴に残る（履歴は書き換えない）
- 実在の名前の禁止リストはリポジトリに置かない約束なので、人名は許可リストの検査（評価データ）と、この点検の会社名の形でだけ見た。文書の中の人名を 1 つずつ照らす点検はしていない

## 4. ライセンスと素材
- リポジトリは MIT（`LICENSE`、2026 Okojyo-Soft）。`plugin.json` とマーケットプレイスの定義も MIT
- プラグインは外部ライブラリを使わない。評価の道具だけが `@anthropic-ai/sdk`（Apache-2.0）を使い、`node_modules` はリポジトリに入れていない
- フォントの埋め込みはない（テストで止めている）。画像は README の 2 枚（自作の画面の撮影）だけ
- 公表資料は、README の出典に書いた 2 つの数字の引用だけで、資料そのものは入れていない

## 5. 古いブランチと作業フォルダの扱いの案（消さない）
| もの | 今 | 案 |
|---|---|---|
| 手元のブランチ 14 本（`night/*`、`review/*`、`day/*`、`feat/*`、`fix/*`、`phase0/*`、`prep/*`、`post/*`、`main`） | そのまま | 消さない。公開するリポジトリには `main` だけを送る |
| 作業フォルダ 6 つ（`hikitsugi`、`hikitsugi-live`、`hikitsugi-r1`、`hikitsugi-review`、`hikitsugi-survey`、`hikitsugi-visual`） | そのまま | 消さない。公開に関係しない |
| `hikitsugi-r1` の未登録ファイル 2 つ（`docs/design/landing-spec.md`、`docs/design/plain-words.md`） | 未登録のまま | 触らない。中身は、コミット `c919e9e`（11/3）で足した版と同じで、履歴に残っている |
| タグ（`stage1`、`stage2`、`submission-20261108`、`night-base/*` 5 つ、`day-base/*` 1 つ） | 手元 | 公開するリポジトリには `stage*` と `submission-20261108` と v1.0 のタグだけを送り、`night-base/*` と `day-base/*` は送らない |
| origin（hikitsugi-next）の `post/stage1-update`、`post/v1-final` | これから送る | origin をそのまま公開するなら見える。`main` に入ったあとで消すかは本人の判断（消すのは本人の操作） |
| `submitted`（提出したリポジトリ） | 変えない | 変えない。ABOUT からの誘導は順番 7 |

## 6. 公開の前に本人が決めること（仮の値は書いていない）
- 公開するリポジトリ名（README の入れる手順と、マーケットプレイスの `<owner>/<repo>` に入る）
- オコジョソフトのリンク先、感想の受け口
- サンプルを、リンク 1 つで開ける場所に置くか
- プラグインの版の番号（今は `0.1.0`。v1.0 のタグのときに `1.0.0` にする案）と、アイコンを用意するか（公式の一覧に出す場合だけ要る）
