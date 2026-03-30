# Kite Library 技能与智能体全局资产库设计

## 文档类型

- 产品与实现联合设计文档
- 范围：`Skills` / `Agents` 顶层入口、用户可见资产目录、加载规则、迁移策略、启用状态、导入交互

## 背景

当前系统已经具备 `skills` / `agents` 的底层扫描、索引、IPC、渲染和插件扩展能力，但现有产品心智仍以工程目录为中心：

- 用户级资源历史上位于 `~/.kite/skills`、`~/.kite/agents`
- 工作区级资源位于 `{workDir}/.claude/skills`、`{workDir}/.claude/agents`
- 前台面板主要偏向 `space` 级资源
- 普通用户难以理解隐藏目录、配置目录和项目目录之间的区别

这导致几个问题：

- 用户找不到自己创建的技能和智能体
- 分享路径不直观，无法把“技能/智能体”作为显式资产流转
- 产品层和实现层概念混杂，用户不应理解 `.claude`、`~/.kite` 等内部目录
- “可被系统发现”和“默认参与会话加载”之间没有清晰的产品语义

本设计目标是把 `Skills` / `Agents` 重构为用户可见、可创建、可管理、可分享的全局资产库，同时保留现有插件体系和运行时资源加载能力。

## 目标

### 业务目标

- 让普通用户能直接看见自己的技能和智能体资产
- 让技能和智能体可以作为文件资产在本地流转和分享
- 把“创建后立刻可见、立刻可用”变成默认体验
- 把“启用 / 停用”定义为用户能理解的全局默认加载控制

### 产品目标

- 左侧顶层提供 `技能`、`智能体` 两个一等入口
- 资源默认点击进入详情页，不直接执行
- 创建流程使用自然语言驱动，结果直接落入全局资产库
- 顶层页面展示全集资源，但不在 UI 上强制分组“我的 / 系统提供”

### 工程目标

- 将用户资产真源从 `~/.kite/skills`、`~/.kite/agents` 迁移到用户可见目录
- 将启用状态从资源文件内容中剥离，统一放入 `~/.kite` 本地状态索引
- 保持插件加载规则不变
- 不把所有资源正文自动注入每次会话上下文

## 非目标

- 第一版不做在线资源市场
- 第一版不做应用内链接分享
- 第一版不做 zip 导入导出
- 第一版不做批量选择、批量启停、批量删除
- 第一版不暴露 `.claude` 工作区资源概念给普通用户
- 第一版不做会话级启停规则，只做“所有新会话”的全局默认启停

## 核心设计结论

### 1. 目录模型

用户可见资产目录采用以下结构：

```text
Kite/
  Spaces/
  Skills/
  Agents/
```

其中：

- `Kite/Spaces`：工作区目录
- `Kite/Skills`：用户自己的技能资产库
- `Kite/Agents`：用户自己的智能体资产库

`~/.kite` 保持为内部配置与状态目录，不再作为用户技能/智能体资产真源：

```text
~/.kite/
  config.json
  resource-library-state.json
  ...
```

### 2. 用户资产真源

第一版定义如下：

- 用户资产真源：
  - `Kite/Skills`
  - `Kite/Agents`
- 插件 / 系统资源：
  - 继续按现有插件与系统规则加载
- 历史目录：
  - `~/.kite/skills`
  - `~/.kite/agents`
  仅参与首次迁移，迁移后退出加载链路

### 3. 资源形态

第一版沿用现有资源形态，不强行统一包格式：

- 技能：一个文件夹代表一个技能，目录内必须包含 `SKILL.md`
- 智能体：一个 `.md` 文件代表一个智能体

示例：

```text
Kite/
  Skills/
    writing-helper/
      SKILL.md
      assets/
      scripts/
  Agents/
    founder-coach.md
    sales-reviewer.md
```

### 4. 状态模型

资源是否默认参与新会话加载，不写入资源文件本身，而写入本地状态索引：

```text
~/.kite/resource-library-state.json
```

第一版至少存储：

- 资源稳定 key
- `enabled: true | false`
- `updatedAt`

示例：

```json
{
  "version": 1,
  "resources": {
    "skill:user:writing-helper": {
      "enabled": true,
      "updatedAt": "2026-03-29T12:00:00.000Z"
    },
    "agent:user:founder-coach": {
      "enabled": false,
      "updatedAt": "2026-03-29T12:00:00.000Z"
    }
  }
}
```

### 5. 资源 key 规则

第一版采用简单稳定 key：

- `skill:<source>:<name>`
- `agent:<source>:<name>`

例如：

- `skill:user:writing-helper`
- `agent:user:founder-coach`
- `skill:plugin:seo-content-writer`

### 6. 默认加载语义

这里的“加载”定义为：

- 资源进入“新会话默认可用资源集”
- 不等于资源正文被自动拼进每条消息上下文

规则：

- `enabled = true`
  - 对所有新会话，该资源默认可用
- `enabled = false`
  - 资源仍展示在 UI 中
  - 资源仍可手动插入到当前对话
  - 但对所有新会话默认不参与加载

### 7. 创建后默认启用

用户新建技能 / 智能体后：

- 立即写入全局资产库
- 立即写入状态索引
- 默认 `enabled = true`
- 立即出现在列表中

## 用户界面设计

### 顶层入口

左侧顶层新增两个入口：

- `技能`
- `智能体`

它们是产品层的一等入口，不再把技能 / 智能体仅视为“扩展中的一种子资源”。

### 页面结构

技能页和智能体页结构保持一致：

#### 头部动作

- `创建`
- `打开文件夹`

含义：

- 技能页的 `打开文件夹` 打开 `Kite/Skills`
- 智能体页的 `打开文件夹` 打开 `Kite/Agents`

#### 列表展示

列表展示全集资源，不做“我的 / 系统提供”分组，但内部保留来源字段。

每个资源项显示：

- 名称
- 一行简介
- 轻量来源标记，例如 `用户` / `插件`
- 状态标记，例如 `已启用` / `已停用`

排序规则：

1. `enabled === true` 的资源在前
2. 同状态下按字母序

#### 默认点击行为

点击资源进入详情页，不直接执行、不直接插入、不直接启停。

### 详情页

详情页是第一版的主控制面板。

展示内容：

- 名称
- 描述
- 来源
- 路径
- Markdown 预览

操作按钮：

- `插入到对话`
- `启用 / 停用`
- `打开所在文件夹`
- `删除`
- `编辑`

来源约束：

- 用户资产：
  - 可编辑
  - 可删除
  - 可打开所在文件夹
  - 可启用 / 停用
- 插件 / 系统资源：
  - 一般不可删除
  - 一般不可编辑
  - 可启用 / 停用

按钮文案语义：

- `启用`
  - 以后新对话默认可用
- `停用`
  - 以后新对话默认不加载
- `插入到对话`
  - 当前这次显式使用

## 创建流程设计

### 创建入口

用户在技能页或智能体页点击 `创建`。

### 创建模式

第一版采用自然语言创建流程，不把空白 Markdown 编辑器作为主入口。

流程：

1. 用户选择创建技能或智能体
2. 用户用自然语言描述需求
3. AI 生成第一版文档
4. UI 展示生成预览
5. 用户确认
6. 系统落盘到全局资产库
7. 系统写入状态索引 `enabled = true`
8. 系统刷新索引与列表
9. 自动打开新资源详情页

落盘路径：

- 技能：

```text
Kite/Skills/<skill-name>/SKILL.md
```

- 智能体：

```text
Kite/Agents/<agent-name>.md
```

## 导入与分享设计

### 第一版主路径

第一版只做两条主路径：

1. `打开文件夹`
2. `拖拽导入`

### 拖拽导入规则

#### 技能页

- 只接受文件夹
- 文件夹内必须存在 `SKILL.md`
- 导入成功后复制到 `Kite/Skills/<folder-name>`

#### 智能体页

- 只接受 `.md` 文件
- 导入成功后复制到 `Kite/Agents/<file-name>.md`

### 冲突处理

第一版仅提供：

- `替换`
- `取消`

### 导入后行为

导入成功后：

- 自动写入状态索引，默认 `enabled = true`
- 自动刷新列表
- 自动打开新资源详情页

### 分享模型

第一版不做应用内在线分享能力。

分享方式即文件本身：

- 技能：分享整个技能文件夹
- 智能体：分享 `.md` 文件

产品层通过 `打开所在文件夹` 支撑这个分享路径，不额外做复杂分享系统。

## 迁移策略

### 迁移目标

历史目录：

```text
~/.kite/skills
~/.kite/agents
```

迁移至：

```text
Kite/Skills
Kite/Agents
```

### 迁移时机

首次升级到新版本并启动时检查。

### 迁移流程

1. 检查旧目录是否存在内容
2. 若存在内容，则迁移到新目录
3. 为迁移后的资源写入默认状态 `enabled = true`
4. 迁移完成后将旧目录重命名为备份目录：
   - `~/.kite/skills.legacy-backup`
   - `~/.kite/agents.legacy-backup`
5. 后续运行不再扫描旧目录

### 迁移原则

- 不做长期双源加载
- 不做双写
- 不让旧目录继续参与运行时资源真源

## 会话与刷新规则

### 资源变化的影响范围

以下变化都会刷新资源索引和资源 hash：

- 新建资源
- 编辑资源
- 删除资源
- 导入资源
- 启用 / 停用资源

### 生效规则

- 新会话：
  - 按最新索引和最新启用状态生效
- 现有会话：
  - 默认不强行热更新
  - 不在对话过程中自动替换资源快照

产品提示语义：

- 资源变化将影响后续新对话
- 现有会话保持稳定

## 来源与权限边界

第一版虽然在 UI 中不按来源分组，但内部必须保留来源字段。

原因：

- 决定是否可编辑
- 决定是否可删除
- 决定是否可打开所在文件夹
- 决定默认启停状态归属

### 来源分类

- `user`
  - 来自 `Kite/Skills` / `Kite/Agents`
- `plugin`
  - 来自插件加载体系
- `system`
  - 如存在内置资源，按系统资源处理

## 实现切面

### 1. 目录与路径服务

需要补充用户可见资产目录定义：

- `Kite` 根目录
- `Kite/Spaces`
- `Kite/Skills`
- `Kite/Agents`

相关文件：

- [src/main/services/config.service.ts](/Users/dl/ProjectSpace/ownerAgent/hello-halo/src/main/services/config.service.ts)
- [src/main/services/config-source-mode.service.ts](/Users/dl/ProjectSpace/ownerAgent/hello-halo/src/main/services/config-source-mode.service.ts)
- [src/main/services/space.service.ts](/Users/dl/ProjectSpace/ownerAgent/hello-halo/src/main/services/space.service.ts)

### 2. 资源扫描与 CRUD

`skills.service.ts` / `agents.service.ts` 需要从“偏 space 级创建与管理”改成支持“用户资产库”：

- app 级用户资产源改为 `Kite/Skills` / `Kite/Agents`
- 创建、编辑、删除需支持用户资产
- 插件源保持不动

相关文件：

- [src/main/services/skills.service.ts](/Users/dl/ProjectSpace/ownerAgent/hello-halo/src/main/services/skills.service.ts)
- [src/main/services/agents.service.ts](/Users/dl/ProjectSpace/ownerAgent/hello-halo/src/main/services/agents.service.ts)
- [src/main/services/skills-agents-watch.service.ts](/Users/dl/ProjectSpace/ownerAgent/hello-halo/src/main/services/skills-agents-watch.service.ts)

### 3. 状态索引服务

新增资源状态服务，负责：

- 读写 `resource-library-state.json`
- 合并 `enabled` 状态
- 切换启用 / 停用

### 4. 顶层页面与交互

把“技能 / 智能体”真正抬到一等页面，而不是只在现有扩展体系里露出一个局部面板。

相关文件：

- [src/renderer/components/unified/UnifiedSidebar.tsx](/Users/dl/ProjectSpace/ownerAgent/hello-halo/src/renderer/components/unified/UnifiedSidebar.tsx)
- [src/renderer/pages/UnifiedPage.tsx](/Users/dl/ProjectSpace/ownerAgent/hello-halo/src/renderer/pages/UnifiedPage.tsx)
- [src/renderer/components/home/ExtensionsView.tsx](/Users/dl/ProjectSpace/ownerAgent/hello-halo/src/renderer/components/home/ExtensionsView.tsx)
- [src/renderer/components/skills/SkillsPanel.tsx](/Users/dl/ProjectSpace/ownerAgent/hello-halo/src/renderer/components/skills/SkillsPanel.tsx)
- [src/renderer/components/agents/AgentsPanel.tsx](/Users/dl/ProjectSpace/ownerAgent/hello-halo/src/renderer/components/agents/AgentsPanel.tsx)
- [src/renderer/components/skills/SkillDetailModal.tsx](/Users/dl/ProjectSpace/ownerAgent/hello-halo/src/renderer/components/skills/SkillDetailModal.tsx)
- [src/renderer/components/agents/AgentDetailModal.tsx](/Users/dl/ProjectSpace/ownerAgent/hello-halo/src/renderer/components/agents/AgentDetailModal.tsx)

### 5. 创建工作流

需要新增面向用户资产库的创建链路：

- 自然语言输入
- AI 生成文档
- 写入全局资产目录
- 写入默认启用状态
- 打开详情页

## 分阶段落地建议

### Phase 1：目录与迁移

- 定义 `Kite` 用户可见目录
- 完成旧目录迁移
- 建立状态索引文件

### Phase 2：资源服务改造

- 让 `skills` / `agents` 扫描用户资产目录
- 接入状态索引合并
- 支持用户资产 CRUD

### Phase 3：顶层页面改造

- 左侧顶层新增 `技能` / `智能体`
- 完成全集列表、详情页、启用 / 停用
- 列表按“启用优先 + 字母序”排序

### Phase 4：创建与导入

- 完成自然语言创建工作流
- 完成 `打开文件夹`
- 完成拖拽导入

## 实施对齐状态（2026-03-30）

- 已对齐项：
  - `Kite/Skills` / `Kite/Agents` 作为用户资产真源
  - `resource-library-state.json` 作为启用状态真源
  - 顶层 `技能 / 智能体` 入口与 library 详情动作
  - 顶部 `创建` / `打开文件夹`、页面拖拽导入、冲突替换确认
  - 创建与导入成功后刷新列表并自动打开新资源详情页
- 已记录偏差：
  - 第一版 `resource-draft-generator.service.ts` 为本地模板生成器（确定性规则），不是模型实时生成；原因是先保证离线可用和可测试性，后续可替换为模型驱动实现而不改变 IPC/UI 协议。
- 待补验证：
  - 关键路径桌面端人工手测（迁移、导入、启停对新会话影响）仍待执行。

## 风险与控制

### 风险 1：双源并存导致行为不一致

控制：

- 旧目录只迁移一次
- 迁移后退出扫描链路

### 风险 2：用户理解“启用”含义不清

控制：

- 在 UI 文案中明确说明“影响后续新对话”
- 不把“启用”误导成“立即把全文塞进当前会话”

### 风险 3：插件资源和用户资产权限混淆

控制：

- 即使 UI 不分组，也保留来源标记和行为差异

### 风险 4：会话中途热更新导致结果不稳定

控制：

- 第一版不强制热更新正在进行的会话

## 验收标准

### 用户视角

- 用户能在左侧顶层找到 `技能`、`智能体`
- 用户能看到自己创建的资源
- 用户能通过 `创建` 生成资源并立即在列表中看到
- 用户能启用 / 停用资源
- 用户能打开文件夹并在文件系统中找到资源
- 用户能把技能文件夹或智能体文件发给别人

### 系统视角

- 系统能从 `Kite/Skills` 和 `Kite/Agents` 正确扫描资源
- 系统能合并插件资源
- 系统能读取并应用 `resource-library-state.json`
- 系统能在新会话中按启用状态构建默认资源集
- 旧的 `~/.kite/skills`、`~/.kite/agents` 完成一次性迁移

## 后续扩展方向

以下能力不属于第一版，但可自然扩展：

- zip 导入 / 导出
- 会话级启用 / 停用
- 收藏、最近使用、隐藏
- 在线模板分享
- 资源安装页与市场页
- 导入预览与批量冲突处理

## 最终结论

本设计把技能和智能体从“工程目录中的内部资源”升级为“普通用户可见、可创建、可流转的全局资产”。

核心原则是：

- 用户资产真源放在 `Kite/Skills`、`Kite/Agents`
- 内部状态放在 `~/.kite`
- 全局可发现，不等于自动注入每次会话
- 创建后默认启用
- 点击先看详情
- 第一版只做最真实的文件系统分享路径

这是当前产品目标下最稳、最容易让普通用户理解的一版。
