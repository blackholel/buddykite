# 2026-03-22 资源管理方案 B 终版

## 1. 文档目的

本文档用于固化本轮“统一资源管理层 + 插件/MCP 分组 + usage 感知 + 真管理动作”方案的最终版本，作为后续实施、联调、测试和回归的统一基线。

本文只记录最终拍板结果，不记录中途试探性讨论，也不展开当前脏分支中与本方案无关的大改细节。

---

## 2. 背景与当前基线

### 2.1 当前资源是怎么加载的

当前项目的资源发现和加载不是单点实现，而是分散在多条既有链路中：

1. `skills.service.ts`
   - 插件已启用资源先进入全局集合
   - 再合并 app 级资源
   - 在 kite 模式下再合并 global paths
   - 最后与当前 space 资源 merge
2. `agents.service.ts`
   - 已启用插件 agents 先进入
   - 再合并 app 级 agents
   - 再合并 global paths
   - 最后与当前 space 资源 merge
3. `commands.service.ts`
   - 已启用插件 commands 先进入
   - 再合并 app 级 commands
   - 最后与当前 space commands merge
4. `plugins.service.ts`
   - 安装态来自 `~/.kite/plugins/installed_plugins.json`
   - 启用态来自 `~/.kite/settings.json.enabledPlugins`
   - 若存在启用配置，则仅显式 `true` 的插件视为启用
5. `plugin-mcp.service.ts` 与 `sdk-config.builder.ts`
   - 负责把 plugin MCP 与全局/space MCP 配置拼装进会话运行时

结论：当前项目已经具备资源扫描、插件启用判定、MCP 拼装、Space 资源 merge 等底座，不需要为本方案重写底层发现逻辑。

### 2.2 当前展示限制与运行时绕过不一致

当前存在一个核心矛盾：

1. 展示侧已经有 resource exposure 和 toolkit 相关约束概念
2. 运行时 directive expansion 仍存在默认绕过路径
   - `bypassToolkitAllowlist: true`
   - `resourceExposureEnabled: false`

这导致外层看起来像是“有限制”，实际执行时仍可能把资源放进去，形成“展示和运行时双标”的问题。

### 2.3 当前删除/禁用能力边界

现状能力并不统一：

1. `space skill / agent / command` 已支持物理删除
2. `app / global / plugin` 子资源目前没有统一的禁用/删除能力
3. toolkit 写操作在服务端与 renderer store 中都被整体禁用
4. 插件本身有安装/启用概念，但没有统一卸载生命周期编排器
5. MCP 有 global/space 的 disable 语义，但 plugin MCP 主要跟随插件会话启用链路

结论：当前系统不是“完全不能管”，而是“能删一部分、能关一部分、还能绕过一部分”，语义非常散。

---

## 3. 本次目标

本轮目标不是继续给 `Skills / Agents / Commands` 三个列表补 UI，而是完成以下四件事：

1. 建一层统一资源管理读模型
   - 能把 `skill / agent / command / plugin / mcp` 聚合成一个可管理视图
2. 在外层把插件与 MCP 维度单独展示
   - 不再只按 `Skills / Agents / Commands` 三分法展示
3. 增加 usage 感知
   - 让用户能看到资源被成功使用了多少次
   - 便于用户判断哪些资源值得保留
4. 把管理动作做真
   - `space` 资源可物理删除
   - 非 `space` 资源可按 Space 禁用
   - 插件可禁用/卸载
   - MCP 能进统一管理视图

---

## 4. 最终方案摘要

方案 B 终版采用“双层结构”：

1. 薄编排层
   - `ResourceManagerService` 只负责聚合读模型与动作编排
2. 单一判定层
   - `ResourcePolicyService` 统一负责可见、可管、可执行判定

同时补齐四个基础机制：

1. 统一主键 `resourceId`
2. `space-config.json` 中的 per-space disabled state
3. `JSONL + snapshot` 的 usage 账本
4. `journal + rollback` 的插件卸载生命周期

最终 UI 结构固定为：

1. `All`
2. `Core`
3. `Plugins`
4. `MCP`

其中：

1. `Core` 下保留 `Skills / Agents / Commands`
2. `Plugins` 展示插件卡片与其子资源
3. `MCP` 展示全部 global / space / plugin server

---

## 5. 关键实现改动

### 5.1 统一读模型

新增 `ManagedResourceItem` 作为管理页唯一数据源，统一承载：

1. 资源身份
2. 来源
3. usage
4. 当前状态
5. 可执行动作
6. 子资源关系

不再由前端分别拼接 skills、agents、commands 三套 store 的结果。

### 5.2 统一判定层

新增统一 policy/resolution 层，负责同时服务于：

1. 外层展示
2. 管理动作显隐
3. 运行时 directive expansion

判定必须统一覆盖：

1. 插件是否启用
2. MCP 是否启用
3. 当前 space 是否禁用该资源
4. toolkit 是否允许
5. exposure 是否允许
6. legacy/internal 是否显式放行

### 5.3 `space-config.json` 状态扩展

非 `space` 资源的按 Space 禁用状态统一写入：

`/.kite/space-config.json`

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

写入要求：

1. 不新增第二个 state 文件
2. 采用 `CAS + 重试`
3. 旧配置缺字段时兼容为空状态

### 5.4 usage 采用 `JSONL + snapshot`

新增：

1. `~/.kite/analytics/resource-usage.jsonl`
2. usage snapshot

原则：

1. 只在成功后记 usage
2. 用统一 `eventId` 去重
3. 管理页默认读 snapshot
4. ledger 损坏行可跳过
5. snapshot 丢失时可重建

### 5.5 插件生命周期服务

新增 `PluginLifecycleService`，负责：

1. disable 插件
2. uninstall 插件
3. 清理 registry
4. 清理 `enabledPlugins`
5. 清理 plugin MCP cache
6. 清理资源缓存与索引缓存
7. 处理 `stale` 清理

卸载必须按 `prepare / apply / commit / rollback` 执行，不能做成“删一步算一步”的最佳努力流程。

### 5.6 `ExtensionsView` 改造

`ExtensionsView` 从“三类资源过滤页”改成“统一资源管理页”。

改造顺序要求：

1. 先完成统一读模型与分组 API
2. 再改 UI
3. 不允许前端先行临时硬拼

---

## 6. 本轮锁定决策

以下决策已经在审查过程中锁死，后续实现不再反复讨论：

1. 方案按完整版本一次做完，不拆半方案
2. 非 `space` 资源按 Space 禁用
3. usage 统计口径为全应用累计
4. `resourceId` 使用规范化稳定主键
5. 新主键上线必须带旧 ID 兼容映射层
6. `space-config.json` 写入必须使用 `CAS + 重试`
7. runtime 默认启用新限制行为
8. runtime 必须保留全局 `kill switch`
9. 插件卸载必须使用 `journal + rollback`
10. usage 必须采用 `JSONL + snapshot`
11. `ResourceManagerService` 只能是薄编排层，不能做上帝服务

---

## 7. 实施顺序

建议按以下顺序实现，避免 UI 和运行时互相踩踏：

1. 定义 `resourceId` 规范与旧 ID 映射层
2. 新增 `ResourcePolicyService`
3. 在 `space-config.json` 中落 `resourceStates.disabledResources`
4. 为 `space-config.json` 写入补上 `CAS + 重试`
5. 新增 `ResourceUsageService`
   - 先落 `eventId`
   - 再落 ledger
   - 再落 snapshot
6. 新增 `ResourceManagerService`
7. 新增 `PluginLifecycleService`
8. 暴露统一分组 API
9. 改造 `ExtensionsView`
10. 最后切 runtime 默认行为，并接入 `kill switch`

---

## 8. 测试与验收口径

### 8.1 功能验收

必须验证：

1. `All / Core / Plugins / MCP` 分组正确
2. usage 次数与最近使用时间正确
3. `space` 资源删除后磁盘与运行时同时失效
4. 非 `space` 资源在当前 space disable 后不可执行
5. 插件 disable/uninstall 后子资源与 plugin MCP 同步失效
6. MCP 管理视图与设置页保持一致

### 8.2 兼容与迁移验收

必须验证：

1. 旧 `toolkit` 与旧 ID 能被新主键兼容解析
2. `installed` 与 `plugin` 来源别名在新主键下口径一致
3. 老 `space-config.json` 无新增字段时正常运行

### 8.3 稳定性验收

必须验证：

1. `space-config.json` 多窗口并发写不丢更新
2. usage 在重复成功事件下不重复累计
3. ledger 损坏行不会拖垮整个 usage 聚合
4. 动作后 session/runtime 资源视图正确失效

### 8.4 失败与回滚验收

必须验证：

1. 插件卸载中途失败能 rollback
2. 越界路径、symlink、缺失路径删除时被正确阻止
3. `kill switch` 能在运行时快速回到旧行为

> 配套测试计划 artifact 已产出：
> `~/.gstack/projects/blackholel-hello-halo/dl-main-test-plan-20260322-083013.md`

---

## 9. NOT in Scope

本轮明确不做：

1. 不重写底层 `skills / agents / commands` 扫描器
2. 不支持插件包内单个 `skill / agent / command` 的物理删除
3. 不全仓替换旧 `source` 枚举
4. 不重做插件市场、安装器、升级流程
5. 不改 MCP 协议与连接测试实现
6. 不把 usage 升级为数据库存储

---

## 10. 风险与保留项

### 10.1 runtime 默认切新行为的回归风险

本轮仍保留一个明确风险：

1. runtime 最终默认启用新限制行为
2. 这会直接改变 directive expansion 现有行为
3. 线上一旦出现回归，必须依赖 `kill switch` 做快速回退

因此：

1. `kill switch` 不是可选项，是本方案的必要兜底
2. 运行时切换必须放到实施顺序最后一步

### 10.2 当前分支不是该方案的实现分支

当前工作分支相对 `origin/main` 已有大范围改动，但其中大量内容与本方案无关。

因此：

1. 本文档只以“当前基线可接入点 + 方案可落地性”为准
2. 不以当前脏分支 diff 大小决定本方案边界

---

## 11. 相关文档

1. [资源管理治理规则](../resource-management-governance.zh-CN.md)
2. [资源可见性与调用控制指南](../resource-exposure-control.zh-CN.md)
3. [插件加载与安装配置说明](../plugin-loading-and-installation.zh-CN.md)
