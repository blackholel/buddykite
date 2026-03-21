# show-widget Phase 0 事件契约（WidgetStabilityEvent）

## 1. 目标

定义统一日志事件结构，确保 Phase 0 基线采集可量化、可追踪、可复跑。

说明：

1. 该契约是**内部可观测契约**，不是对外 API。
2. 不改变 show-widget 渲染协议，只补可观测字段。

## 2. TypeScript 契约

```ts
type WidgetStabilityEventType =
  | 'widget_ready'
  | 'widget_update_sent'
  | 'widget_finalize_sent'
  | 'widget_resize_recv'
  | 'widget_theme_sent'
  | 'widget_error_recv'
  | 'widget_link_open'

interface WidgetStabilityEvent {
  timestamp: string
  runId: string
  conversationId: string
  widgetKey: string
  instanceId: string
  seq: number
  eventType: WidgetStabilityEventType
  isPartial: boolean
  latencyMs: number
  errorCode: string | null
  meta: Record<string, unknown>
}
```

## 3. 字段约束

1. `runId`：必须是非空字符串；缺失 `runId` 的事件视为无效样本，不计入基线。
2. `conversationId`：允许 `unknown`，但建议传真实值。
3. `instanceId`：同一渲染实例唯一。
4. `seq`：同一 `instanceId` 下单调递增，从 1 开始。
5. `latencyMs`：相对该实例创建时刻的毫秒差，必须 >= 0。
6. `errorCode`：无错误时为 `null`，不可省略。

## 4. 事件语义

1. `widget_ready`：receiver 就绪，能接收更新。
2. `widget_update_sent`：streaming 阶段向 iframe 发送 update。
3. `widget_finalize_sent`：最终态发送 finalize（允许脚本执行）。
4. `widget_resize_recv`：收到高度回传事件。
5. `widget_theme_sent`：向 iframe 推送主题变量。
6. `widget_error_recv`：receiver 错误或 promise rejection。
7. `widget_link_open`：widget 内链接点击与打开行为。

## 5. 采集入口

1. 控制台日志：`[telemetry] widget_stability <JSON>`
2. 全局缓冲：`globalThis.__KITE_WIDGET_STABILITY_EVENTS__`
3. 浏览器事件：`window` 上 `kite:widget-stability` 自定义事件
4. 指标脚本：`node scripts/show-widget-phase0-report.mjs --log /path/to/widget-telemetry.log --round Round1`

## 6. 质量门槛（Phase 0）

1. 36 次执行样本中，可解析事件覆盖率 >= 98%。
2. 所有纳入统计的事件必须满足：`runId` 非空、`seq` 单调递增。
