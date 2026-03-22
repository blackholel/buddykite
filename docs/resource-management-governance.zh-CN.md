# 资源管理治理规则

本文档定义资源管理相关的长期规则，用于统一 `skills / agents / commands / plugins / MCP` 的身份、判定、状态存储、usage 和记账语义。

本文不是实施总结，不记录过程，只记录今后实现必须遵守的规则。

## 1. 目标

统一以下四件事：

1. 资源身份
2. 可见性与可执行性判定
3. 管理动作语义
4. 状态持久化与 usage 统计

目标是避免再次出现“展示一套、运行时一套、管理动作又一套”的三轨系统。

---

## 2. 资源身份模型

### 2.1 新 `resourceId`

所有可管理资源统一使用规范化 `resourceId`。

组成要素：

1. `kind`
   - `skill`
   - `agent`
   - `command`
   - `plugin`
   - `mcp`
2. `owner`
   - `core`
   - `plugin-package`
   - `mcp-config`
3. `scope`
   - `space` 资源使用 `workDirHash`
   - 插件资源使用 `pluginFullName`
   - MCP 使用 `origin + serverName`
4. `namespace`
5. `name`

要求：

1. `resourceId` 是管理层、usage、禁用状态、删除/卸载动作的唯一定位键
2. 不允许继续把旧 `type:source:namespace:name` 当成长期主键

### 2.2 旧 ID 兼容映射

现有项目中仍存在旧 ID 体系，例如：

`type:source:namespace:name`

治理规则：

1. 新主键上线时必须提供兼容映射层
2. 兼容层必须支持：
   - `legacyId -> resourceId`
   - `resourceId -> legacy match fields`
3. 旧配置读取阶段允许旧 ID 进入
4. 新写入一律落新 `resourceId`
5. 旧缓存淘汰时应按新主键重建，不做无界双写

### 2.3 `installed` 与 `plugin` canonical 规则

治理口径统一为：

1. `installed` 在新主键层 canonical 为插件资源
2. 旧 source 枚举可在底层暂时保留
3. 管理层、usage、状态存储层不得把 `installed` 和 `plugin` 当成两类长期独立身份

---

## 3. 判定优先级

资源的“可见、可管、可执行”必须由统一判定层给出结论，不允许调用方各自拼判断。

### 3.1 判定顺序

固定顺序如下：

1. 资源是否存在且来源有效
2. 所属插件是否启用
3. MCP server 是否启用
4. 当前 space 是否禁用该资源
5. exposure 是否允许
6. legacy/internal 是否显式放行

### 3.2 真值表口径

| 判定项 | 结果 | 说明 |
|---|---|---|
| 资源不存在 | 直接阻断 | 不进入后续判定 |
| 插件禁用 | 阻断 | 插件子资源与 plugin MCP 同步失效 |
| MCP 禁用 | 阻断 | 仅对对应 MCP server 生效 |
| Space 禁用 | 阻断 | 即使资源存在且 exposure 为 public 也不可执行 |
| exposure 阻断 | 阻断 | 影响展示与直接调用 |
| legacy/internal 放行 | 可执行 | 仅允许显式兼容场景 |

### 3.3 reason code 对照表

统一使用以下 reason code：

1. `NOT_FOUND`
2. `PLUGIN_DISABLED`
3. `MCP_DISABLED`
4. `SPACE_DISABLED`
5. `EXPOSURE_BLOCKED`
6. `LEGACY_POLICY_BLOCKED`

要求：

1. UI 与 runtime 共享同一套 reason code
2. 被拦截时必须返回明确 reason code 与对应可读解释
3. 不允许静默降级

---

## 4. per-space 状态存储规则

### 4.1 存储位置

按 Space 禁用状态统一写入：

`{workDir}/.kite/space-config.json`

建议结构：

```json
{
  "resourceStates": {
    "disabledResources": {
      "resource:<...>": true
    }
  }
}
```

要求：

1. 不新增独立 state 文件
2. 继续复用既有 `space-config` 读写入口
3. 旧配置缺字段时按空状态处理

### 4.2 并发写策略

`space-config.json` 写入必须采用 `CAS + 重试`。

要求：

1. 读取当前配置与版本信息
2. 写入前校验 `mtime` 或等价版本字段
3. 发现冲突时重读并重试
4. 重试次数耗尽后返回明确错误

禁止继续使用无保护的裸 `read-modify-write`。

---

## 5. runtime 开关规则

### 5.1 默认行为

治理口径：

1. runtime 默认启用新限制行为
2. directive expansion 默认尊重：
   - plugin enabled
   - MCP enabled
   - Space disabled
   - exposure

### 5.2 `kill switch`

必须保留全局 `kill switch`。

用途：

1. 当 runtime 新行为触发线上回归时，快速切回旧行为
2. 不依赖回滚整包代码

触发场景：

1. 大面积 directive expansion 失败
2. 资源解析范围被意外收窄
3. 线上出现高频误拦截

要求：

1. `kill switch` 必须是 config 或 env 级别开关
2. 必须能在运行时快速生效
3. 旧行为只作为兜底，不作为长期默认路径

---

## 6. usage 规则

### 6.1 记录结构

usage 采用 `JSONL + snapshot`：

1. `append-only JSONL ledger`
2. `snapshot`

账本路径：

`~/.kite/analytics/resource-usage.jsonl`

### 6.2 `eventId`

usage 去重优先使用统一 `eventId`。

规则：

1. 在 runtime 成功事件生成点统一生成 `eventId`
2. `eventId` 作为 usage 去重主键
3. `opId` 只作辅助字段，不能单独承担唯一性

### 6.3 统计原则

1. 只在真实成功后记 usage
2. plugin 不单独记 usage，由子资源聚合
3. 管理页默认读 snapshot
4. ledger 损坏行跳过
5. snapshot 丢失时可从 ledger 重建

---

## 7. 插件生命周期规则

### 7.1 disable 规则

插件 disable 后：

1. 插件子资源不可执行
2. plugin MCP 不可用
3. 管理页状态同步变化

### 7.2 uninstall 规则

插件 uninstall 是多步骤副作用，必须由统一生命周期服务执行。
治理口径直接定义为 `journal + rollback` 模型。

必须触达：

1. 插件目录
2. `installed_plugins.json`
3. `settings.json.enabledPlugins`
4. plugin MCP cache
5. 资源缓存与索引缓存

### 7.3 `prepare / apply / commit / rollback`

插件卸载必须按阶段执行：

1. `prepare`
   - 校验路径与当前状态
   - 记录 journal
2. `apply`
   - 执行卸载动作
3. `commit`
   - 落最终状态并清理 journal
4. `rollback`
   - 失败时尽量恢复一致状态

禁止使用“最佳努力删一半算一半”的卸载语义。

### 7.4 `stale` 清理

以下情况视为 `stale`：

1. registry 残留但目录缺失
2. 设置残留但插件主体已不存在

治理要求：

1. UI 显示 `stale`
2. 允许清理残留状态
3. 清理动作不等价于完整 uninstall

---

## 8. UI 语义规则

统一管理页顶层分组固定为：

1. `All`
2. `Core`
3. `Plugins`
4. `MCP`

其中：

1. `Core` 下保留 `Skills / Agents / Commands`
2. `Plugins` 展示插件卡片及子资源
3. `MCP` 展示全部 global / space / plugin server

动作显隐规则：

1. `space skill / agent / command`
   - 可显示 `Delete`
2. `app / global / plugin` 子资源
   - 只能 `Disable / Enable`
   - 不显示物理删除
3. `plugin`
   - 可显示 `Disable / Enable`
   - 可显示 `Uninstall`
4. `global / space MCP`
   - 可 `Disable / Enable`
   - 对配置来源可 `Delete`
5. `plugin MCP`
   - 不单独物理删除
   - 跟随插件状态变化

---

## 9. 参见

1. [资源管理方案 B 终版](./plans/2026-03-22-resource-management-plan-b-final.md)
2. [资源可见性与调用控制指南](./resource-exposure-control.zh-CN.md)
3. [插件加载与安装配置说明](./plugin-loading-and-installation.zh-CN.md)
