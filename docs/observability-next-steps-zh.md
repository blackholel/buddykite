# Langfuse 可观测接入后续操作文档

## 1. 当前状态

本仓库已经完成以下能力（主链路优先）：

- 主聊天链路 8 段 phase 埋点：
  - `send_entry`
  - `resolve_provider`
  - `acquire_session`
  - `expand_directives`
  - `session_send`
  - `first_token`
  - `stream_loop`
  - `finalize`
- 隐藏调试接口：
  - `GET /api/internal/observability/runs`
  - `GET /api/internal/observability/runs/:runId`
  - `POST /api/internal/observability/toggle`
- 默认脱敏：`maskMode=summary_hash`
- 观测失败不影响主流程（no-op safe）

## 2. 固定本地访问信息

当前已固定：

- 本地地址：`http://localhost:3456`
- 访问 Token：`246810`

注意：服务需要在应用启动后自动拉起（已支持 `remoteAccess.enabled=true` 时自动启动）。

## 3. 如何查看本地观测结果

先发一条聊天消息，再调用：

```bash
curl -s "http://localhost:3456/api/internal/observability/runs?limit=20&token=246810" | jq
```

查看单条 run：

```bash
curl -s "http://localhost:3456/api/internal/observability/runs/<真实runId>?token=246810" | jq
```

也可以用 Header 传 token：

```bash
curl -s -H "Authorization: Bearer 246810" \
  "http://localhost:3456/api/internal/observability/runs?limit=20" | jq
```

## 4. 字段解释（重点）

- `ttftMs`：首 token 延迟（TTFT）
- `durationMs`：整轮总耗时
- `phaseDurationsMs`：各阶段耗时拆分
- `tokenUsage`：输入/输出 token、缓存 token、成本
- `toolSummary`：工具调用统计（成功/失败/取消）
- `terminalReason`：`completed | stopped | error | no_text`

## 5. 为什么会看到 dropped

当 `publicKey` 或 `secretKey` 未配置时：

- `hasPublicKey=false` / `hasSecretKey=false`
- run 可能显示 `sampled=false`、`enabled=false`、`status=dropped`

这表示“未进入 Langfuse 云端 trace 上报”，不是业务失败。
本地摘要仍可通过内部接口查看。

## 6. 开关与配置位置

配置文件：`~/.kite/config.json`

关键项：

```json
{
  "remoteAccess": {
    "enabled": true,
    "port": 3456,
    "fixedToken": "246810"
  },
  "observability": {
    "langfuse": {
      "enabled": true,
      "devApiEnabled": true,
      "host": "https://cloud.langfuse.com",
      "sampleRate": 1,
      "maskMode": "summary_hash",
      "publicKey": "",
      "secretKey": ""
    }
  }
}
```

## 7. 切换到云端上报（可选）

如果要把数据上报到 Langfuse：

1. 填入：
   - `observability.langfuse.publicKey`
   - `observability.langfuse.secretKey`
2. 重启应用
3. 再发消息并查看 `runs`，应看到采样和 trace 正常进入云端

## 8. 常见问题排查

1. `run not found: <runId>`
- 原因：把 `<runId>` 当字面量传了
- 处理：用真实 runId 替换

2. `401 No authorization token`
- 原因：没带 token 或 token 错误
- 处理：带 `?token=246810` 或 `Authorization: Bearer 246810`

3. 接口连不上
- 原因：应用未启动或 remote server 未拉起
- 处理：重启应用，确认 `remoteAccess.enabled=true` 且端口未被占用

## 9. 下一阶段建议

- Phase 2：扩展到 OpenAI 兼容路由（协议转换耗时纳入同一 trace）
- Phase 3：扩展 MCP/Workflow，并建立 P95 TTFT/失败率回归门禁
