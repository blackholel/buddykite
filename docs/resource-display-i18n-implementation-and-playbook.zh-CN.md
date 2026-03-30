# 资源展示多语言改造背景与运维手册（Sidecar 离线版）

## 1. 背景与目标

本次改造目标是把 **外层扩展展示**（Extensions 页、`/`、`@` 建议、详情弹窗标题）从英文资源名切到多语言展示，提升非英文用户可理解性；同时保持执行层稳定：

- 展示层：支持 `displayName/description` 多语言（当前主交付 `zh-CN`）。
- 执行层：命令/技能/代理内部调用 key 保持英文，不改语义和匹配规则。
- 翻译方式：**纯离线**，只读本地文件，不调用外部翻译 API。

---

## 2. 本次改造的核心决策

### 2.1 Sidecar 文件

- 固定文件名：`resource-display.i18n.json`
- 只存展示字段：`title`、`description`
- 不翻译正文（markdown body）
- 资源键保持执行键：
  - 无命名空间：`<name>`
  - 有命名空间：`<namespace>:<name>`

### 2.2 展示优先级（已按评审修正）

```
sidecar(locale)
> frontmatter(locale)
> sidecar(defaultLocale)
> frontmatter(base)
> fallback
```

这条顺序用于避免“已有中文 frontmatter 被 sidecar 英文兜底截胡”。

### 2.3 扫描范围

已覆盖：

- app：`~/.kite`
- globalPaths：`config.json` 中 skills/agents 全局路径
- enabled plugins：动态枚举启用插件 installPath（非硬编码）
- current space：`<workDir>/.claude`

---

## 3. 关键实现摘要（本次已落地）

### 3.1 主进程服务

- 新增 sidecar 解析与缓存服务：
  - `src/main/services/resource-display-i18n.service.ts`
- 三类资源服务接入 sidecar + frontmatter 组合优先级：
  - `src/main/services/skills.service.ts`
  - `src/main/services/agents.service.ts`
  - `src/main/services/commands.service.ts`
- 新增 frontmatter 仅 locale 读取助手（无 base 回退）：
  - `src/main/services/resource-metadata.service.ts`

### 3.2 watcher 与索引

- sidecar 文件变更触发三类资源联动刷新：
  - `src/main/services/skills-agents-watch.service.ts`
- resource index hash 纳入 sidecar 指纹，确保 sidecar 改动可触发 session/index 更新：
  - `src/main/services/resource-index.service.ts`

### 3.3 渲染层展示

- Trigger 规则按“增量扩展 Unicode”处理，保留原字符集兼容性：
  - `src/renderer/utils/composer-trigger.ts`
- InputArea 主链路保证：
  - 展示 `displayName`
  - 插入英文 key（`/${key}`、`@${key}`）
  - 提取为可测纯函数：
    - `src/renderer/utils/composer-resource-suggestion.ts`
- 详情弹窗标题改为本地化显示名：
  - `src/renderer/components/skills/SkillDetailModal.tsx`
  - `src/renderer/components/agents/AgentDetailModal.tsx`
- 扩展页 UI 词条补齐 zh-CN：
  - `src/renderer/components/home/ExtensionsView.tsx`
  - `src/renderer/i18n/locales/zh-CN.json`

### 3.4 本地离线脚本与防误用

- 新增离线 sidecar 构建脚本（scan/apply/report）：
  - `scripts/build-resource-sidecar.mjs`
- 旧在线迁移脚本默认阻断在线模式：
  - `scripts/migrate-kite-resource-i18n.mjs`
- 新增检查脚本防止 npm scripts 使用 `--mode api/google`：
  - `tests/check/no-online-resource-i18n-mode.mjs`

---

## 4. 本次线上问题与处理结论

### 4.1 “还是英文”

根因通常有三类：

1. sidecar 文件不存在（最常见）
2. sidecar 有条目但 `zh-CN` 未填或保留英文
3. 缓存未刷新（需点 Refresh 或重启）

### 4.2 “某条命令不在外层扩展”

`resource-exposure` 已废弃，不再用于展示过滤。  
当前外层可见性主要受以下因素影响：

1. 资源是否被扫描到（来源目录是否正确、插件是否启用）
2. 插件/资源是否被停用
3. 当前视图筛选条件（资源类型、搜索关键字）

### 4.3 “展示不想看到 namespace 前缀”

已实现：外层扩展命令卡片标题隐藏 namespace，仅显示 `/<displayName>`。  
执行 key 不变，仍可稳定调用命名空间资源。

---

## 5. 未来新增资源时，如何继续做中文（标准流程）

> 适用于你未来新增 skills / agents / commands。

### Step 0：先把资源本体建好

新增资源文件放到对应目录（app/global/plugin/space）。

### Step 1：确认来源与启停状态

外层展示默认全量，不再依赖 exposure。  
你只需要确认：

1. 资源文件路径正确且可被扫描
2. 插件已启用
3. 资源未被停用

### Step 2：运行离线 sidecar 脚本

在仓库根目录执行：

```bash
npm run sidecar:scan
npm run sidecar:apply
npm run sidecar:report
```

如需指定空间：

```bash
node scripts/build-resource-sidecar.mjs apply --locale zh-CN --workdir <你的项目路径>
```

### Step 3：人工校对（强烈建议）

离线规则是保守策略，`needsReview` 可能很高。  
用 report 输出做人工修订：

```bash
node scripts/build-resource-sidecar.mjs report --locale zh-CN --out /tmp/sidecar-report.json
```

重点校对文件：

- `~/.kite/i18n/resource-display.i18n.json`
- `~/.kite/plugins/<plugin>/i18n/resource-display.i18n.json`
- `<workDir>/.claude/i18n/resource-display.i18n.json`

### Step 4：刷新验证

1. 在扩展页点击 `Refresh`
2. 如仍旧展示旧值，重启应用
3. 检查 `extensions` 页、`/`、`@` 建议、详情弹窗

---

## 6. Sidecar 内容模板（可直接复制）

```json
{
  "version": 1,
  "defaultLocale": "en",
  "resources": {
    "commands": {
      "everything-claude-code:tdd": {
        "title": {
          "en": "tdd",
          "zh-CN": "测试驱动开发"
        },
        "description": {
          "en": "Enforce test-driven development workflow...",
          "zh-CN": "严格执行 TDD 工作流：先写失败测试，再写最小实现通过测试，并保障 80%+ 覆盖率。"
        }
      }
    }
  }
}
```

---

## 7. 排障清单（10 分钟内定位）

1. 资源是否存在：
   - `~/.kite/plugins/<plugin>/commands/*.md` 或对应 skills/agents 路径
2. sidecar 是否有该 key：
   - `resources.<type>.<namespace:name>`
3. `zh-CN` 是否有值（不是空字符串）
4. 是否刷新缓存（Refresh / 重启）
5. 是否处于 `extensions` 视图（不是 runtime-only 视图）

---

## 8. 建议的维护节奏

- 每次新增/改名资源后，执行一次：
  - `scan -> apply -> report`
- 每周集中校对一次 `/tmp/sidecar-report.json`
- 资源展示由来源扫描 + 启停状态控制，不再维护 exposure 白名单
- 执行 key 永远不改（只改展示 `title/description`）

---

## 9. 相关文档

- `docs/resource-sidecar-offline.zh-CN.md`（简版）
- `docs/resource-exposure-control.zh-CN.md`（历史兼容说明，机制已废弃）
