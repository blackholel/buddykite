# 2026-03-20：show-widget 稳定性优化分阶段任务清单

## 1. 文档目的

在**不改总体方案**（仍保留 show-widget + streaming + iframe finalize 架构）的前提下，分阶段提升稳定性与可观测性，降低闪烁、错段、渲染失败与会话能力漂移问题。

---

## 2. 范围与边界

### 2.1 本次范围（In Scope）

1. 流式分段稳定性（`StreamingBubble` / `MessageList`）
2. Widget 渲染协议稳定性（`WidgetRenderer` + receiver `postMessage`）
3. show-widget 解析稳定性（`widget-sanitizer`）
4. MCP 按需启用与会话重建判定稳定性（`sdk-config.builder` / `session.manager`）
5. 测试补齐、指标补齐、灰度验收

### 2.2 非目标（Out of Scope）

1. 不更换现有 show-widget 协议格式
2. 不切换到全新渲染引擎
3. 不做 UI 视觉重设计

---

## 3. 现状基线（执行前统一口径）

1. 上游 `CodePilot` 直接相关提交：
1. `303facb00cb2be825149840865c1f4c5dbed0a1b`（2026-03-16）
2. `6a2c290640b9efdf33aa3385f8a1d43242595967`（2026-03-16）
2. `6a2c290` 之后，上游 `WidgetRenderer` / `widget-sanitizer` 暂无新提交。
3. 本仓库当前主要风险：
1. 流式切片可能错段
2. height cache key 冲突和状态污染
3. postMessage 协议校验偏弱
4. regex 解析复杂流式场景易抖
5. MCP 变更哈希只看名称，重建触发不充分

---

## 4. 分阶段总览

| 阶段 | 目标 | 建议周期 | 进入条件 | 退出条件 |
|---|---|---|---|---|
| Phase 0 | 建立稳定性基线与观测埋点骨架 | 0.5-1 天 | 任务立项 | 基线数据可复现、指标字段打通 |
| Phase 1 (P0) | 先止血：修最易导致不稳定的关键路径 | 2-4 天 | Phase 0 完成 | 核心链路无错段/无明显串扰 |
| Phase 2 (P1) | 提升鲁棒性：解析与缓存机制升级 | 4-7 天 | Phase 1 完成 | 中高复杂场景稳定通过 |
| Phase 3 (P2) | 可观测与压测闭环 | 3-5 天 | Phase 2 完成 | 有监控阈值、有压测结果 |
| Phase 4 | 灰度发布与回归固化 | 2-3 天 | Phase 3 完成 | 灰度达标并沉淀回归资产 |

---

## 5. 分阶段任务清单（可直接执行）

## Phase 0：基线与准备

### 目标

统一“什么叫稳定”，并让后续优化可量化。

### 任务清单

- [x] T0-1 建立问题复现集（最少 10 条）
  - 内容：单 widget、双 widget、混合文本、未闭合 fence、含 script、含主题切换。
  - 输出：复现脚本/输入样例清单（存放 `docs/`）。
  - 回填结果：已落地 12 条用例（6 组 * 每组 2 条），文件：`docs/qa/show-widget-phase0/repro-cases.json`。
- [ ] T0-2 记录当前基线指标（部分完成）
  - 内容：finalize 成功率、widget:error 比例、首帧高度成功率、主题同步成功率。
  - 输出：一份基线报告（执行前数据）。
  - 回填结果：已完成报告模板与采集脚本，待执行 3 轮（36 次）实测后回填数据。
  - 已完成产物：
    - `docs/qa/show-widget-phase0/baseline-report.md`
    - `scripts/show-widget-phase0-report.mjs`
- [x] T0-3 定义统一日志字段
  - 字段：`runId`, `conversationId`, `widgetKey`, `eventType`, `isPartial`, `seq`, `latencyMs`。
  - 输出：日志字段约定文档。
  - 回填结果：已定义 `WidgetStabilityEvent` 契约并接入 `WidgetRenderer` 埋点（ready/update/finalize/resize/theme/error/link）。
  - 已完成产物：
    - `docs/qa/show-widget-phase0/event-contract.md`
    - `src/renderer/lib/widget-stability-events.ts`
    - `src/renderer/components/chat/WidgetRenderer.tsx`
- [x] T0-4 建立阶段验收看板模板
  - 输出：每阶段同格式“通过/失败/待处理”检查表。
  - 回填结果：已创建 Gate 模板文件：`docs/qa/show-widget-phase0/phase-gate-checklist.md`。

### Phase 0 进展回填（2026-03-21）

1. 已完成：`T0-1`、`T0-3`、`T0-4`。
2. 部分完成：`T0-2`（模板和工具完成，Round1/2/3 实测数据待执行）。
3. 已验证测试：
   - `npm run test:unit -- src/renderer/components/chat/__tests__/widget-system.test.ts src/renderer/components/chat/__tests__/widget-sanitizer.parser.test.ts`
   - 结果：2 个测试文件，20 个用例全部通过。

### 验收标准

1. 团队能用同一批输入稳定复现问题。
2. 后续每个修复点都有对应量化指标。
3. 当前状态：尚未 Gate 通过（原因：`T0-2` 的 3 轮实测指标未回填）。

---

## Phase 1（P0）：关键路径止血

### 目标

先解决“明显不稳定”与“高概率事故”问题。

### 任务清单

- [ ] T1-1 修正流式切片基准（`MessageList`）
  - 重点：`activeSnapshotLen` 不再使用“快照总长度累加”的脆弱策略。
  - 目标：避免 tool_use 后错段、重复、抖动。
- [ ] T1-2 增加 widget 协议实例隔离（`WidgetRenderer` + receiver）
  - 重点：引入 `instanceId + seq`，只消费当前实例且递增序列消息。
  - 目标：避免跨 widget 串扰与乱序覆盖。
- [ ] T1-3 统一 URL 协议策略
  - 重点：`WidgetRenderer` 与 `widget-sanitizer` 采用同一 allowlist/denylist。
  - 目标：行为一致，减少“渲染放行/跳转拦截不一致”。
- [ ] T1-4 MCP 重建哈希增强（`session.manager`）
  - 重点：`enabledMcpServersHash` 纳入关键配置（非仅名称）。
  - 目标：该重建时一定重建，减少能力漂移。
- [ ] T1-5 回归测试补齐（最小闭环）
  - 重点：streaming -> finalize 顺序、finalize 只执行一次、height lock 生效。

### 验收标准

1. 关键复现场景（T0-1）通过率 >= 95%。
2. 50 次重复回归，0 次“错段/消失/明显串扰”。
3. finalize 成功率 >= 99%（本地回归集）。

---

## Phase 2（P1）：鲁棒性增强

### 目标

把“偶发不稳”进一步压低，提升复杂输入与边界场景稳定性。

### 任务清单

- [ ] T2-1 show-widget 解析器从 regex 启发式升级为状态机
  - 重点：感知 fence、字符串、转义、未闭合脚本边界。
  - 目标：减少 partial/text 来回切换。
- [ ] T2-2 重构 height cache 机制
  - 重点：从 `slice(0,200)` 迁移到稳定摘要 key + 有界 LRU。
  - 目标：降低 key 冲突与缓存污染。
- [ ] T2-3 key 切换时显式状态重置
  - 重点：`hasReceivedFirstHeight`、`heightLocked`、`iframeHeight` 跟随 key 变化 reset。
  - 目标：避免旧状态带入新 widget。
- [ ] T2-4 优化 widget 启用信号降噪
  - 重点：按需启用判定只看近期 user 历史，收敛关键词误触发。
  - 目标：减少不必要 MCP 注册和会话波动。
- [ ] T2-5 集成测试扩展
  - 重点：`MessageList -> WidgetRenderer` 多 widget 并发/闭环场景。

### 验收标准

1. 复杂场景（多 widget + partial + theme 切换）稳定通过率 >= 98%。
2. 200 次回归，flaky < 0.5%。

---

## Phase 3（P2）：可观测与压测闭环

### 目标

做到“可监控、可告警、可追根因”。

### 任务清单

- [ ] T3-1 指标落地
  - 指标：`ttfReady`, `ttfResize`, `partialToFinalMs`, `finalizeSuccessRate`, `widgetErrorRate`。
- [ ] T3-2 错误分类标准化
  - 分类：解析失败、协议乱序、跨实例消息、脚本执行错误、高度异常。
- [ ] T3-3 异常注入与压力测试
  - 场景：乱序消息、重复 finalize、延迟 theme、网络抖动、超长 widget_code。
- [ ] T3-4 告警阈值配置
  - 示例：`finalizeSuccessRate < 99%` 或 `widgetErrorRate > 1%` 触发告警。
- [ ] T3-5 故障演练与排障手册
  - 输出：故障定位流程（日志字段 -> 指标 -> 复现命令）。

### 验收标准

1. 500 次压力回归，flaky < 0.2%。
2. 任一异常会话可在 15 分钟内定位到模块级根因。

---

## Phase 4：灰度发布与收口

### 目标

可控上线，避免“修了本地，线上翻车”。

### 任务清单

- [ ] T4-1 灰度开关与回滚预案
  - 内容：保留开关，支持一键回到前一稳定行为。
- [ ] T4-2 分批灰度
  - 建议：内部 -> 小流量 -> 全量。
- [ ] T4-3 观察窗机制
  - 每阶段至少观察 24-48 小时核心指标。
- [ ] T4-4 发布后回归固化
  - 将本轮新增关键用例纳入固定 CI 套件。
- [ ] T4-5 复盘文档
  - 输出：问题根因、改动收益、遗留风险与下一步计划。

### 验收标准

1. 灰度期间无 P0/P1 级线上事故。
2. 核心指标达到目标并连续稳定 3 天。

---

## 6. 测试任务矩阵（建议直接抄到 issue）

### 单元测试（必做）

- [ ] U-1 `StreamingBubble` 切片正确性（多次 tool_use）
- [ ] U-2 `widget:update/finalize` 去重与顺序
- [ ] U-3 `instanceId + seq` 消息过滤
- [ ] U-4 height lock 与 cache 命中/污染
- [ ] U-5 theme 同步（MutationObserver 触发）
- [ ] U-6 sanitizer 协议一致性

### 集成测试（必做）

- [ ] I-1 未闭合 fence -> 闭合 -> finalize 全链路
- [ ] I-2 多 widget 并发流式 + 历史回放
- [ ] I-3 中途 tool_use 打断后继续输出
- [ ] I-4 会话重建（MCP 配置变化）行为正确

### 压测/混沌（建议）

- [ ] S-1 乱序消息注入
- [ ] S-2 重复 finalize 注入
- [ ] S-3 高延迟主题切换注入
- [ ] S-4 超长 widget_code 注入

---

## 7. 风险、依赖与回滚

### 主要风险

1. P0 修改消息切片逻辑，可能影响已有 streaming UI 节奏。
2. 协议收紧后，历史“宽松可用”内容可能被拦截。
3. MCP 重建条件增强可能带来会话重建频率上升。

### 关键依赖

1. 需要稳定的回归输入样例库（Phase 0 产物）。
2. 需要统一日志入口与观测平台字段接入。
3. 需要 CI 可运行新增集成测试。

### 回滚策略

1. 以阶段为单位回滚（优先回滚当前阶段改动）。
2. 协议相关改动保留 feature flag。
3. 回滚后保留日志与复现数据，避免“回滚即失忆”。

---

## 8. 执行顺序建议（最小阻塞）

1. 先做 Phase 0（基线+日志字段），当天完成。
2. Phase 1 先做 T1-1 和 T1-2，再做 T1-3/T1-4，最后补 T1-5。
3. Phase 2 按“解析器 -> 缓存 -> 启用判定 -> 集成测试”推进。
4. Phase 3 与 Phase 4 可部分并行（指标上线后即可灰度准备）。

---

## 9. Definition of Done（整体完成标准）

1. 功能稳定：核心场景连续回归无错段、无明显闪烁、无跨实例串扰。
2. 质量可证：单元+集成+压力测试达标，CI 持续通过。
3. 运维可控：有指标、有阈值、有告警、有排障手册。
4. 发布可回退：灰度策略与回滚策略经过演练验证。
