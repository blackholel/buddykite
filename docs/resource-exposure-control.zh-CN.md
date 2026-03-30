# 资源曝光机制说明（resource-exposure，已废弃）

`resource-exposure` 机制已下线，不再参与资源展示或调用控制。

## 1. 已移除能力

以下能力不再由 `resource-exposure` 控制：

1. 外层资源展示（`extensions / composer / template-library`）
2. 直接调用解析（`runtime-direct`）
3. 命令链路中的调用放行判断

当前策略是全量可见、可调用，并由来源策略/插件状态/space 策略控制执行边界。

## 2. 配置状态

1. `~/.kite/taxonomy/resource-exposure.json` 不再被系统读取
2. `config.json` 中不再使用 `resourceExposure.enabled`
3. 启动阶段会执行一次历史清理：删除上述 legacy 配置文件，并清理资源 frontmatter 里的 `exposure` 行

## 3. 历史字段处理

资源 frontmatter 中若存在 `exposure` 字段，系统不会读取。  
该字段属于历史遗留，可按需手动清理。

## 4. 管理动作边界

1. 插件资源不可删除（仅支持启用/停用，或插件级卸载）
2. 用户库资源（app）可删除
