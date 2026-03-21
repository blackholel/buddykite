# show-widget Phase 0 Baseline Report

> 状态：`待执行`（已完成采集框架与用例准备，待按 3 轮执行填充实测数据）

## 1. 环境信息

- 日期：2026-03-21
- 项目：`hello-halo`
- 分支/提交：`eb0e1d2`
- 系统：`Darwin 24.6.0 arm64`
- Node 版本：`v22.21.1`
- 应用版本：`待填`
- 采集契约：`docs/qa/show-widget-phase0/event-contract.md`
- 用例集：`docs/qa/show-widget-phase0/repro-cases.json`

### 1.1 指标计算脚本

```bash
node scripts/show-widget-phase0-report.mjs --log /path/to/widget-telemetry.log --round Round1
```

脚本输出 JSON，可直接拷贝到第 3 节指标表中。

## 2. 执行矩阵（3 轮 * 12 用例 = 36 次）

| Round | 执行状态 | 用例数 | 备注 |
|---|---|---:|---|
| 1 | 待执行 | 12 |  |
| 2 | 待执行 | 12 |  |
| 3 | 待执行 | 12 |  |

### 2.1 用例-RunId 明细矩阵（用于 `case_id + runId` 追踪）

| case_id | Round1 runId | Round2 runId | Round3 runId | 备注 |
|---|---|---|---|---|
| single_widget_01 |  |  |  |  |
| single_widget_02 |  |  |  |  |
| multi_widget_01 |  |  |  |  |
| multi_widget_02 |  |  |  |  |
| mixed_text_widget_01 |  |  |  |  |
| mixed_text_widget_02 |  |  |  |  |
| unclosed_fence_01 |  |  |  |  |
| unclosed_fence_02 |  |  |  |  |
| script_finalize_01 |  |  |  |  |
| script_finalize_02 |  |  |  |  |
| theme_switch_01 |  |  |  |  |
| theme_switch_02 |  |  |  |  |

## 3. 指标汇总（每轮必填 5 项）

| Round | finalize_success_rate | widget_error_rate | first_resize_success_rate | theme_sync_success_rate | flicker_incident_count |
|---|---:|---:|---:|---:|---:|
| 1 |  |  |  |  |  |
| 2 |  |  |  |  |  |
| 3 |  |  |  |  |  |
| 汇总 |  |  |  |  |  |

## 4. Top 问题样本（按影响排序）

| 排名 | case_id | runId | 症状 | 关键事件证据 | 影响级别 |
|---|---|---|---|---|---|
| 1 |  |  |  |  |  |
| 2 |  |  |  |  |  |
| 3 |  |  |  |  |  |

## 5. 进入 Phase 1 阻塞项

- [ ] 阻塞项 1：
- [ ] 阻塞项 2：
- [ ] 阻塞项 3：

## 6. 结论

- Phase 0 Gate：`待评审`
- 对应 Gate 文件：`docs/qa/show-widget-phase0/phase-gate-checklist.md`
- 下一步：按 D1-AM / D1-PM / D1-EOD 排程执行并补齐本报告数据
