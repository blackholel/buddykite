# show-widget 流式渲染改造交接文档（2026-03-17）

## 1. 背景与目标

本轮改造目标是让 `show-widget` 在真实流式输出中“更稳、更丝滑”，重点解决以下问题：

1. 模型输出围栏标签不稳定（`show-widget` / `SHOW-WIDGET` / `show_widget`）导致无法识别。
2. 模型偶发输出结构化 payload（如 `type + props`）而非 `widget_code`，前端只能当普通代码块显示。
3. 流式未闭合 JSON / 未闭合脚本时的可视化连续性与安全性。
4. Agent 侧路由、MCP 装配、会话复用策略与 widget 能力的联动一致性。

## 2. 本次代码改动总览

### 2.1 Agent / Session / MCP 主链路

1. 新增 widget 能力提示与 MCP server：
   - `src/main/services/agent/widget-guidelines.ts`
2. 构建 SDK 配置时按“可视化意图”动态挂载 `codepilot-widget`：
   - `src/main/services/agent/sdk-config.builder.ts`
3. `sendMessage` 增加 MCP 路由上下文输入，并注入 widget 输出约束：
   - `src/main/services/agent/message-flow.service.ts`
4. 会话重建新增 `enabledMcpServersHash` 维度，避免旧会话复用造成能力错配：
   - `src/main/services/agent/session.manager.ts`
   - `src/main/services/agent/types.ts`
5. 禁止通过 Bash 打开外部浏览器/本地 html，强制内联 widget 渲染：
   - `src/main/services/agent/renderer-comm.ts`

### 2.2 Renderer 渲染与解析链路

1. `WidgetRenderer` 流式与 finalize 状态处理补强：
   - `src/renderer/components/chat/WidgetRenderer.tsx`
2. `widget-sanitizer` 解析能力和安全处理增强（本轮重点）：
   - `src/renderer/lib/widget-sanitizer.ts`

### 2.3 测试补充与回归验证

1. 新增/更新 show-widget 相关单测：
   - `src/renderer/components/chat/__tests__/widget-system.test.ts`
   - `src/renderer/components/chat/__tests__/widget-sanitizer.parser.test.ts`
   - `tests/unit/services/agent.widget-guidelines.test.ts`
2. 关联链路测试更新（session rebuild / sdk config / resource guard）：
   - `src/main/services/agent/__tests__/session.manager.rebuild.test.ts`
   - `src/main/services/agent/__tests__/sdk-config.builder.strict-space.test.ts`
   - `src/main/services/agent/__tests__/renderer-comm.resource-guard.test.ts`

## 3. show-widget 专项改动细节（本轮新增）

以下为本轮在 `widget-sanitizer` 的关键增强：

### 3.1 围栏识别兼容（格式容错）

1. 由固定匹配 ` ```show-widget ` 扩展为正则兼容：
   - `show-widget`
   - `SHOW-WIDGET`（大小写容错）
   - `show_widget`（下划线别名）
2. 同时覆盖完整围栏解析和 streaming open fence 定位。

### 3.2 payload 归一化（schema 容错）

新增 `normalizeWidgetPayload()` 与 `parseWidgetPayload()`：

1. 若存在 `widget_code/widgetCode`：按原路径直通。
2. 若是结构化 payload（`type + props`）：
   - `table` -> 生成内联 HTML 表格 widget
   - `list` -> 生成列表 widget
   - `metric/kpi` -> 生成指标卡 widget
   - `timeline` -> 生成时间线 widget
   - 未识别类型 -> fallback（展示结构化内容）

这层归一化让“模型输出结构化 JSON”不再直接失败，而是先转换成可渲 HTML 再喂给 `WidgetRenderer`。

### 3.3 streaming partial 兼容增强

1. `extractTruncatedWidget()` 优先尝试新归一化解析。
2. 不完整 JSON fallback 时，同时支持 `widget_code` 与 `widgetCode` 键名提取。
3. partial key 计算改为基于通用 fence 检测，避免别名/大小写导致 key 不稳定。

## 4. 实验方案与结果记录

### 实验 A：围栏格式容错

1. 输入 ` ```SHOW-WIDGET ` + `widget_code`。
2. 输入 ` ```show_widget ` + `widget_code`。
3. 预期：均可被解析为 `widget` segment，非普通 text。
4. 结果：通过（见 `widget-sanitizer.parser.test.ts` 新增用例）。

### 实验 B：结构化 payload 容错

1. 输入 ` ```show-widget ` 内部 JSON 为 `type: "table"` + `props.columns/rows`。
2. 预期：解析阶段自动转成 HTML table 的 `widgetCode`。
3. 结果：通过（见 `widget-sanitizer.parser.test.ts` 新增用例）。

### 实验 C：streaming partial + 大写围栏

1. 输入未闭合的 ` ```SHOW-WIDGET `。
2. 预期：`parseShowWidgetsForStreaming` 能输出 `isPartial=true` 的 widget segment。
3. 结果：通过（见 `widget-sanitizer.parser.test.ts` 新增用例）。

### 实验 D：回归验证（现有 widget 基线）

1. 运行现有 widget parser/system 测试集。
2. 预期：新兼容层不破坏既有 `widget_code` 路径。
3. 结果：通过（17/17，2 个测试文件）。

## 5. 借鉴来源（CodePilot 开源实现）

本轮参考了 `op7418/CodePilot` 的实现思想与工程策略（本地拉取于 `CodePilot/` 目录），主要借鉴点：

1. “单 iframe 常驻 + 双通道消息（update/finalize）”的渲染架构。
2. 流式阶段 partial 解析思路：未闭合 fence 的字符串提取与容错。
3. finalize 时减少无意义重绘、避免闪烁的 receiver 处理方式。
4. 高度同步与缓存稳定策略。

参考路径示例（来源仓库内）：

1. `CodePilot/src/components/chat/WidgetRenderer.tsx`
2. `CodePilot/src/lib/widget-sanitizer.ts`
3. `CodePilot/src/components/chat/MessageItem.tsx`
4. `CodePilot/src/components/chat/StreamingMessage.tsx`
5. `CodePilot/docs/handover/generative-ui.md`
6. `CodePilot/docs/generative-ui-article.md`

说明：上游原生协议仍以 `widget_code` 为主，本项目在此基础上新增了 `type/props -> HTML` 归一化兼容层。

## 6. 与上游差异（当前项目特有）

1. 围栏兼容：支持 `SHOW-WIDGET` 与 `show_widget`（上游默认只走 `show-widget`）。
2. payload 兼容：新增结构化 schema 自动转 HTML（上游默认不做此层归一化）。
3. Agent 层约束更强：Bash 外跳浏览器被策略拒绝，改为内联 widget 输出。
4. Session 重建引入 `enabledMcpServersHash`，避免能力切换时复用旧会话。

## 7. 当前风险与已知边界

1. 结构化 schema 兼容目前是“通用 fallback 级别”，非完整 design-system 渲染引擎。
2. 极复杂的结构化 payload 仍可能需要专门 renderer（目前会走 fallback HTML/JSON 展示）。
3. `CodePilot/` 与 `_external/` 目录已加入工作区（体量较大），后续如不需要，建议单独评估仓库体积与管理策略。

## 8. 后续优化建议（给下一位 agent）

1. 把 `normalizeWidgetPayload()` 抽到独立模块，并补充 schema 校验（如 zod）。
2. 为 `chart/kanban/gantt/heatmap` 增加更高保真 HTML renderer。
3. 在 UI 层为“结构化 fallback”增加提示徽标，便于排查模型输出质量。
4. 增加 E2E：覆盖“流式未闭合 -> 闭合 finalize -> 会话切换重载”的完整链路。
5. 若后续协议统一，可在模型提示词里强约束一种标准，减少多态兼容负担。

## 9. 本轮执行记录（简版）

1. 先读现有未提交改动，确认主线已包含 Agent+Renderer 一体化改造。
2. 定位根因：格式不稳（fence）+ schema 不稳（payload）导致渲染失败。
3. 引入兼容层并补单测（优先保证可回归）。
4. 对照上游 CodePilot 实现，确认借鉴策略与差异边界。
5. 输出本交接文档，便于后续 agent 继续迭代。

