<!-- Generated from sample.docx by build_from_word.mjs -->

# 1\. 変換機能サンプル

本ドキュメントは **Markdown → HTML / PDF 変換機能** の全要素をひとつのファイルで確認するためのサンプルです。

# 2\. 見出しの自動番号

見出しには自動で番号が付与されます（style.json の heading.numbering で制御）。

## 2.1. サブセクション

### 2.1.1. さらに深いセクション

本文テキストです。inline code もこのように表示されます。

単一改行はスペース扱いになります（段落は変わらない）。 この行は上の行と同じ段落です。

行末に \\ で改行できます。  
ここから新しい行になります。

行末に半角スペース2つでも同じ効果です。  
ここから新しい行になります。

空行を挟むと段落が分かれます。

# 3\. 基本テキスト要素

## 3.1. リスト

-   箇条書き1
-   箇条書き2
    -   ネスト1
    -   ネスト2
-   箇条書き3

## 3.2. 番号付きリスト

1.  手順1
2.  手順2
3.  手順3

## 3.3. 引用

これは引用テキストです。 複数行にまたがることもできます。

## 3.4. 区切り線

## 3.5. リンクと強調

**太字テキスト**、斜体テキスト、打ち消し線

# 4\. コードブロック

インライン: const x = 42;

ブロック:

// JavaScriptのサンプル

function greet(name) {

return \`Hello, ${name}!\`;

}

console.log(greet("World"));

\# シェルコマンド

node .tools/scripts/convert/build.mjs input.md

# 5\. Mermaidグラフ

図番号・キャプションを付ける場合は、:::figure で Mermaid ブロック全体を囲みます。

## 5.1. フローチャート（図番号・キャプション付き）

![](assets/sample_reverse_2/sample_reverse_img_001.png)

図5.1 Markdown変換パイプラインのフローチャート

## 5.2. シーケンス図（図番号・キャプション付き）

![](assets/sample_reverse_2/sample_reverse_img_002.png)

図5.2 ログイン処理のシーケンス図

## 5.3. キャプションなし（図番号のみ）

![](assets/sample_reverse_2/sample_reverse_img_003.png)

# 6\. テーブル（標準Markdown）

| ID | 名前 | 役割 | ステータス |
| --- | --- | --- | --- |
| 001 | 山田太郎 | 管理者 | 有効 |
| 002 | 鈴木花子 | 一般ユーザー | 有効 |
| 003 | 田中一郎 | 閲覧者 | 無効 |

# 7\. 図表参照（id + ref）

本文中で図表番号を固定文字で書かずに、ref記法で参照できます。

表は 表7.1 に示す通りです。図は 図7.1 の通りです。

参照ID付きユーザー一覧

| ID | 名前 | 区分 |
| --- | --- | --- |
| 101 | 佐藤花子 | A |
| 102 | 高橋次郎 | B |

![](assets/sample_reverse_2/sample_reverse_img_004.png)

図5.3 参照ID付きの概要図

# 8\. 独自DSL ブロック

以下は 000\_schema/convert/dsl.json で定義されたブロックです。

## 8.1. warning（警告）

デフォルト（style.json の warningMaxWidth が適用される）:

この操作は元に戻せません。実行前に必ずバックアップを取得してください。

幅を指定する場合は width= 属性で上書き可能。style.json の設定値:

-   warningMaxWidth — 最大幅（デフォルト 100%）
-   colors.warningBg — 背景色
-   colors.warningBorder — 左ボーダー色
-   spacing 系は dsl.json の padding / margin で直接調整

幅 60% 指定:

幅を 60% に絞ったwarningブロックです。

幅 40em 指定:

固定幅（40em）のwarningブロックです。短いテキストでも枠が広がりすぎません。

## 8.2. center（中央揃え）

**中央に配置されたテキストです**

## 8.3. right（右寄せ）

作成日：2026年5月17日

## 8.4. large（大きい文字）

重要なお知らせ

## 8.5. red（赤文字）

**エラー：** 接続がタイムアウトしました。

## 8.6. figure（図 — internal起点・デフォルトサイズ）

assetsInternal を指定すると、そのフォルダを起点に相対パスを解決します。

![](assets/sample_reverse_2/sample_reverse_img_005.png)

図6.1 システム構成の概要図

## 8.7. figure（図 — internal起点・幅指定）

![](assets/sample_reverse_2/sample_reverse_img_006.png)

図6.2 幅を60%に指定した図

ピクセル指定も可能です。

![](assets/sample_reverse_2/sample_reverse_img_007.png)

図6.3 400×300px 指定の図

## 8.8. figure（図 — 基準パス未指定時）

assetsInternal を省略した場合は、変換する Markdown ファイルの配置フォルダを起点に相対パスを解決します。

## 8.9. figure（図 — 配置指定）

align= 属性で図の水平配置を指定できます。省略時は center（中央揃え）です。

左揃え：

![](assets/sample_reverse_2/sample_reverse_img_008.png)

図6.4 左揃えで表示した図

中央揃え（デフォルト）：

![](assets/sample_reverse_2/sample_reverse_img_009.png)

図6.5 中央揃えで表示した図

右揃え：

![](assets/sample_reverse_2/sample_reverse_img_010.png)

図6.6 右揃えで表示した図

## 8.10. table（キャプション付き表）

表6.1 ユーザー一覧

| ID | 名前 | 権限 |
| --- | --- | --- |
| 001 | 山田太郎 | 管理者 |
| 002 | 鈴木花子 | 一般 |

テーブルのセル内で改行するには を直接書きます。

| 項目 | 内容 |
| --- | --- |
| 対応OS | Windows<br><br><br>macOS<br><br><br>Linux |
| 備考 | 1行目<br><br><br>2行目 |

# 9\. ページ区切り

以下の行でPDF上のページが切り替わります。

# 10\. ページ区切り後のページ

ページ区切り後のコンテンツです。PDF で確認すると、このセクションが新しいページに始まります。

## 10.1. まとめ

このサンプルで確認できる要素：

| カテゴリ | 要素 |
| --- | --- |
| Markdown標準 | 見出し・リスト・表・コード・引用・区切り線 |
| 自動番号 | h1〜h3 に章番号が付く |
| DSL ブロック | warning / center / right / large / red |
| DSL 図 | figure（幅・高さ指定対応、キャプション付き） |
| 図表参照 | id付き figure/table を ref記法（ref:xxx）で参照 |
| 図パス制御 | assetsInternal 指定時はそのパス起点、未指定時は Markdown 配置フォルダ起点 |
| DSL 表 | table（キャプション付き） |
| Mermaid | flowchart / sequenceDiagram など |
| ページ制御 | pagebreak |
| PDF 設定 | page.json（用紙・余白） |
| スタイル設定 | style.json（フォント・色・スペーシング） |
