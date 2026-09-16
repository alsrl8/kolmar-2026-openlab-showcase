# Open Lab 공유용 서브워크플로

참가자는 API 주소나 인증키를 직접 입력하지 않습니다. 관리자가 아래 두 JSON을 n8n에 한 번 가져와 게시하면, 각 실습 워크플로에서 `Execute Sub-workflow` 노드로 불러 쓸 수 있습니다.

## 1. n8n으로 파일 가져오기

- 파일: `fetch-file-subworkflow.json`
- 워크플로: `Open Lab - n8n으로 파일 가져오기`
- 방향: 공개 Storage → n8n
- 입력 JSON: `team`, `fileId`
- 출력 JSON: `id`, `team`, `name`, `mime`
- 출력 binary: `data`

원본 파일을 `processing` 상태로 바꾸고 binary를 반환합니다. 뒤에 Excel, PDF, AI 등 과제에 필요한 노드를 연결합니다.

## 2. 공개 Storage에 결과 보내기

- 파일: `save-result-subworkflow.json`
- 워크플로: `Open Lab - 공개 Storage에 결과 보내기`
- 방향: n8n → 공개 Storage
- 입력 JSON: `team`, `sourceId`, `resultName`
- 입력 binary: `data`
- 출력: 공개 Storage가 생성한 결과 파일 정보

결과는 원본을 덮어쓰지 않고 별도 파일로 저장됩니다. `sourceId`로 원본과 연결되며 작업공간의 `완료된 결과`에 나타납니다.

## 가져오기와 공유

관리자는 두 서브워크플로와 호출 예시를 함께 가져옵니다.

```sh
for workflow in /workflows/fetch-file-subworkflow.json \
  /workflows/save-result-subworkflow.json \
  /workflows/subworkflow-demo-caller.json; do
  docker compose --profile automation exec -T n8n \
    n8n import:workflow --input="$workflow"
done
```

다른 워크플로가 호출할 수 있도록 두 서브워크플로를 게시합니다.

```sh
docker compose --profile automation exec -T n8n \
  n8n publish:workflow --id=openlab-fetch-file
docker compose --profile automation exec -T n8n \
  n8n publish:workflow --id=openlab-save-result
```

참가자는 `Open Lab - 서브워크플로 실습 예시`를 복사한 뒤 `업무 처리 구간`만 바꿉니다. 앞뒤 호출 노드는 그대로 둡니다.

## 관리자가 준비할 값

서브워크플로 JSON에는 비밀값이 없습니다. n8n 실행 환경에 아래 값을 설정합니다.

- `OPENLAB_API_ORIGIN`: n8n에서 접근 가능한 공개 Storage 주소
- `OPENLAB_N8N_API_KEY`: 공개 Storage가 발급한 n8n 전용 API 키

로컬 Compose는 `.env` 값을 위 환경변수로 전달합니다. 콜마 n8n에서는 고객 환경의 Credential 또는 관리 정책에 맞는 비밀 저장 방식을 사용해야 합니다.
