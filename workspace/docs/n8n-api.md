# n8n 연결 안내

n8n 참가자는 API 키를 직접 다루지 않습니다. 고객 n8n 관리자가 HTTP Request Credential에 `N8N_API_KEY`를 Bearer 토큰으로 한 번 설정합니다.

## 1. 전달 대기 파일 조회

```http
GET /api/n8n/files?team=logistics&status=queued
Authorization: Bearer {N8N_API_KEY}
```

팀 ID:

- `logistics`
- `scaleup`
- `quality-assurance`
- `quality-control-2`
- `quality-control-4-retest`
- `quality-control-4-automation`

응답의 `id`가 이후 다운로드와 결과 연결에 사용하는 원본 ID입니다.

## 2. 처리 시작 표시

```http
PATCH /api/n8n/files/{id}
Authorization: Bearer {N8N_API_KEY}
Content-Type: application/json

{"status":"processing"}
```

허용 상태는 `uploaded`, `queued`, `processing`, `completed`, `error`입니다.

## 3. 원본 파일 다운로드

```http
GET /api/files/{id}/content
Authorization: Bearer {N8N_API_KEY}
```

n8n HTTP Request 노드에서 응답 형식을 File로 설정합니다. 원본 파일의 확장자와 MIME 형식을 유지합니다.

## 4. 결과 파일 업로드

```http
PUT /api/n8n/results?team=logistics&sourceId={원본ID}&name={결과파일명.xlsx}
Authorization: Bearer {N8N_API_KEY}
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet

{binary file body}
```

HTTP Request 노드에서 `Send Binary Data`를 사용합니다. 결과는 원본을 덮어쓰지 않고 별도 파일로 생성되며, 원본 상태는 `completed`로 바뀝니다.

실패한 경우 원본에 다음 상태를 기록합니다.

```http
PATCH /api/n8n/files/{id}
Authorization: Bearer {N8N_API_KEY}
Content-Type: application/json

{"status":"error"}
```

## 연결 점검

고객 n8n 서버에서 다음 항목을 확인해야 실제 연동이 검증됩니다.

1. 발급된 HTTPS 주소의 DNS와 TLS 연결
2. 고객 방화벽에서 외부 HTTPS 호출 허용
3. Bearer Credential 생성 권한
4. 파일 크기 제한과 n8n 실행 제한
5. 비식별 또는 승인된 파일만 사용

로컬 API 테스트는 고객 n8n 서버에서의 연결 성공을 증명하지 않습니다.

## 로컬 n8n 왕복 재현

저장소에 포함된 `Open Lab - 로컬 파일 왕복 확인` 워크플로는 물류팀의 첫 업로드 파일을 내려받고, 같은 바이너리를 `n8n-처리결과-<원본명>`으로 다시 올립니다. 파일 변환 전 연결 경로 자체를 검증하기 위한 워크플로입니다.

```sh
docker compose --profile automation up -d n8n
docker compose --profile automation exec -T n8n \
  n8n import:workflow --input=/workflows/local-file-roundtrip.json
```

`http://localhost:5681`에서 초기 관리자 계정을 만든 뒤 `Open Lab - 로컬 파일 왕복 확인`을 열어 직접 실행합니다. 실습 작업공간에는 물류팀 파일이 하나 이상 업로드되어 있어야 합니다. `5681`은 다른 로컬 n8n과 충돌하지 않도록 분리한 포트입니다.

워크플로에는 API 키가 저장되지 않습니다. Compose가 `.env`의 `N8N_API_KEY`를 `OPENLAB_N8N_API_KEY` 환경변수로 전달합니다.

### 공유용 서브워크플로

- `Open Lab - n8n으로 파일 가져오기`: 공개 Storage의 파일을 `team`, `fileId`로 찾아 원본 binary와 파일 정보를 반환합니다.
- `Open Lab - 공개 Storage에 결과 보내기`: 처리된 `data` binary와 `team`, `sourceId`, `resultName`을 받아 공개 Storage에 결과를 저장합니다.
- `Open Lab - 서브워크플로 실습 예시`: 앞뒤 서브워크플로 사이의 `업무 처리 구간`만 참가자가 바꾸는 호출 예시입니다.

두 서브워크플로의 입력·출력 계약과 공유 방법은 [../n8n-workflows/README.md](../n8n-workflows/README.md)에 따로 정리되어 있습니다.

세 워크플로를 함께 가져옵니다.

```sh
for workflow in /workflows/fetch-file-subworkflow.json \
  /workflows/save-result-subworkflow.json \
  /workflows/subworkflow-demo-caller.json; do
  docker compose --profile automation exec -T n8n \
    n8n import:workflow --input="$workflow"
done

docker compose --profile automation exec -T n8n \
  n8n publish:workflow --id=openlab-fetch-file
docker compose --profile automation exec -T n8n \
  n8n publish:workflow --id=openlab-save-result
```

n8n 2.x에서는 다른 워크플로가 호출할 두 서브워크플로를 가져온 뒤 게시해야 합니다. 게시하지 않으면 호출 노드가 `Workflow is not active` 오류를 반환합니다.
