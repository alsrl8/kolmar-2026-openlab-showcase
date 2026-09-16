#!/bin/zsh

set -euo pipefail

readonly LABEL="net.infograb.kolmar-openlab"
readonly WORKSPACE_DIR="/Users/milles/projects/kolmar-2026-openlab-showcase/workspace"
readonly SERVICE_SCRIPT="$WORKSPACE_DIR/scripts/openlab-service.sh"
readonly LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
readonly LOG_DIR="$HOME/Library/Logs/KolmarOpenLab"
readonly PLIST="$LAUNCH_AGENTS_DIR/$LABEL.plist"
readonly DOMAIN="gui/$(id -u)"

mkdir -p "$LAUNCH_AGENTS_DIR" "$LOG_DIR"
chmod +x "$SERVICE_SCRIPT" "$WORKSPACE_DIR/scripts/update-entry.mjs"

/usr/bin/plutil -create xml1 "$PLIST"
/usr/libexec/PlistBuddy -c "Add :Label string $LABEL" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :ProgramArguments array" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :ProgramArguments:0 string /bin/zsh" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :ProgramArguments:1 string $SERVICE_SCRIPT" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :WorkingDirectory string $WORKSPACE_DIR" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :RunAtLoad bool true" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :KeepAlive bool true" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :ThrottleInterval integer 10" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :StandardOutPath string $LOG_DIR/service.log" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :StandardErrorPath string $LOG_DIR/service-error.log" "$PLIST"
/usr/bin/plutil -lint "$PLIST"

/bin/launchctl bootout "$DOMAIN" "$PLIST" >/dev/null 2>&1 || true
/bin/launchctl bootstrap "$DOMAIN" "$PLIST"
/bin/launchctl kickstart -k "$DOMAIN/$LABEL"

print "Open Lab 자동 복구를 설치했습니다."
print "상태: launchctl print $DOMAIN/$LABEL"
print "로그: $LOG_DIR/service.log"
print "해제: $WORKSPACE_DIR/scripts/uninstall-macos-service.sh"
