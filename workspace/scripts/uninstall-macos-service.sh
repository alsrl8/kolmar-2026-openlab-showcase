#!/bin/zsh

set -euo pipefail

readonly LABEL="net.infograb.kolmar-openlab"
readonly WORKSPACE_DIR="/Users/milles/projects/kolmar-2026-openlab-showcase/workspace"
readonly PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
readonly DOMAIN="gui/$(id -u)"

/bin/launchctl bootout "$DOMAIN" "$PLIST" >/dev/null 2>&1 || true
if [[ -f "$PLIST" ]]; then
  /bin/rm "$PLIST"
fi

cd "$WORKSPACE_DIR"
/usr/local/bin/docker compose --profile public down

print "Open Lab 자동 복구를 해제했고 실행 중인 컨테이너를 종료했습니다."
print "업로드 파일과 ONLYOFFICE 데이터가 든 Docker 볼륨은 보존했습니다."
