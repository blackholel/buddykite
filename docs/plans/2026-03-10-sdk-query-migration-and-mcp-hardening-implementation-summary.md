# 2026-03-10：SDK `query()` 迁移与 MCP 稳定性加固实施总结

## 1. 背景与目标

本次变更围绕以下问题展开：

1. 继续使用 `unstable_v2_createSession` 时，`settingSources/plugins` 透传不稳定，导致空间内 skills/plugins 可能为空。
2. 切换到 `query()` 后，暴露了 MCP 配置严格校验问题：当 `mcpServers` 中存在不合法条目（例如仅有 `env`、缺少 `command/url`）时，会触发：
   - `Invalid MCP configuration`
   - `Query closed before response received`

目标是：

1. 落地方案 A：升级 SDK 并迁移到 `query()` 会话适配，不依赖 patch-package。
2. 保持现有会话管理与消息流语义（复用、重建、resume fallback、mode 切换）不倒退。
3. 增强 MCP 容错，避免单个非法配置导致整条会话链路失败。

---

## 2. 变更总览（按模块）

### 2.1 依赖与补丁机制

涉及文件：

- `package.json`
- `package-lock.json`
- `patches/@anthropic-ai+claude-agent-sdk+0.2.22.patch`（删除）

关键改动：

1. `@anthropic-ai/claude-agent-sdk` 从 `0.2.22` 升级到 `0.2.72`。
2. 移除 `patch-package` 依赖与 `postinstall` 中的 `patch-package` 执行链。
3. 删除 SDK 旧补丁文件（0.2.22 patch）。

结论：SDK 侧改为“去补丁化 + 应用层适配”。

---

### 2.2 会话底层迁移：`unstable_v2_createSession` -> `query()`

涉及文件：

- `src/main/services/agent/session.manager.ts`
- `src/main/services/agent/__tests__/session.manager.rebuild.test.ts`
- `src/main/services/agent/__tests__/session.manager.mode-switch.test.ts`

关键改动：

1. 用 `query({ prompt: AsyncIterable, options })` 替代 `unstable_v2_createSession`。
2. 新增 `AsyncInputQueue`，支持持续推送多轮用户消息。
3. 新增 `createQueryBackedSession`，对齐 `V2SDKSession` 形状：
   - `send`
   - `stream`（每轮到 `result` 结束）
   - `close`
   - 可选透传：`interrupt/setModel/setPermissionMode/...`
4. 新增初始化门面 `createV2SessionFromQuery`：
   - 创建后显式等待 `initializationResult()`，确保创建期错误可被捕获。
5. 保留原会话语义：
   - `resume` 失败白名单重试
   - scope guard
   - 会话重建触发条件
   - cleanup 与 idle timeout
6. 修复 close Promise rejected 的处理，避免未处理拒绝噪音。

---

### 2.3 资源运行时策略扩展（`full-mesh`）与类型体系

涉及文件：

- `src/shared/types/claude-code.ts`
- `src/main/services/config.service.ts`
- `src/main/services/space-config.service.ts`
- `src/main/services/agent/types.ts`
- `src/main/services/skills.service.ts`
- `src/main/services/agents.service.ts`
- `src/main/services/commands.service.ts`

关键改动：

1. 新增类型：
   - `ClaudeCodeResourceRuntimePolicy = 'app-single-source' | 'legacy' | 'full-mesh'`
   - `ClaudeCodeSkillMissingPolicy = 'skip' | 'deny'`
2. 默认配置补齐：
   - `resourceRuntimePolicy: 'app-single-source'`
   - `skillMissingPolicy: 'skip'`
3. space config 支持 runtime policy 与 missing policy 覆盖。
4. skills/agents/commands 三类资源服务新增 `full-mesh` 聚合逻辑：
   - 跨 space 聚合
   - 冲突按优先级处理（当前 space > 其他 space 字典序 > global）
   - 增加冲突与聚合日志
   - 引用解析兼容全量聚合

---

### 2.4 SDK 参数构建与工具边界策略

涉及文件：

- `src/main/services/agent/sdk-config.builder.ts`
- `src/main/services/agent/renderer-comm.ts`
- `src/main/services/agent/message-flow.service.ts`

关键改动：

1. `buildSdkOptions` 增加 `resourceRuntimePolicy` 入参透传。
2. 在 `full-mesh` 下：
   - `allowedTools` 包含 `Skill`
   - 不注入 `disable-slash-commands`
3. `createCanUseTool` 支持：
   - `resourceRuntimePolicy`
   - `skillMissingPolicy`
4. 执行边界根路径在 `full-mesh` 下扩展到所有 space 的 `.claude/{skills,agents,commands}`。
5. `Skill` 工具在非 `full-mesh` 下明确拒绝，保持策略一致性。
6. `message-flow` 绑定资源索引快照，并新增 `resource_runtime_mismatch` 审计日志（非阻塞）。

---

### 2.5 MCP 兼容性修复（本轮新增）

涉及文件：

- `src/main/services/agent/sdk-config.builder.ts`
- `src/main/services/agent/session.manager.ts`
- `src/main/services/agent/__tests__/sdk-config.builder.strict-space.test.ts`
- `src/main/services/agent/__tests__/session.manager.rebuild.test.ts`

关键改动：

1. **构建阶段过滤非法 MCP**（`sdk-config.builder.ts`）：
   - 新增 `sanitizeMcpServerConfig`
   - 仅保留符合 schema 的配置：
     - `stdio`：必须有 `command`
     - `http/sse`：必须有 `url`
   - `headers/env` 仅保留 string 值
   - 非法项跳过并输出 warning
2. **会话初始化兜底重试**（`session.manager.ts`）：
   - 若初始化命中 `Invalid MCP configuration`，自动移除 `mcpServers` 重试一次。
   - 防止单个非法 MCP 让整个 query 会话中断。

---

## 3. 测试与验证

### 3.1 主要单测覆盖

1. `session.manager.rebuild.test.ts`
   - 从 mock `unstable_v2_createSession` 切换为 mock `query`
   - 覆盖 query 初始化失败、resume fallback、重建与清理等链路
   - 新增：`Invalid MCP configuration` 自动去掉 `mcpServers` 后重试成功
2. `session.manager.mode-switch.test.ts`
   - 切换到 query mock，验证 mode 切换行为未回归
3. `sdk-config.builder.strict-space.test.ts`
   - 新增 MCP schema 过滤用例
   - 验证 full-mesh 行为（`Skill` tool/extraArgs/聚合）
4. `renderer-comm.resource-guard.test.ts`
   - 新增 runtime policy 相关用例（full-mesh 与非 full-mesh 的 Skill 行为差异）

### 3.2 执行结果

执行命令：

```bash
npm run test:unit -- src/main/services/agent/__tests__/session.manager.rebuild.test.ts src/main/services/agent/__tests__/session.manager.mode-switch.test.ts src/main/services/agent/__tests__/sdk-config.builder.strict-space.test.ts
```

结果：

- 3 个测试文件
- 42 个测试全部通过

---

## 4. 已解决的问题

1. 空间会话中 skills/plugins 为空（通过 `query()` 路径正确透传 options，规避旧路径问题）。
2. 非法 MCP 配置导致会话直接中断（构建过滤 + 初始化降级重试）。
3. 资源策略与工具权限语义不一致（通过 runtime policy 贯通构建层、执行层与审计层）。

---

## 5. 风险与注意事项

1. 若业务强依赖某个 MCP server，且其配置长期非法，当前会触发“去 MCP 重试”并继续执行，功能上会降级但不中断。
2. 为避免隐式降级，建议后续在设置页增加 MCP 配置即时校验提示（前置失败）。
3. 本次改动面覆盖会话管理、资源聚合与工具权限，建议后续再补一轮端到端回归：
   - 同一 space / 新会话
   - `zh-CN` 与默认语言
   - 启用/禁用 MCP 对比

---

## 6. 回滚说明

若需回滚到迁移前：

1. SDK 回退到 `0.2.22` 并恢复 lockfile。
2. 恢复 `postinstall` 中 `patch-package`（若要回到 patch 方案）。
3. 回退 `session.manager.ts` 的 query 适配实现到旧会话实现。

不建议回滚：会重新引入 skills/plugins 透传不稳定问题与补丁维护成本。

