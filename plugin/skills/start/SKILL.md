---
name: start
description: 兼任の情シス担当者が退職するときに、1問ずつ質問に答えるだけで、IT 未経験の後任が使える取扱説明書を作ります。引き継ぎの資料を作りたいと言われたときに使います。
allowed-tools: Read Write Agent AskUserQuestion Bash(node *)
---

# ヒキツギ

退職する担当者の知識を、IT 未経験の後任が使う取扱説明書にまとめます。**相手は IT の専門家とは限りません。** 専門用語を避け、今どこまで進んだかを短く伝えながら進めます。

進行は次のプログラムが支えます。結果は `hikitsugi-work/` に保存されるので、途中で止めても続きから再開できます。

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikitsugi.mjs" <コマンド>
```
以下では、これを `hikitsugi` と書きます。実行するときは毎回この形のまま書き、変数に入れて呼びません（zsh では変数の中の空白で分かれず、動きません）。Bash の説明（description）も、画面に出す文も日本語で書きます。

## 最初に
`hikitsugi status` を実行し、返ってきた `step` の段階から始めます。段階が終わるたびに `hikitsugi status` で次を確かめます。

`status` に `"unchecked": true` があるときは、結果のファイルはありますが、検査に通っていません。その段階の検査（`check-gaps`、`check-writer <round> <part>`、`check-verification <round>`）を実行し、問題が表示されたら内容を担当に伝えて直してもらいます。先へ進みません。

プログラムが問題を表示したら、内容に従って直します。**検査を飛ばしたり、結果のファイルを手で書き換えて通したりしません。**

## 守ること
- **パスワードや認証情報の本体を聞きません。記録しません。** 聞くのは保管場所だけです。プログラムが本体らしい回答を拒否したら、保管場所だけを教えてもらうよう、やさしくお願いします。
- **調査データも聞き取りも、このパソコンの外へ送りません。** 取扱説明書の置き場所は本人が決めます。
- サブエージェントには、ファイルのパスと、保存先を指定して渡します。

## 段階

### init
調査は、本人が自分の PC の PowerShell で実行します。**同意の確認があるので、こちらからは実行しません。** 調査の結果は、本人が中身を確かめるまで開きません。

1. 会社名と、退職する人の名前を聞きます。すでにまとめた調査データがあれば、そのパスも聞いて手順 6 へ進みます。
2. 調査を実行してもらいます。次のコマンドを、`${CLAUDE_PLUGIN_ROOT}` を実際のパスに置き換えて見せます。結果は、そのとき開いているフォルダに `hikitsugi-survey-<PC 名>-<日付>.json` として保存されます。
   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/scripts/survey.ps1"
   ```
   次のことを伝えます。
   - 集める内容と集めない内容が画面に出ます。よければ `y` を入力します。パスワードやファイルの中身は集めません
   - 管理者として実行する必要はありません。`ExecutionPolicy Bypass` は今回の実行だけの指定で、PC の設定は変わりません
   - 読めない項目があっても止まりません。あとの質問で補います
3. PC が複数あれば、`survey.ps1` を社内の USB メモリなどで運び、各 PC で同じように実行してもらいます。
4. 中身を確かめてもらいます。結果のファイルをメモ帳で開き、渡したくない内容がないかを見てもらいます。AskUserQuestion で聞きます。選択肢は「確かめた」と「気になる内容がある」の2つです。気になる内容があれば、そのファイルは使わず、どうするかを相談します。
5. 確かめた結果のファイルを、すべてまとめます。会社の ID は、会社名から決める英小文字の短い名前です。
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/merge-survey.mjs" hikitsugi-survey-merged.json <会社の ID> <結果1.json> [結果2.json ...]
   ```
   「読めなかった項目として記録しました」と表示されたら、そのことを伝えて先へ進みます。あとの質問で補います。問題が表示されたら、内容を伝えて止まります。認証情報らしい値があると表示されたら、本人に元のファイルを確かめてもらい、調査をやり直すか相談します。**値を読み上げたり、聞き返したりしません。**
6. `hikitsugi init <調査データ> <退職する人の名前> <会社名>` を実行します。まとめた場合の調査データは `hikitsugi-survey-merged.json` です。

### gap-finder
`hikitsugi:gap-finder` に次を依頼します。
> `hikitsugi-work/survey.json` と `hikitsugi-work/checklist.json` を読み、結果の JSON を `hikitsugi-work/gaps.json` に保存してください。保存する形は `hikitsugi-work/gaps-format.json` です。項目の名前と値は、このとおりにしてください。

終わったら `hikitsugi check-gaps` を実行します。問題が表示されたら、その内容を伝えて直してもらいます。

### interview
1問ずつ、次を繰り返します。`status` の `pending_question` が `true` のときは、質問が保存されたまま止まっています。手順 2 から再開します。

1. `hikitsugi:interviewer` に次を依頼します。
   > `hikitsugi-work/` の `survey.json`、`gaps.json`、`checklist.json`、`transcript.json`、`interview-progress.json`（進み具合）を読み、次の1問の JSON（`action`、`gap`、`covers`、`question`、`unfilled`）を `hikitsugi-work/next.json` に保存してください。
2. `hikitsugi check-next` を実行します。聞き取りが終わったという表示が出たら、この段階は完了です。それ以外の表示が質問文です。問題が表示されたときは、その質問を本人に見せず、手順 1 からやり直します。
3. 質問文を AskUserQuestion で聞きます。選択肢は「分からない」と「あとで調べる」の2つにします。ふつうの回答は、選択肢の下にある自由入力の欄に書いてもらいます。案内するときは「下の欄に入力してください」と書き、「Other」とは書きません（画面の表示と合わないためです）。何問目かも伝えます。
4. 回答を記録します。回答の文は、本人の言葉のまま、標準入力で渡します。
   ```
   hikitsugi record answered <<'EOF_ANSWER'
   （回答の文）
   EOF_ANSWER
   ```
   「分からない」は `hikitsugi record unknown < /dev/null`、「あとで調べる」は `hikitsugi record later < /dev/null` です。

### common-symptoms
20 問のあとに、定番の症状を聞きます。20 問とは別に数えます。`status` の `stage` で進めます。

- `stage` が `select` のとき：`hikitsugi common-list` が出した番号つきの一覧を、文のまま見せます（AskUserQuestion は使いません。選択肢が多いためです）。「相談されたことがあるものの番号を、『1、4』のように書いてください。ひとつもなければ『なし』と書いてください」と伝え、答えを標準入力で渡します。
  ```
  hikitsugi common-select <<'EOF_ANSWER'
  （答えの文）
  EOF_ANSWER
  ```
  「分からない」と言われたら `hikitsugi common-select unknown < /dev/null` です。問題が表示されたら、その内容を伝えて答え直してもらいます。記録したあとに表示された行（相談されたことがある症状など）を、そのまま伝えます。
- `stage` が `followup` のとき：`hikitsugi common-next` が出した質問を、interview と同じく AskUserQuestion で聞きます（選択肢は「分からない」と「あとで調べる」）。何問目か（`asked` と `left`）も伝えます。答えは `hikitsugi common-record answered`（標準入力）、`hikitsugi common-record unknown < /dev/null`、`hikitsugi common-record later < /dev/null` で記録します。

選ばれなかった症状は手順のページにしません。説明書の「当てはまる症状がないとき」に題名だけが並びます。

### after-leaving
20 問の中で、退職後の連絡（退職したあとに聞いてよいか）の答えがなかったときだけ、書き始める前に 1 問聞きます。20 問とは別に数えます。

1. `status` の `question` を、AskUserQuestion で聞きます。選択肢は `choices` の `label` と `description` をそのまま使います（「聞いてよい」「聞かないでほしい」「分からない」）。
2. 「聞いてよい」なら、続けて `detail` の文で 1 行だけ聞きます（いつごろまでと、聞き方）。電話番号やアドレスは聞きません。書かれていたら、記録しないので消してもらいます。答えを標準入力で渡します。
   ```
   hikitsugi after-leaving yes <<'EOF_ANSWER'
   （いつごろまでと、聞き方）
   EOF_ANSWER
   ```
3. 「聞かないでほしい」は `hikitsugi after-leaving no < /dev/null`、「分からない」は `hikitsugi after-leaving unknown < /dev/null` です。

答えがあれば、後任向けの「はじめに」に、社長などを通して聞ける道が 1 文で載ります。前任者の名前と個人の連絡先は載りません。時期を過ぎても表示は変わりません。

### open-items
20 問、定番の症状、退職後の問いのあとに、「ほかに引き継ぐもの」を自由に挙げてもらいます。**任意です。** 始める前に「ここからは任意です。途中でやめて、あとで更新で足せます」と伝えます。上限は 5 件で、決まった部分（約 25 分）とは別に数えます。`status` の `stage` で進めます。

- `list`：`question` を文章で聞きます（AskUserQuestion は使いません。1 行に 1 つずつ書いてもらうため）。答えを `hikitsugi open-list` に標準入力で渡します。「ない」なら「ない」と渡します。
- `kind`：`name` の物の種類を、AskUserQuestion で聞きます。選択肢は `choices` の `label` と `description` をそのまま使います（4 つ）。`hikitsugi open-kind <value>` を実行します。
- `detail`：`question` を AskUserQuestion で聞きます。選択肢は「分からない」と「ここまでにする」の 2 つにし、ふつうの回答は下の欄に入力してもらいます。パスワードそのものは聞きません。答えは `hikitsugi open-detail`（標準入力）、「分からない」は `hikitsugi open-unknown`、「ここまでにする」は `hikitsugi open-stop` です。何件目か（`asked` と `total`）も伝えます。

挙がった物は、答えだけを根拠に、機器・連絡先・決まった作業として載ります。機器で、止まったときの答えがあれば、その物のページもできます。そのページには手順部品を置かず、「自分で直せる」にしません。IT ではない物は、題名だけが「対象外として挙がったもの」に並びます。

### writer
Writer は1回に1つの部分だけを書きます。`status` の `round` と `part` を使います。`part` は `common`（連絡先や手順ページの一覧など）か、手順ページの ID（`T1` など）か、`symptoms`（手順ページのない困りごとを、ページにするか外すかの判断）です。

1. `hikitsugi writer-task <round> <part>` を実行します。出力に待つ時間の目安（「約 N 分かかります」）の行があれば、**Writer を呼ぶ前に**、その行を言い換えずにそのまま本人に伝えます。
2. `hikitsugi:writer` に次を依頼します。
   > `hikitsugi-work/survey.json`、`hikitsugi-work/transcript.json`、`hikitsugi-work/library.json`、`hikitsugi-work/writer-task.json` を読み、`writer-task.json` を task として、その部分の結果の JSON だけを `hikitsugi-work/writer-<round>-<part>.json` に保存してください。保存する形は `hikitsugi-work/writer-format.json` です。項目の名前と値は、このとおりにしてください。
3. `hikitsugi check-writer <round> <part>` を実行します。問題が表示されたら、その内容を Writer に structure_problems として伝えて直してもらいます。通ったら、出力の進み具合の行（「15 枚中 4 枚が終わりました。残り約 N 分です。」など）を、**次の部分に進む前に**、そのまま本人に伝えます。

`status` が次の部分を示すあいだ、繰り返します。目安と進み具合はプログラムが実測から出しているので、自分で計算し直したり、省いたりしません。

### editor
`hikitsugi:plain-japanese-editor` に次を依頼します。
> `hikitsugi-work/manual-<round>.json`、`survey.json`、`transcript.json` を読み、結果の JSON（`rewrites` と `glossary`）を `hikitsugi-work/editor-<round>.json` に保存してください。

`round` が 2 以上のときは、次も加えます。
> `hikitsugi-work/editor-findings-<round>.json` を findings として読み、そこにある文章だけを直してください。すでにある用語の説明は作り直しません。

終わったら `hikitsugi merge-edits <round>` を実行します。出力の最後に、根拠と照らす段の目安（「約 N 分、途中の表示はありません」）があれば、Verifier を呼ぶ前に、そのまま本人に伝えます。問題が残ったと表示されたら、`plain-findings-<round>.json` を findings として渡し、同じ保存先へ前回の内容に追記する形で1回だけ直してもらって、もう一度 `merge-edits` を実行します。`long_sentences` の指摘に `glossary_term` があるものは用語の説明の文なので、`rewrites` ではなく、`glossary` に同じ語の説明を直して追記してもらいます。

### verifier
`hikitsugi:verifier` に次を依頼します。
> `hikitsugi-work/survey.json`、`hikitsugi-work/transcript.json`、`hikitsugi-work/library.json`、`hikitsugi-work/edited-<round>.json`、`hikitsugi-work/verify-scope-<round>.json`、`hikitsugi-work/state.json` を読み、`state.json` の `retiree` を退職する担当者として、`verify-scope-<round>.json` にある ID の記述を、`edited-<round>.json` の `statements` から探して検証し、結果の JSON（`results`）を `hikitsugi-work/verification-<round>.json` に保存してください。

終わったら `hikitsugi check-verification <round>` を実行します。不合格なら、自動で次の回の writer に戻り、指摘のあった部分だけを書き直します。差し戻しは最大2回です。

### phrases
`hikitsugi phrase-task` を実行し、`hikitsugi:phrase-writer` に次を依頼します。
> `hikitsugi-work/phrase-pages.json` を読み、結果の JSON（`pages`）を `hikitsugi-work/phrases.json` に保存してください。

終わったら `hikitsugi check-phrases` を実行します。問題が表示されたら、その内容を伝えて直してもらいます。

### figures
物に触る手順に添える絵の並べ方を決めます。絵はプログラムが、承認済みの部品から組み立てます。

1. `hikitsugi figure-task` を実行します。候補が 0 件なら、`figures.json` に `{"figures": []}` を保存して 3 に進みます。
2. `hikitsugi:figure-planner` に次を依頼します。
   > `hikitsugi-work/figure-steps.json` を読み、結果の JSON（`figures`）を `hikitsugi-work/figures.json` に保存してください。
3. `hikitsugi check-figures` を実行します。検査に通らなかった絵は付きません。表示された件数を伝えます。

### dead-end
連絡の相手か手段が分からないページ（行き止まり）を、確認の前に前任者に聞きます。`status` の `page`、`title`、`reasons`、`left` を使います。

1. 質問は「このページは行き止まりです。誰に、どうやって連絡しますか」です。ページの題名と `reasons` を添え、残りのページ数も伝えます。退職する本人を相手にしないよう、お願いします。聞き方は `ask` に従います。
   - `ask` が `choices` なら、AskUserQuestion で聞きます。選択肢は `choices` の `label` と `description` をそのまま使い、足しも減らしもしません。ふつうの回答は下の欄に入力してもらいます。
   - `ask` が `text` なら、AskUserQuestion は使いません（選択肢が1つでは出せないため）。文章で聞き、「分からなければ『分からない』と返してください」と添えます。
2. 答えがあれば、本人の言葉のまま（前と同じなら `same_answer` を）標準入力で渡します。
   ```
   hikitsugi dead-end-answer <page> <<'EOF_ANSWER'
   （誰に、どうやって）
   EOF_ANSWER
   ```
3. 「分からない」なら `hikitsugi dead-end-unknown <page>` を実行します。プログラムが定型の文（「連絡先の記録がありません。〈社内の最初の相談先〉に聞いてください」など）を載せます。

全ページを聞き終えると、答えのあったページだけを書き直して照合します。連絡の手段を聞いた相手は、連絡先の欄にも答えが入ります。`status` の段階に従います。1ページに聞くのは1回だけです。

### page-gap
電源を抜く、ケーブルを抜くなど、物に触る手順のあるページで、触る物の見分け方、待つ時間、直ったかの確かめ方が足りないものを、確認の前に前任者に聞きます。**全部で 3 問まで**です（`asked` と `limit`）。同じ手順のページは 1 問にまとめます（`pages`）。

1. `status` の `question` を、AskUserQuestion で聞きます。選択肢は「分からない」の 1 つだけにして、ふつうの回答は下の欄に入力してもらいます。何問目かと、残りの数（`left`）も伝えます。数字（何分、何秒）は、前任者が言ったとおりに渡し、推測で足しません。
2. 答えがあれば、本人の言葉のまま標準入力で渡します。
   ```
   hikitsugi page-gap-answer <page> <<'EOF_ANSWER'
   （置き場所と目印、待つ時間、直ったかの確かめ方）
   EOF_ANSWER
   ```
3. 「分からない」なら `hikitsugi page-gap-unknown <page>` を実行します。

聞き終えると、答えのあったページだけを書き直して照合します。答えのなかった項目は、ページに「〜は、記録がありません。」と決まった文で出ます。

### review
前任者本人に、ページごとに確認してもらいます。**全文を精読してもらう必要はありません。** 確認が終わるまで、取扱説明書には「下書き（前任者の確認前）」の帯が付き、確認の印は出ません。

1. `reviewer` が `null` のときは、`state.json` の `retiree` の名前で `hikitsugi review-start <名前>` を実行します。表示された「退職前にやること」は、本人にしかできない作業の一覧です。後任向けの取扱説明書には載らないので、そのまま本人に見せます。あとで見るときは `hikitsugi before-leaving` です。続けて `hikitsugi render` を実行し、下書きの「ITの取扱説明書（PC 用）manual.html」の場所を伝えます。
2. `status` の `page` について `hikitsugi review-show <page>` を実行し、表示された内容を、省略も要約もせずに見せます。「社員に返す文」も全文を見せます。
3. AskUserQuestion で聞きます。選択肢は「このままでよい」と「直す」の2つです。何ページ目かも伝えます。
4. 「このままでよい」なら `hikitsugi review-ok <page>` を実行します。`review-show` に【絵】の行があるページでは、選択肢に「絵を外す」を足します（3 つ）。「絵を外す」なら、どの手順の絵かを聞いて `hikitsugi review-figure-off <文章の ID>` を実行し、同じページをもう一度見せます。
5. 「直す」なら、直す内容を一言で聞いて、本人の言葉のまま標準入力で渡します。
   ```
   hikitsugi review-fix <page> <<'EOF_ANSWER'
   （直す内容）
   EOF_ANSWER
   ```
   この内容は聞き取りの記録になり、そのページだけを書き直して検証し直します。`status` の段階に従います。合格すると、同じページの確認に戻ります。

全ページが「このままでよい」になると、確認の印が付きます。

### render
`hikitsugi render` を実行し、できた「ITの取扱説明書（PC 用）manual.html」のパスと、隣の「ITの取扱説明書（スマホ用）」フォルダの場所を伝えます。最後の要約の行をそのまま伝えます。未承認の手順部品があると表示されたら、取扱説明書は作れません。そのまま本人に伝えて止まります。「PC では「ITの取扱説明書（PC 用）manual.html」を開きます。スマホでは、「ITの取扱説明書（スマホ用）」フォルダごと会社の OneDrive に置くと、フォルダの一覧を目次にして症状のファイルを開けます」と案内します。

### not_passed
差し戻しの上限に達しました。更新の途中なら、内容を伝えて `hikitsugi update-cancel` で前の説明書に戻します。それ以外では、取扱説明書は作りません。`findings-<round>.json` の指摘を、IT の知識がなくても分かる言葉で伝え、追加で確認できることがないか相談します。

### update
取扱説明書はすでに完成しています。更新を受け付けます。**変わった文は Verifier の照合を通し、更新する人が確認します。**

1. この会話でまだ聞いていなければ、最初に「あなたの名前（確認した人として記録します）」を聞いて、`hikitsugi update-start <名前>` を実行します。担当が代わることがあるので、`updater` に名前があっても毎回聞きます。名前を聞く前に、前回の更新や更新した人のことを伝えません（`updater` は更新の記録ではなく、`null` でも記録がないとは限りません）。`from_bundle` が `true` のときは、隣の `manual.json` から作業フォルダを作り直します。
   `update-start` が表示した行を、言い換えず、要約せずに、そのまま伝えます。前回の更新は、プログラムが出した「直近の更新」の行だけで伝え、自分の言葉で説明しません。記録がないことは、プログラムが「更新の記録はまだありません」の行を出したときだけ伝えます。「作り直しの検査から除いた根拠」の行があれば、それもそのまま伝えます。「記録します」の行（この PC のアカウント名と PC 名）は記録で、本人確認ではありません。アカウント名と PC 名は、PC 用と印刷の「更新の記録」に出ます（スマホ用には出ません）。説明書（PC 用、スマホ用、`manual.json`）は、会社のアカウントの OneDrive に置くよう勧めます。版の履歴に、いつ、誰が変えたかが残ります。「注意：」の行があれば、その行を見せて、AskUserQuestion で続けるかを聞きます。選択肢は「続ける」と「やめる」の2つです。「やめる」なら、ここで終えます。
2. `output_dir` が `null` なら、取扱説明書を置いているフォルダ（OneDrive など）を1回だけ聞いて `hikitsugi update-output <フォルダ>` を実行します。以後はそこへ直接書きます。
3. `memo_left` が1以上なら、手順 5 の「後任のメモから取り込む」の続きから始めます。
4. AskUserQuestion で聞きます。選択肢は「連絡先・機器・作業」「症状を足す」「手順を直す」「メモ・担当の引き継ぎ」の4つです。「連絡先・機器・作業」の説明は「連絡先、機器、決まった作業を、直すか足す」、「メモ・担当の引き継ぎ」の説明は「後任のメモを取り込むか、担当が代わったときの引き継ぎ」です。
5. 選択肢ごとに進めます。`hikitsugi update-targets` が、ページ（`pages`）、連絡先（`contacts`）、機器（`devices`）の一覧を返します。
   - **連絡先・機器・作業：** 続けて AskUserQuestion で聞きます。選択肢は「直す」「連絡先を足す」「機器・ソフトを足す」「決まった作業を足す」の4つです。「直す」なら、`update-targets` の `contacts`、`devices`、`routines` を 1 つの一覧で見せ、どれを直すかを聞きます。
   - **メモ・担当の引き継ぎ：** 続けて AskUserQuestion で聞きます。選択肢は「後任のメモから取り込む」「担当を引き継ぐ」の2つです。
   - **決まった作業を足す：** 間隔を AskUserQuestion で聞きます。選択肢は「毎週」「毎月」「毎年」「決まった間隔ではない」です。「決まった間隔ではない」なら、作業にせず「症状を足す」か「手順を直す」を案内します。続けて、作業の名前、やり方、終わったことを何で確かめるか、だれがしているか（毎年なら何月か）を 1 回でまとめて聞き、`hikitsugi update-add-routine <weekly|monthly|yearly>` に標準入力で渡します。
   - **担当を引き継ぐ：** 去る人（`update-targets` を見る前の、今の担当の候補）と新しい担当の名前を聞き、`hikitsugi takeover-start <去る人> → <新しい担当>` を実行します。表示された「直すまで完了しないもの」を、ふつうの更新（連絡先を直す、手順を直す、決まった作業を直す）で 1 件ずつ直します。「1 件ずつ確かめるもの」は、文を見せて「このままでよい」か「直す」を聞き、このままなら `hikitsugi takeover-ok <文章の ID>` を実行します。全部終わったら `hikitsugi takeover-finish` を実行します。残りがあれば、何が残っているかが表示されるので、それを直します。途中の様子は `hikitsugi takeover-status` で見られます
   - **連絡先・機器・決まった作業を直す、手順を直す：** どれを直すかを聞きます（連絡先は `contacts`、機器は `devices`、決まった作業は `routines`、手順は `pages` から）。`hikitsugi review-show <ID>` の内容を省略せずに見せて、直す内容を一言で聞きます。本人の言葉のまま渡します。
     ```
     hikitsugi update-fix <ID> <<'EOF_ANSWER'
     （直す内容）
     EOF_ANSWER
     ```
   - **連絡先の番号：** 番号だけの更新で文が変わらないときは、照合する文がないので照合の担当は動きません。文が変わるかは実行するまで分からないので、実行前に「照合します」と言いません。`verify-scope-<round>.json` の `statements` が空なら、「文は変わらないので、番号を置き換えて確認します」と伝えます。文の中に書かれた同じ番号は、プログラムが新しい番号に置き換えて照合にかけます。番号以外（受付時間など）を直すときは、`review-show` の「この名前が出てくるほかの文」（番号や受付の話の文だけが出ます）に古い内容が残っていないかを本人に見てもらい、残っていれば「手順を直す」で直します。
   - **連絡先を足す：** AskUserQuestion で、業者か社内の相談先かを聞きます。選択肢は「業者」と「社内の相談先」の2つです。続けて、名前、電話番号、何の相手か、受付の時間や連絡の手段、契約書の控えの場所を、1回でまとめて聞きます。分からないものは「分からない」と書いてもらいます。退職する人を連絡先にしないよう、お願いします。業者なら `vendor`、社内の相談先なら `internal` を付けて、本人の言葉のまま標準入力で渡します。
     ```
     hikitsugi update-add-contact <vendor か internal> <<'EOF_ANSWER'
     （足す連絡先の内容）
     EOF_ANSWER
     ```
   - **機器を足す：** 機器の名前、置き場所（部屋の名前と、部屋の中の目印）、何に使うか、止まると何が困るか、パスワードを置いてある場所、してはいけないことを、1回でまとめて聞きます。パスワードそのものは聞きません。置いてある場所だけです。`hikitsugi update-add-device` に同じように標準入力で渡します。`check-writer` で「置き場所に部屋の名前がありません」と表示されたら、止まりませんが、そのことを本人に伝えます。
   - **症状を足す：** 症状と、そのときの対応を一言で聞きます。そのとき連絡する相手が `update-targets` の `contacts` にいなければ、先に「連絡先・機器」の「連絡先を足す」で足してから、症状を足すよう案内します。足したページの ③ は、今ある連絡先から選ばれるためです。`hikitsugi update-add` に同じように標準入力で渡します。
   - **後任のメモから取り込む：** 「メモをまとめてコピー」で写した文を貼ってもらい、`hikitsugi update-memo` に標準入力で渡します。返ってきた `next` を1件ずつ、AskUserQuestion で確認します（「取り込む」「取り込まない」）。メモは確認されていない内容です。`has_credential` が `true` のメモは、値を読み上げずに、保管場所だけを教えてもらいます。`target` が `null` のメモは、どのページのことかを聞きます。「取り込む」なら `hikitsugi update-fix <target>` に本文を渡し、終わったら `hikitsugi memo-next done` で次へ進みます。「取り込まない」なら、すぐ `memo-next done` を実行します。
6. あとは `hikitsugi status` の段階に従います。その部分だけを書き直して照合し、`review` の段階で更新する人に確認してもらいます。`review-show` に「確認：見慣れない形の番号です」の行があれば、その番号でよいかを必ず本人に確かめます。違っていれば「直す」を選んでもらいます。`hikitsugi review-ok <ID>` のあと、`render` の段階で、同じ場所の「ITの取扱説明書（PC 用）manual.html」、「ITの取扱説明書（スマホ用）」フォルダ、`manual.json` が新しくなります。
7. 伝えることは次のとおりです。更新には Claude Code が要りますが、読むだけなら要りません。

`not_passed` になった更新は、`hikitsugi update-cancel` で取り消せます。説明書は前のままです。

更新の記録（名乗った名前、アカウント名、PC 名、日付）は、`hikitsugi history` で見られます。
