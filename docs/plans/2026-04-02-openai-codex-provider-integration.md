# OpenAI Codex Provider Integration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在不影响现有 API Key 主链路的前提下，落地 `openai-codex` 实验通道（OAuth browser/device），并具备可熔断与可观测能力。

**Architecture:** 采用“双通道”策略：`openai-api` 继续作为稳定主路径，`openai-codex` 作为可开关实验路径。认证、凭据存储、刷新并发控制与请求改写解耦，先落最小可用骨架，再接入现有 `provider-resolver` 和配置流程。

**Tech Stack:** TypeScript + Electron main process services + Vitest

---

## 已落地开工骨架（当前完成）

### 新增源文件
- `src/main/services/openai-codex/types.ts`
- `src/main/services/openai-codex/credential-store.ts`
- `src/main/services/openai-codex/refresh-coordinator.ts`
- `src/main/services/openai-codex/request-adapter.ts`
- `src/main/services/openai-codex/feature-flags.ts`
- `src/main/services/openai-codex/index.ts`

### 新增测试文件
- `tests/unit/services/openai-codex-credential-store.test.ts`
- `tests/unit/services/openai-codex-refresh-coordinator.test.ts`
- `tests/unit/services/openai-codex-request-adapter.test.ts`
- `tests/unit/services/openai-codex-flags.test.ts`

### 验证命令（已通过）
Run:
```bash
npm run test:unit -- \
  tests/unit/services/openai-codex-refresh-coordinator.test.ts \
  tests/unit/services/openai-codex-request-adapter.test.ts \
  tests/unit/services/openai-codex-flags.test.ts \
  tests/unit/services/openai-codex-credential-store.test.ts
```
Expected: 4 files passed, 11 tests passed.

---

### Task 1: 接入配置开关到现有配置模型

**Files:**
- Modify: `src/main/services/config.service.ts`
- Modify: `src/shared/types/ai-profile.ts`（如需新增 preset 标识）
- Test: `tests/unit/services/config.test.ts`

**Step 1: 增加实验通道开关读取逻辑**
- 将 `PROVIDER_OPENAI_CODEX_ENABLED`、`PROVIDER_OPENAI_CODEX_EXPERIMENT`、`CODEX_KILL_SWITCH` 映射到运行态配置（可先只做 env 读取，不持久化 UI 配置）。

**Step 2: 补充配置测试**
- 覆盖默认关闭、启用、熔断优先级。

**Step 3: 验证**
Run:
```bash
npm run test:unit -- tests/unit/services/config.test.ts
```

---

### Task 2: 接入 provider-resolver 主流程（最小侵入）

**Files:**
- Modify: `src/main/services/agent/provider-resolver.ts`
- Test: `src/main/services/agent/__tests__/provider-resolver.test.ts`

**Step 1: 增加 `openai-codex` 识别分支**
- 保持原有 `openai_compat` 行为不变。
- 仅在实验开关 `active=true` 时走 codex request adapter。

**Step 2: 失败回退策略**
- `openai-codex` 认证失败（401/invalid_grant）时返回明确错误码，不静默吞错。
- 熔断开启时直接拒绝走 codex 通道。

**Step 3: 验证**
Run:
```bash
npm run test:unit -- src/main/services/agent/__tests__/provider-resolver.test.ts
```

---

### Task 3: 落 OAuth 流程服务（browser + device）

**Files:**
- Create: `src/main/services/openai-codex/oauth.service.ts`
- Create: `src/main/services/openai-codex/pkce.ts`
- Modify: `src/main/ipc/config.ts` 或新增 `src/main/ipc/auth.ts`
- Test: `tests/unit/services/openai-codex-oauth.test.ts`

**Step 1: Browser OAuth (PKCE)**
- 输出 `authorizeUrl`，本地回调端口沿用 `1455`。
- 完成 `code -> token` 交换，写入 credential store。

**Step 2: Device Auth**
- 提供 `startDeviceAuth` 和 `pollDeviceAuth`。
- 轮询拿到 token 后写入 credential store。

**Step 3: 验证**
Run:
```bash
npm run test:unit -- tests/unit/services/openai-codex-oauth.test.ts
```

---

### Task 4: 刷新策略接入请求链路

**Files:**
- Modify: `src/main/services/openai-codex/refresh-coordinator.ts`
- Modify: `src/main/services/openai-codex/request-adapter.ts`
- Create: `src/main/services/openai-codex/token-refresh.service.ts`
- Test: `tests/unit/services/openai-codex-token-refresh.test.ts`

**Step 1: 过期窗口触发刷新**
- 当 `expiresAt <= now + 120s` 触发刷新。
- 用 `OpenAICodexRefreshCoordinator` 去重并发刷新。

**Step 2: 错误分类**
- `invalid_grant` -> `markRevoked`
- 可重试错误 -> 指数退避一次

**Step 3: 验证**
Run:
```bash
npm run test:unit -- tests/unit/services/openai-codex-token-refresh.test.ts
```

---

### Task 5: 可观测与审计落地

**Files:**
- Modify: `src/main/services/observability/langfuse.service.ts`
- Create: `src/main/services/openai-codex/telemetry.ts`
- Test: `tests/unit/services/observability.langfuse.test.ts`

**Step 1: 埋点字段**
- `provider_id`, `auth_method`, `account_id`, `refresh_result`, `killed`

**Step 2: 脱敏策略**
- 禁止输出 accessToken/refreshToken/apiKey 明文。

**Step 3: 验证**
Run:
```bash
npm run test:unit -- tests/unit/services/observability.langfuse.test.ts
```

---

## 分工建议（可并行）

1. Auth 组：Task 3 + Task 4  
2. Runtime 组：Task 2  
3. 平台组：Task 1 + Task 5  

并行前提：保留 `src/main/services/openai-codex/*` 为共享写入区域，按文件 owner 分配避免冲突。

---

## 风险闸门（必须满足）

1. 默认配置下 `openai-codex` 必须关闭，不影响现有 `openai`/`anthropic` 用户。  
2. 熔断打开后，所有 codex 请求必须 100% 阻断。  
3. 凭据字段不得明文进入日志或错误堆栈。  
4. 并发刷新场景同一凭据最多执行一次 refresh 请求。  

