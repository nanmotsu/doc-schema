# docs 配下の使い方（新構成）

## 構成

```text
docs/
├─ 00_project/
├─ 10_specs/
│  ├─ product_baseline/
│  ├─ requirements/
│  ├─ issues/
│  ├─ risks/
│  ├─ decisions/
│  └─ changes/
│     ├─ level1_tickets/
│     ├─ level2_changes/
│     └─ level3_projects/
├─ 20_tests/
│  └─ master_test_cases/
├─ 30_operations/
│  ├─ setup/
│  ├─ deploy/
│  ├─ runbook/
│  └─ manual/
├─ 40_customer_outputs/
├─ 50_meetings/
├─ 60_release/
│  └─ baseline_snapshots/
└─ 90_generated/
```

## 使い分け

- 仕様検討: `10_specs`
- 試験記録: `20_tests`
- 運用文書: `30_operations`
- 顧客提出物: `40_customer_outputs`
- 会議記録: `50_meetings`
- リリース確定情報: `60_release`

## 補足

- 文書生成スクリプトは上記構成に合わせて出力される。
- レガシー文書を移行する場合は、`90_generated` に一時退避してから整理する。
