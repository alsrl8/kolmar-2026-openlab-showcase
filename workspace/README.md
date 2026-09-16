# Open Lab 하루 작업공간

교육 당일 참가자가 브라우저 하나로 파일을 올리고, 내용을 확인하고, 고객 n8n에 전달하고, 결과 파일을 다시 확인하는 작은 작업공간입니다. 파일을 데이터베이스 행으로 변환하지 않고 Excel, PDF, 이미지, 문서 원본을 그대로 보관합니다.

## 참가자 경험

1. 행사 코드와 팀을 선택해 입장합니다.
2. 파일을 끌어다 놓고 브라우저에서 확인합니다.
3. 파일 카드에서 원본을 내려받거나 필요 없는 파일을 삭제합니다.
4. n8n 연동 실습에서는 워크플로가 팀의 업로드 파일을 읽어 처리합니다.
5. n8n이 결과 파일을 올리면 `완료된 결과`에서 바로 열거나 내려받습니다.

PDF, 이미지, 텍스트, 오디오, 비디오는 브라우저가 직접 보여줍니다. Excel, Word, PowerPoint는 함께 실행되는 ONLYOFFICE Docs에서 열고 편집합니다. 편집 저장본은 원본을 덮지 않고 별도 결과 파일로 보관됩니다.

Compose 구성은 브라우저의 공개 주소와 컨테이너 간 내부 주소를 분리합니다. 따라서 `trycloudflare.com` 주소가 바뀌어도 ONLYOFFICE의 파일 다운로드와 저장 콜백 설정을 다시 만들 필요가 없습니다.

## 로컬 실행

Node.js 22 이상이 필요합니다.

```sh
cp .env.example .env
# .env의 모든 change-this 값을 변경
set -a
. ./.env
set +a
npm start
```

`http://localhost:3000`으로 접속합니다. 이 방식은 ONLYOFFICE 없이 파일 업로드, 기본 미리보기, n8n API를 확인하는 용도입니다. 로컬 단독 실행에서는 `.env`의 `ONLYOFFICE_ENABLED=false`로 설정합니다.

## 행사 전체 구성 실행

```sh
cp .env.example .env
# .env의 비밀값을 변경
docker compose up -d --build
```

로컬 확인 주소는 `http://localhost:8080`입니다.

도메인 없이 임시 공개 주소까지 발급하려면:

```sh
docker compose --profile public up -d --build
docker compose logs -f tunnel
```

로그에 표시되는 `https://...trycloudflare.com` 주소가 참가자 주소입니다. Quick Tunnel 주소는 프로세스를 다시 시작하면 바뀔 수 있고, 호스트가 실행 중일 때만 접근됩니다.

## Mac 이동과 자동 복구

교육용 Mac에서 아래 스크립트를 한 번 실행하면 사용자 로그인 후 Open Lab이 자동으로 시작됩니다.

```bash
./scripts/install-macos-service.sh
```

설치된 LaunchAgent는 Docker Desktop을 시작하고, Compose 서비스를 복구하며, 절전을 방지합니다. 네트워크 이동이나 재부팅으로 Quick Tunnel 주소가 바뀌면 `~/projects/alsrl8.github.io`의 `pages` 브랜치를 갱신해 참가자 주소 `https://alsrl8.github.io`가 새 터널을 가리키게 합니다. GitHub Pages 반영에는 잠시 시간이 걸릴 수 있습니다.

Mac 덮개를 닫으면 macOS가 잠들 수 있으며 그동안 접속은 중단됩니다. 덮개를 다시 열어 로그인하면 LaunchAgent가 서비스를 복구합니다. FileVault가 활성화된 재부팅 직후에는 사용자가 로그인하기 전까지 Docker Desktop과 사용자 LaunchAgent가 시작되지 않습니다.

행사가 끝나면 아래 명령 하나로 자동 시작과 절전 방지를 제거하고 컨테이너를 종료합니다.

```bash
./scripts/uninstall-macos-service.sh
```

기본 해제는 업로드 파일과 ONLYOFFICE 데이터가 들어 있는 Docker 볼륨을 보존합니다.

## 종료와 보관

메타데이터를 먼저 내려받습니다.

```sh
curl -fsS -H "Authorization: Bearer $ADMIN_KEY" \
  http://localhost:8080/api/admin/manifest > openlab-manifest.json
docker compose cp app:/data ./openlab-data
```

보관 확인 후 모든 행사 파일을 지웁니다.

```sh
curl -fsS -X POST \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  --data '{"confirm":"DELETE ALL WORKSHOP FILES"}' \
  http://localhost:8080/api/admin/cleanup
docker compose --profile public down
```

볼륨까지 영구 삭제하려면 백업을 확인한 운영자가 명시적으로 `docker compose down -v`를 실행해야 합니다.

## 보안 경계

- 공개 주소와 공개 Git 저장소는 서로 다릅니다. 소스는 공개되어도 업로드 파일과 키는 Docker 볼륨과 `.env`에만 남습니다.
- 참가자는 행사 코드로 입장하고 팀별 세션만 볼 수 있습니다.
- n8n과 관리자는 서로 다른 Bearer 키를 사용합니다.
- 실제 고객 데이터와 개인정보는 사전 승인 없이 올리지 않습니다.
- Quick Tunnel은 장기 운영이나 고가용성 배포 수단이 아닙니다.
- 서버 한 대에서 하루 동안 사용하는 규모를 전제로 합니다.

## 검증

```sh
npm run check
npm test
docker compose config
```

n8n 연결 방법은 [docs/n8n-api.md](docs/n8n-api.md)를 확인하세요.

로컬 n8n 재현 화면은 `docker compose --profile automation up -d n8n` 실행 후 `http://localhost:5681`에서 확인합니다.

실제 파일 왕복과 공통 안내 화면을 정리한 보고서는 [reports/openlab-n8n-local-verification.html](reports/openlab-n8n-local-verification.html)입니다.
