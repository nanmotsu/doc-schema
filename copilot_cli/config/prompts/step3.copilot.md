## 目的
要約から候補を抽出する。

## 入力
- summaryPath: {{absPath:output/step2.txt}}
- summaryContent:
{{file:output/step2.txt}}

## 出力
- candidatesPath: {{candidatesPath}}
- candidates という配列を含む JSON

## 制約
- JSONのみを返すこと
- 配列要素は文字列にすること
