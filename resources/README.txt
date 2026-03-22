====================================
    buddykite 安装指南（macOS）
====================================

欢迎使用 buddykite。

------------------------------------
安装步骤
------------------------------------
1. 将左侧的 buddykite.app 拖到右侧 Applications 文件夹
2. 在 Applications 中打开 buddykite（不要在 DMG 里直接运行）

------------------------------------
如果首次打开被系统拦截
------------------------------------
1. 先打开“系统设置” > “隐私与安全性”
2. 找到 buddykite 的拦截提示
3. 点击“仍要打开”
4. 或者在 Applications 里右键 buddykite.app，再点“打开”

------------------------------------
如果出现“已损坏，无法打开”
------------------------------------
这通常不是文件真的坏了，而是 Gatekeeper 对签名/来源校验失败。
建议优先从官方发布页重新下载并覆盖安装，避免使用被二次打包的安装包。

临时排查（仅在你确认来源可信时使用）：
xattr -dr com.apple.quarantine /Applications/buddykite.app
open -a /Applications/buddykite.app

官方发布页：
https://github.com/openkursar/hello-halo/releases/latest

====================================
