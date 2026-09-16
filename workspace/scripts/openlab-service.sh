#!/bin/zsh

set -u

readonly WORKSPACE_DIR="/Users/milles/projects/kolmar-2026-openlab-showcase/workspace"
readonly ENTRY_REPO="/Users/milles/projects/alsrl8.github.io"
readonly ENTRY_FILE="$ENTRY_REPO/index.html"
readonly DOCKER_BIN="/usr/local/bin/docker"
readonly NODE_BIN="/opt/homebrew/bin/node"
readonly CURL_BIN="/usr/bin/curl"
readonly GIT_BIN="/usr/bin/git"
readonly UPDATE_SCRIPT="$WORKSPACE_DIR/scripts/update-entry.mjs"

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

log() {
  print -r -- "$(date '+%Y-%m-%d %H:%M:%S') $*"
}

wait_for_docker() {
  if "$DOCKER_BIN" info >/dev/null 2>&1; then
    return 0
  fi

  log "Docker Desktop를 시작합니다."
  /usr/bin/open -gja Docker
  for attempt in {1..90}; do
    if "$DOCKER_BIN" info >/dev/null 2>&1; then
      log "Docker가 준비됐습니다."
      return 0
    fi
    sleep 2
  done

  log "Docker가 3분 안에 준비되지 않았습니다."
  return 1
}

start_workspace() {
  cd "$WORKSPACE_DIR" || return 1
  "$DOCKER_BIN" compose --profile public up -d
}

current_tunnel_url() {
  cd "$WORKSPACE_DIR" || return 1
  "$DOCKER_BIN" compose logs --no-color tunnel 2>/dev/null \
    | /usr/bin/sed -nE 's#.*(https://[a-z0-9-]+\.trycloudflare\.com).*#\1#p' \
    | /usr/bin/tail -1
}

publish_entry() {
  local tunnel_origin="$1"
  local destination="${tunnel_origin}/workspace/"

  if ! "$CURL_BIN" -fsS --max-time 15 "${tunnel_origin}/health" >/dev/null; then
    log "터널이 아직 응답하지 않습니다: $tunnel_origin"
    return 1
  fi

  cd "$ENTRY_REPO" || return 1
  if [[ -n "$("$GIT_BIN" status --porcelain)" ]]; then
    log "고정 입구 저장소에 미커밋 변경이 있어 자동 갱신을 건너뜁니다."
    return 1
  fi

  "$GIT_BIN" pull --ff-only origin pages || return 1
  "$NODE_BIN" "$UPDATE_SCRIPT" "$destination" "$ENTRY_FILE" || return 1

  if "$GIT_BIN" diff --quiet -- "$ENTRY_FILE"; then
    return 0
  fi

  "$GIT_BIN" add "$ENTRY_FILE"
  "$GIT_BIN" commit -m "Update Open Lab tunnel destination"
  "$GIT_BIN" push origin pages
  log "고정 입구를 새 터널로 갱신했습니다: $destination"
}

log "Open Lab 자동 복구 서비스를 시작합니다."
/usr/bin/caffeinate -dims -w $$ &

while true; do
  if wait_for_docker && start_workspace; then
    for attempt in {1..30}; do
      tunnel_origin="$(current_tunnel_url)"
      if [[ -n "$tunnel_origin" ]] && publish_entry "$tunnel_origin"; then
        break
      fi
      sleep 2
    done
  fi
  sleep 60
done
