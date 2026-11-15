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

### 入れ方の 3 つの形（11/15 の 2 回目。Claude Code 2.1.325、手元のクローンをマーケットプレイスにし、形ごとに別の設定フォルダ）
| 形 | 結果 | 公式の説明（code.claude.com/docs/en/plugins/install、cli-reference） |
|---|---|---|
| (a) ターミナル：`claude plugin install hikitsugi --marketplace <場所>` | **通った**（マーケットプレイスの追加と入れることが 1 行で済み、`claude plugin list` で有効） | ターミナルの形として載っている。v2.1.292 以上 |
| (b) ターミナル：`claude plugin marketplace add <場所>` のあと `claude plugin install hikitsugi@hikitsugi` | **通った**（@ のあとの `hikitsugi` は marketplace.json の `name`） | 載っている |
| (c) Claude Code の中：`/plugin install hikitsugi --marketplace <場所>` | **確かめられなかった**。ヘッドレス（`claude -p`）では「`/plugin isn't available in this environment.`」と返る（費用 $0） | 会話の中の形として載っている（v2.1.275 以上）。パネルが開き、確認と範囲の選択がある |

README には、通った (a) と (b) だけを書いた（前に書いた「2.1.275 以上」は (c) の条件だったので、(a) の 2.1.292 に直した）。

### 公開のあとに本人が確かめる手順（3 行）
1. ターミナルで `claude plugin install hikitsugi --marketplace devmmou-cpu/hikitsugi-v1.0`（「Successfully installed plugin: hikitsugi@hikitsugi」と出れば通過）
2. 空のフォルダで `claude` を開き、`/hikitsugi:start` と入力する（会社名と退職する人の名前を聞かれれば合格）
3. 戻すときは `claude plugin marketplace remove hikitsugi`（入れたプラグインも外れる）

### 確かめていないこと
- GitHub からの取得（リポジトリが Private のため。上の確かめは、手元のクローンをマーケットプレイスにした）
- 対話の画面での `/plugin` の操作と、入れたあとの再起動の要否
- Windows での入れ方

### 利用者が打つ行の数
| 打つ場所 | 行 |
|---|---|
| ターミナル | `claude plugin install hikitsugi --marketplace devmmou-cpu/hikitsugi-v1.0` |
| ターミナル | `mkdir handover` |
| ターミナル | `cd handover` |
| ターミナル | `claude` |
| Claude Code | `/hikitsugi:start` |

合計 5 行（README の「使ってみる」）。11/15 の採点で、`&&` が Windows の PowerShell 5.1 で使えないと指摘されたので、`mkdir` と `cd` を分けた。Windows なしで試すときは、架空の調査データを取る 1 行（`curl -LO …/survey.json`）が増えて 6 行。

### 公開する前（Private のあいだ）の確かめ方
1. **手元：** 次の 4 行で、上の表と同じことを確かめられる（`<作業用>` は空のフォルダ）。
   ```
   export CLAUDE_CONFIG_DIR=<作業用>/config
   claude plugin install hikitsugi --marketplace <リポジトリのフォルダ>
   mkdir <作業用>/handover && cd <作業用>/handover
   claude -p "/hikitsugi:start"
   ```
2. **GitHub の Private のまま（本人の PC）：** 1 の 2 行目の `<リポジトリのフォルダ>` を `devmmou-cpu/hikitsugi-v1.0` にする。手元の git の認証で取得できるかは、まだ確かめていない
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
| origin（hikitsugi-v1.0。11/15 に hikitsugi-next から改名）の `post/stage1-update`、`post/v1-final` | これから送る | origin をそのまま公開するなら見える。`main` に入ったあとで消すかは本人の判断（消すのは本人の操作） |
| `submitted`（提出したリポジトリ） | 変えない | 変えない。ABOUT からの誘導は順番 7 |

## 6. サンプルを置く場所の案（架空のサンプルだけ。本人の了承 11/15）
入口のページ `samples/okojo/index.html` を作った。PC 用（`manual.html`）と、スマホ用の束の 15 ファイルへのリンクだけのページで、JavaScript も外部の読み込みもない。README の「今すぐ見る」は、この入口を開く。

| 案 | 中身 | よい所 | 気になる所 |
|---|---|---|---|
| **A（推す）：`gh-pages` ブランチに、サンプルだけを置く** | `index.html`、`manual.html`、`phone/`、`.nojekyll`、`.gitignore` だけのブランチ。GitHub の Pages の設定で、このブランチの先頭を公開 | 公開されるのはサンプルだけ。仕組みが単純で、外部の道具が要らない | サンプルを作り直したら、ブランチも手で入れ替える |
| B：GitHub Actions で `samples/okojo/` を公開 | 公式の Pages 用の Actions で、main に push するたびに置き直す | 入れ替えを忘れない | ワークフローのファイルが増える。外部の道具（Actions）に頼る |
| C：main の `/docs` を公開 | サンプルを `docs/` の下に移す | ブランチが増えない | 設計書などの文書もまとめて公開される |

**URL（案 A・B とも）：** 入口 https://devmmou-cpu.github.io/hikitsugi-v1.0/ 、PC 用 …/manual.html 、スマホ用 …/phone/（入口から 1 つずつ開く。Pages はフォルダの一覧を出さないため）。

**決定（11/15）：案 A。** Pages を有効にするのは、公開と同じときに本人が行う。それまでは準備だけ。

**本人が実行する順番：**
1. （いつでもよい。手元だけ）サンプルだけのブランチを作る
   ```
   git worktree add --orphan -b gh-pages ../hikitsugi-pages
   cp -R samples/okojo/index.html samples/okojo/manual.html samples/okojo/phone ../hikitsugi-pages/
   touch ../hikitsugi-pages/.nojekyll
   printf '%s\n' '.DS_Store' '# 秘密情報を入れない（公開用のサンプルだけを置くブランチ）' '.env' '.env.*' '*.pem' '*.key' > ../hikitsugi-pages/.gitignore
   git -C ../hikitsugi-pages add -A
   git -C ../hikitsugi-pages commit -m "サンプル（架空のオコジョ精工）の公開用"
   node scripts/check-secrets.mjs ../hikitsugi-pages
   ```
   `.gitignore` は、`.env` などを無視させるために置く（理由は 7 の (2) の注）。点検はコミットのあとに行う（コミットのないブランチでは点検が動かない）。
2. （公開のとき）`git push origin gh-pages`
3. （公開のとき）GitHub でリポジトリを Public にする
4. （公開のとき）Settings → Pages で、Source を「Deploy from a branch」、Branch を `gh-pages` の `/ (root)` にして保存する
5. （公開のあと、数分待って）https://devmmou-cpu.github.io/hikitsugi-v1.0/ を開き、「PC 用の説明書を開く」と、スマホ用の一覧の 1 つが開けることを確かめる

**サンプルを作り直したとき：** 1 の `cp` から `commit` までを、`../hikitsugi-pages` の中身を入れ替えてやり直し、`git push origin gh-pages` を実行する。

**Private のあいだの確かめ方：** 手元で、入口のフォルダを HTTP で配って開く（`python3 -m http.server` を `samples/okojo` で実行し、ブラウザーで `http://127.0.0.1:8000/` を開く）。11/15 に Claude がこの形で確かめ、入口のリンク 16 件（PC 用 1、スマホ用 15）がすべて開けた。Private のリポジトリで Pages を有効にすると（有料の契約が要る）、リポジトリが Private でもサイトは誰でも見られるので、有効にするのは公開と同じときをすすめる。

## 7. 公開の手順（本人が実行する順番。Claude は実行しない）
`<公開する版>` は、最後の報告に書いた公開する版のコミットの SHA。その前に、報告の「送るコマンド」を実行しておく。

**(1) main に早送りし、タグ v1.0 を付けて送る**
```
git push . <公開する版>:refs/heads/main
git tag -a v1.0 <公開する版> -m "v1.0（完成版）"
git push origin main v1.0
```
1 行目は手元の main の早送り（早送りにならないときは止まる）。

**(2) サンプルだけのブランチを作って送る（案 A。上の 6 と同じ）**
```
git worktree add --orphan -b gh-pages ../hikitsugi-pages
cp -R samples/okojo/index.html samples/okojo/manual.html samples/okojo/phone ../hikitsugi-pages/
touch ../hikitsugi-pages/.nojekyll
printf '%s\n' '.DS_Store' '# 秘密情報を入れない（公開用のサンプルだけを置くブランチ）' '.env' '.env.*' '*.pem' '*.key' > ../hikitsugi-pages/.gitignore
git -C ../hikitsugi-pages add -A
git -C ../hikitsugi-pages commit -m "サンプル（架空のオコジョ精工）の公開用"
node scripts/check-secrets.mjs ../hikitsugi-pages
git push origin gh-pages
```
注（11/15 の公開で足した手順）：`.gitignore` の行は、最初に書いた手順になかった。11/15 の公開では、本人の承認を受けて Claude が (1) と (2) を実行し、gh-pages に `.gitignore` を足してから送った（gh-pages のコミット `c208fb2`）。足したのは、`.gitignore` がないと、秘密情報の点検（`check-secrets`）の「`.env` などが `.gitignore` で無視されるか」の項目で落ちるため。中身の点検（追跡ファイル、履歴、この PC の名前）は、足す前から問題がなかった。Pages では `.gitignore` もファイルとして配られるが、書いてあるのは無視するファイルの名前の形だけ。

**(3) GitHub の画面で行うこと（リポジトリ hikitsugi-v1.0）**
1. Settings → General → Danger Zone → Change repository visibility で **Public** にする
2. Settings → Pages で、Source を「Deploy from a branch」、Branch を `gh-pages` の `/ (root)` にして保存する
3. Settings → Code security（Advanced Security）で、**Secret Protection** と **Push protection** を有効にする
4. Settings → General → Features で **Issues** に印があることを確かめ、リポジトリの Issues のタブが開くことを確かめる
5. 旧リポジトリ（hikitsugi、submitted）の About 欄の変更は、本人が GitHub の画面で行う（Claude Code は触らない）

**(4) 公開のあとに確かめること**
| 確かめること | やり方 |
|---|---|
| サンプルが開く（PC 用とスマホ用） | https://devmmou-cpu.github.io/hikitsugi-v1.0/ を開き、「PC 用の説明書を開く」と、スマホ用の一覧の 1 つを開く。スマホでも開く |
| README の画像とリンクが開く | README を上から開き、画像（7 種類。図を含む）が出ること、サンプル・Issues・出典・文書のリンクが開くことを確かめる |
| 入れる 1 行が通る | `claude plugin install hikitsugi --marketplace devmmou-cpu/hikitsugi-v1.0`（「Successfully installed plugin」） |
| 最初の質問が出る | 空のフォルダで `claude` を開き、`/hikitsugi:start`（会社名と退職する人の名前を聞かれる） |
| 外し方が通る | `claude plugin marketplace remove hikitsugi` のあと、`claude plugin list` に hikitsugi が出ない |
| 試すための調査データが取れる | `curl -LO https://raw.githubusercontent.com/devmmou-cpu/hikitsugi-v1.0/main/eval/sets/okojo/input/survey.json` |

**ログインしていない環境で確かめる方法**
- サンプルと README：ブラウザーのプライベートウィンドウ（GitHub にログインしていない状態）で開く
- 入れる 1 行：GitHub の認証を使わない設定で、別の設定フォルダに入れる。通れば、公開された中身だけで入れられる
  ```
  GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0 CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1 CLAUDE_CONFIG_DIR="$(mktemp -d)" claude plugin install hikitsugi --marketplace devmmou-cpu/hikitsugi-v1.0
  ```
- `curl` の URL も、同じく認証なしで取れることを確かめる

**(5) origin に残る作業ブランチ（post/stage1-update、post/v1-final）の案**
- 案：(1) で main がこの 2 本を含むようになったら（`git branch -r --contains origin/post/v1-final` に `origin/main` が出れば）、origin から消す。中身は main とタグに残るので、なくなるものはない。公開したリポジトリの見え方が main 1 本になる
- 消すのは本人の操作：`git push origin --delete post/stage1-update post/v1-final`
- 手元のブランチと作業フォルダは消さない（今までどおり）

## 8. 公開の前に本人が決めること（仮の値は書いていない）
- 公開するリポジトリ名：**決定（11/15）** `hikitsugi-v1.0`。README の入れる手順、サンプルの URL、リンクは新しい名前で書いた
- サンプルを、リンク 1 つで開ける場所に置くか：**決定（11/15）** 置く。置き方は上の 6 の案 A〜C から選ぶ
- オコジョソフトのリンク先：**決定（11/15）** https://okojyo-soft.com/ 。感想の受け口：**決定（11/15）** GitHub の Issues（報告は任意）
- プラグインの版の番号：公開する版を v1.0 と呼ぶ決定に合わせ、`1.0.0` にした
- アイコン：**決定（11/15）** 用意しない（公式のプラグインの一覧に出す場合だけ要る警告。検査は合格）
