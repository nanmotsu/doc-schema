# Skills README

このフォルダには、Markdown校正向けの Copilot Skill を配置しています。

## 目的
- 作業内容に応じて適切な Skill を呼び出しやすくする
- 指摘と修正の往復を短時間で回す

## 収録 Skill
- markdown-typo-variance-check
  - Markdown の表記ゆれ・誤字脱字・用語不統一を検出
  - 仮想見出し番号つきで指摘を返す
- markdown-fix-from-findings
  - 指摘事項に基づいて Markdown 本文を最小差分で修正
  - 見出し番号のみの指摘にも対応
- markdown-pdf-convert-dsl-rules
  - Markdown->PDF 変換前提の DSL/frontmatter/参照記法ルールを適用
  - figure/table 採番、assetsBase、TOC、出力先制約の暗黙仕様に対応

## 発火の仕組み
Copilot は Skill の description を見て、ユーザー依頼との一致度が高いものを読み込みます。
そのため、依頼文に Skill の説明語を含めると発火しやすくなります。

## 見出し番号の扱い（重要）
このリポジトリでは、見出し番号は build.mjs のロジックで決まります。
Skill 側も同じ前提で扱ってください。

要点:
- h1-h3 のみ対象
- style.json の heading.levels を使用
- heading.numbering=true のときのみ採番
- 上位見出しが進んだら下位カウンタをリセット
- コードフェンス内の # は見出しとして数えない

発火しやすい語の例:
- 表記ゆれ
- 誤字
- 脱字
- 用語統一
- 指摘修正
- 見出し番号のみ
- 見出し番号非依存
- Markdown PDF変換
- DSL
- figure
- table
- ref
- assetsBase

## 発火させる依頼文の例
- markdown-typo-variance-check を使って、この docs 配下の表記ゆれと誤字を検出して。
- 見出し番号のみで来た指摘を反映したい。markdown-fix-from-findings で最小差分修正して。
- 指摘一覧を見出し番号と見出しテキストで対応付けてから修正して。
- markdown-pdf-convert-dsl-rules を使って、このMarkdownをPDF変換ルール準拠に整えて。

## 運用のコツ
1. 検出フェーズと修正フェーズを分ける
- 先に typo-variance-check で指摘一覧を確定
- 次に fix-from-findings で反映

2. 番号だけの指摘は補助情報を1つ添える
- 近傍文（前後1文）
- 対象ファイル
- 対象見出しテキスト（分かる範囲）

3. トークン節約
- 長文の丸ごと引用を避ける
- 変更箇所ごとの短い要約を使う

## 配置ルール
- Skill 本体は .github/skills/<skill-name>/SKILL.md
- name はフォルダ名と一致させる
- description に用途とキーワードを必ず含める
