# ReadME_WORD

このファイルは、Word 変換（DOCX）でハマりやすいポイントを、初心者向けにまとめたメモです。

対象読者:

- DOCX の内部をまだ触ったことがない人
- 「Wordで開けない」「画像が出ない」を自力で切り分けたい人

## 1. まず知っておくこと（超重要）

DOCX は「1つのファイル」に見えますが、中身は **ZIP + XML の集合** です。

- 拡張子 `.docx` を `.zip` に変える
- 展開すると `word/document.xml` などが見える
- Word はこの XML のルール（OOXML）をかなり厳密に見ている

つまり、見た目が少し壊れているというより、**XMLルール違反が1つでもあると開けない** ことがあります。

### 1-1. ざっくり構造図

```text
sample.docx
├─ [Content_Types].xml
├─ _rels/.rels
└─ word/
  ├─ document.xml                ← 本文
  ├─ _rels/document.xml.rels     ← 本文から画像等への参照
  ├─ styles.xml
  ├─ numbering.xml
  └─ media/
    ├─ image-xxx.png
    └─ ...
```

### 1-2. よく出る用語

- OOXML: Word内部XMLの仕様
- rId: 参照ID（画像やヘッダーへのリンクキー）
- twip: Wordの長さ単位（1/20 pt）
- sectPr: セクション設定（用紙サイズや余白）
- tblGrid: 表の列幅定義

## 2. DOCX の最小イメージ

主に見る場所は以下です。

- `[Content_Types].xml`
  - どの種類のパーツが入っているか
- `word/document.xml`
  - 本文（段落、表、画像、ページ設定）
- `word/_rels/document.xml.rels`
  - 本文から画像などへの参照先（rId）
- `word/media/*`
  - 実際の画像ファイル

### 参照の流れ（画像）

1. `document.xml` の `<a:blip r:embed="rId10"/>`
2. `document.xml.rels` の `Id="rId10" Target="media/image-xxx.png"`
3. `word/media/image-xxx.png` が実在

この3点セットが揃って初めて画像が表示されます。

### 2-1. 実際の最小サンプル（イメージ）

`document.xml` 側:

```xml
<w:drawing>
  <wp:inline>
    <a:graphic>
      <a:graphicData>
        <pic:blipFill>
          <a:blip r:embed="rId10"/>
        </pic:blipFill>
      </a:graphicData>
    </a:graphic>
  </wp:inline>
</w:drawing>
```

`document.xml.rels` 側:

```xml
<Relationship
  Id="rId10"
  Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
  Target="media/image-abc.png"/>
```

これで `word/media/image-abc.png` が存在すれば表示されます。

## 3. 今回工夫したこと（今回の修正実績）

このリポジトリでは、以下を対策しました。

1. Mermaid 画像のサイズ指定を安定化
- `max-width` ではなく `width` を明示して `wp:extent` の欠損を防止

2. テーブルの `tblGrid` 二重生成を防止
- `<thead>/<tbody>/<tfoot>` を除去して、OOXML違反を回避

3. `w:gridCol w:w` の小数値を整数化
- `ST_TwipsMeasure` は整数前提のため、丸め込みを実施

4. `w:pgMar` の `undefined` 混入を防止
- `header/footer/gutter` の既定値を必ず設定

5. `w:sectPr` を `w:body` の最後へ移動
- OOXML仕様上、`sectPr` は本文末尾にある必要があるため

6. figure画像の取り込みを強化
- `<figure><img>` と `<figure><p><img></p>` の両方に対応

7. 外部画像URLで変換全体が落ちる問題を回避
- 取得失敗時に空srcにせず、透明1x1 PNGへ置換

### 3-1. なぜこの対策が必要だったか（初心者向け補足）

1. `max-width` 問題
- ライブラリが `width` は読むが `max-width` は寸法計算に使わないケースがある
- 結果として画像サイズ `cx/cy` が欠け、Word側で不正扱いになり得る

2. `<thead>/<tbody>` 問題
- HTMLとしては普通でも、変換器の実装によっては `tblGrid` を複数回出力してしまう
- OOXMLは要素順序に厳しいので開封エラー要因になる

3. 小数幅問題
- OOXML属性の中には整数専用がある
- 見た目上は同じでも、`1352.75` のような値は仕様違反

4. `undefined` 問題
- JavaScriptの `undefined` が文字列としてXMLに出ると即不正
- 余白設定は未指定でも必ず数値を入れるのが安全

5. `sectPr` の位置問題
- `w:body` 直下の `w:sectPr` は末尾である必要がある
- 先頭にあると Word が厳密チェックで落とす場合がある

6. figure 画像問題
- Markdown→HTMLの段階で `<figure><p><img...` になることがある
- 単純に `<figure><img...` だけ対応だと取りこぼしが出る

7. 外部URL問題
- 外部画像のダウンロード失敗で変換全体が止まる実装がある
- 「空src」はさらに別の例外を誘発するので、最低限 valid な data URI に置換

## 4. よく壊れるポイント（初心者向けチェックリスト）

### 画像が表示されない

- `word/media` に画像ファイルがあるか
- `document.xml.rels` に該当 `rId` があるか
- `document.xml` の `r:embed` がその `rId` を指しているか
- `wp:extent` に `cx/cy` が入っているか

追加チェック:

- 画像が何枚ある想定か（本文）と `word/media` の件数が近いか
- `descr`（alt相当）が期待したものか（図の識別に有効）
- 外部URL画像がある場合、置換処理の結果が有効な data URI になっているか

### Wordで「開けません」

- `w:sectPr` が `w:body` の最後か
- 属性値に `undefined` が混ざっていないか
- 数値属性に小数が混ざっていないか（必要なら整数化）

追加チェック:

- XML内に制御文字が混ざっていないか
- 参照先ファイル（rels→media）が欠けていないか
- 表関連要素（`tbl`, `tblGrid`, `tr`, `tc`）の順序が崩れていないか

### テーブルが崩れる

- `tblGrid` が不正な位置・重複になっていないか
- 横線が必要なら `insideH` が生成される設定か確認

補足:

- 外枠だけ出て内側線が出ないことがある（変換器依存）
- その場合は `td` ごとの border 指定か、ライブラリ側の border生成ロジックを確認

## 5. このプロジェクトで見るべきファイル

- 変換スクリプト
  - `.tools/scripts/convert/build_word.mjs`
- DSL 変換（figure/table など）
  - `.tools/scripts/convert/dsl.mjs`
- 変換ライブラリ（必要時のみ直接調整）
  - `.tools/node_modules/html-to-docx/dist/html-to-docx.umd.js`

### 5-1. どこを触るべきかの目安

- まず触る: `build_word.mjs`
  - 入力HTMLの整形、画像置換、最終post-processを管理
- 次に触る: `dsl.mjs`
  - figure/table など独自記法のHTML化
- 最後の手段: `html-to-docx.umd.js`
  - 依存更新で上書きされるため、パッチ箇所を必ず記録

## 6. デバッグの基本手順

1. まず変換する
2. 生成 `.docx` を `.zip` にして展開
3. `document.xml` と `document.xml.rels` を確認
4. 画像は `media` 実体と `rId` 参照を突き合わせる
5. 最後に Word で開いて実確認

### 6-1. 実運用で使える切り分け順（推奨）

1. 変換が途中で落ちるか
- 落ちるなら JavaScript 例外を先に潰す（XML以前の問題）

2. 変換は成功するが Word で開けないか
- `document.xml` の仕様違反（要素順序・属性値型）を疑う

3. 開けるが画像だけ出ないか
- `drawing` / `rId` / `rels` / `media` の4点照合

4. 開けるが表の見た目が違うか
- 変換器の仕様差分（border/insideH）を疑う

### 6-2. 1件ずつ直す理由

Wordのエラーは「最初の違反」しか見えていないことが多いです。
1つ直すと次の違反が見える、という段階的デバッグになるのが普通です。

## 7. 代表的な失敗例と直し方

### 失敗例A: `w:pgMar` に `undefined`

症状:

```xml
<w:pgMar ... w:header="undefined" w:footer="undefined"/>
```

対策:

- 余白設定オブジェクトに `header/footer/gutter` を必ず数値で設定

### 失敗例B: `w:gridCol w:w` が小数

症状:

```xml
<w:gridCol w:w="1352.75"/>
```

対策:

- 出力直前に丸め込み（整数化）

### 失敗例C: `sectPr` が先頭

症状:

- `w:body` の先頭に `w:sectPr` があり、本文がその後ろ

対策:

- `w:sectPr` を `</w:body>` 直前へ移動

### 失敗例D: 外部画像で変換クラッシュ

症状:

- 変換時に image download/base64 まわりで例外

対策:

- 外部URLをそのまま処理しない
- 取得不可時は安全なプレースホルダーへ置換

## 8. 補足

- `sample.docx` が開きっぱなしだと上書き時に `EBUSY` になります
- 変換前に Word で対象ファイルを閉じるのが安全です

### 8-1. 依存ライブラリを直接修正したときの注意

- `node_modules` の修正は再インストールで消える
- 「どこを・なぜ直したか」をこのREADMEに残す
- 可能なら将来的に `build_word.mjs` 側の post-process へ寄せる

---

必要なら次に、
- 「図解付き版（もう少しやさしい版）」
- 「障害時の切り分けフローチャート版」
を追加できます。
