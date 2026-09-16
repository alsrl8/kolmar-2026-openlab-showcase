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
