#!/bin/bash
set -euo pipefail

APP_PATH="/Applications/buddykite.app"

if [ ! -d "$APP_PATH" ]; then
  osascript -e 'display dialog "未找到 /Applications/buddykite.app。请先把应用拖到 Applications 后再试。" buttons {"好的"} default button "好的" with icon caution'
  exit 1
fi

xattr -dr com.apple.quarantine "$APP_PATH"
open "$APP_PATH"
osascript -e 'display notification "已移除隔离标记并尝试打开 buddykite" with title "buddykite"'
