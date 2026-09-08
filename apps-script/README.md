# Google Sheets 수집기 설치·운영

이 폴더는 **연동 코드와 안내만** 제공합니다. 사용자의 Google 계정 연결, 시트 생성, 권한 승인, 실제 배포나 실자료 전송은 수행되어 있지 않습니다. 연구자가 직접 설치한 비공개 시트로 정적 GitHub Pages 앱의 자료를 선택 전송합니다.

구현: [`Code.gs`](Code.gs) · 요청/응답 타입: [`shared/schema.ts`](../shared/schema.ts) · 절차·문항 버전: [`src/protocol.ts`](../src/protocol.ts)

## 1. 비공개 시트에 설치

1. 연구자가 소유하는 **새 비공개 Google 스프레드시트**를 만듭니다. 실제 자료를 쓰기 전에는 별도의 테스트 시트를 사용하세요.
2. 시트에서 **확장 프로그램 → Apps Script**를 열어 해당 시트에 바인딩된 프로젝트를 만듭니다.
3. 기본 `Code.gs` 내용을 이 폴더의 [`Code.gs`](Code.gs)로 교체하고 저장합니다. V8 런타임을 사용하세요. 비밀번호·참여자 자료를 코드에 적지 마세요.
4. 함수 목록에서 **`setup`**을 선택해 한 번 실행하고, 본인이 관리하는 스크립트인지 확인한 뒤 필요한 Sheets 권한을 승인합니다.
5. `Participants`, `Responses`, `Trials`, `Conditions` 탭과 첫 행 헤더가 생성되는지 확인합니다. `setup()`은 바인딩된 시트 ID를 Script Properties의 `SPREADSHEET_ID`에 저장합니다. 기존 자료·헤더를 지우지 않으며 같은 시트에서 다시 실행해도 중복 생성하지 않습니다.
6. Apps Script **프로젝트 설정 → 스크립트 속성(Script Properties)**에서 다음을 확인·설정합니다.

| 속성 | 설정 |
|---|---|
| `SPREADSHEET_ID` | `setup()`이 기록한 바인딩 시트 ID. 대상 시트를 대조하세요. |
| `COLLECTION_CODE` | 연구팀 전용 무작위 수집 코드. 서버 허용 길이 24–128자; 비밀번호 관리자 등으로 32자 이상 무작위 값을 만드는 것을 권장합니다. |

코드는 **소스·README·GitHub Secrets·빌드 환경변수·URL 쿼리·스크린샷에 넣지 않습니다.** Script Properties와 승인된 비밀번호 관리 경로로 관리하고, 앱에는 실행 시 직접 입력합니다. 수집 코드를 바꾸면 연구자에게 별도 비공개 경로로 알리세요. 기존 코드의 요청은 거부됩니다.

`setup()` 실행 시 기존 `SPREADSHEET_ID`가 다른 시트를 가리키면 중단합니다. 운영 중인 프로젝트를 다른 시트로 재사용하지 말고 새 바인딩 프로젝트·배포를 만드는 편이 안전합니다. 기존 탭의 열 순서·이름을 바꾸거나 수식·자료를 직접 추가하지 마세요. 헤더 불일치나 중복 키가 있으면 수집기가 중단합니다.

## 2. 웹 앱 배포

Apps Script의 **배포 → 새 배포 → 유형: 웹 앱**을 선택합니다. 배포 절차와 실행 주체 설정은 [Google Web Apps 공식 문서](https://developers.google.com/apps-script/guides/web)에 설명되어 있습니다.

- 실행 사용자: **나(배포자)**. 이 설정은 요청자가 아니라 배포자의 권한으로 스크립트를 실행합니다. [Google 실행 권한 안내](https://developers.google.com/apps-script/guides/web)
- 액세스 권한: 정적 Pages에서 로그인 없이 호출하려면 해당 계정이 허용하는 **모든 사용자/익명 호출 가능** 설정이 필요합니다. 기관 정책에서 허용하지 않거나 해당 항목이 없다면 관리자의 승인을 받아 다른 호스팅·인증 구조를 설계해야 합니다. 정책을 우회하지 마세요. 배포자·도메인 권한은 [Google Web Apps 문서](https://developers.google.com/apps-script/guides/web)를 참조하세요.
- 배포 후 URL은 `https://script.google.com/macros/s/…/exec` 형태를 사용합니다. `/dev`는 편집 권한 보유자용 개발 시험 URL이므로 현장 앱에 넣지 않습니다. [Google 시험 배포 안내](https://developers.google.com/apps-script/guides/web)
- 시트 자체는 **링크를 아는 모든 사용자에게 공개하지 않습니다.** 웹 앱 호출 권한과 시트 공유 권한은 별개로 관리합니다.
- 코드 변경 후에는 **배포 관리 → 수정 → 새 버전 → 배포**로 웹 앱에 반영하세요. 편집기 저장만으로 운영 배포가 바뀌었다고 가정하지 마세요.

이 엔드포인트는 익명 호출이 가능한 경우 수집 코드를 가진 사람이라면 데이터를 제출할 수 있습니다. 수집 코드는 간단한 공유 비밀값으로, 개인별 인증·세밀한 권한관리·악용 방지 서비스를 대체하지 않습니다. 브라우저 실행 중에는 입력한 코드가 메모리와 네트워크 요청에서 사용됩니다. 비밀값 노출이 의심되면 교체하고, 높은 보안 수준·대규모 운영이 필요하면 승인된 인증 서버를 사용하세요.

## 3. 요청·수신 확인 계약

### 요청

[`SyncEnvelope`](../shared/schema.ts)의 필드와 이름을 그대로 사용합니다.

```ts
interface SyncEnvelope {
  schemaVersion: 1;
  protocolVersion: string;       // HF-EF-v2-web-draft-1
  submissionId: string;          // 요청 식별자
  sentAt: string;                // UTC ISO, 예: 2026-01-01T00:00:00.000Z
  collectionCode: string;        // 실행 시 입력. 저장소·결과 시트에 저장하지 않음
  participant: Participant;      // shared/schema.ts의 전체 스냅샷
}
```

엔드포인트는 **POST `Content-Type: text/plain;charset=UTF-8`** 본문의 JSON만 받습니다. 전체 본문은 UTF-8 기준 **128 KiB 이하**여야 합니다. `application/json`이나 사용자 정의 인증 헤더를 추가하지 마세요. 브라우저의 불필요한 사전 요청을 피하기 위한 설계지만, 이것만으로 CORS 성공이 보장되지는 않습니다.

Content Service는 응답을 `script.googleusercontent.com`의 일회성 URL로 리디렉션하므로 클라이언트가 리디렉션을 따라야 합니다. [Google Content Service 공식 안내](https://developers.google.com/apps-script/guides/content)

### 응답과 프런트엔드 판정

성공 응답은 모든 시트 쓰기와 `SpreadsheetApp.flush()`가 끝난 후에만 만듭니다.

```json
{
  "ok": true,
  "submissionId": "요청과 동일한-ID",
  "receivedAt": "2026-01-01T00:00:00.000Z"
}
```

오류 응답은 `{"ok":false,"submissionId":"…","error":"오류_코드"}` 형태입니다. 요청 ID가 올바른 형식이 아니거나 본문 파싱에 실패하면 `submissionId`는 생략됩니다. 수집 코드, 시트 ID, 참여자 내용이나 예외 원문을 응답에 포함하지 않습니다.

다음은 계약을 보여주는 TypeScript 예시입니다. `SyncEnvelope`, `SyncReceipt`는 [`shared/schema.ts`](../shared/schema.ts)에서 가져옵니다.

```ts
async function submit(
  endpoint: string,
  envelope: SyncEnvelope
): Promise<SyncReceipt> {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(envelope)
    });
    const receipt: SyncReceipt = await response.json();
    if (!response.ok || !receipt || receipt.ok !== true ||
        receipt.submissionId !== envelope.submissionId) {
      return { ok: false, submissionId: envelope.submissionId, error: 'UNCONFIRMED' };
    }
    return receipt;
  } catch {
    return { ok: false, submissionId: envelope.submissionId, error: 'UNCONFIRMED' };
  }
}
```

**HTTP 200, `fetch` 완료, GET 상태 확인만으로 저장 성공을 판정하지 않습니다.** JSON 파싱이 가능하고 `ok === true`이며 `submissionId`가 이번 요청과 일치해야 합니다. 오류 응답·다른 ID·로그인 HTML·CORS 차단·타임아웃은 모두 프런트엔드에서 `UNCONFIRMED`(수신 확인 안 됨)로 취급합니다.

**`mode: 'no-cors'`를 쓰지 마세요.** 불투명 응답은 확인할 수 없으며, 읽지 못하는 응답을 성공으로 바꾸면 자료가 누락돼도 알아차릴 수 없습니다. Google 문서는 Content Service의 리디렉션을 설명하지만 모든 브라우저·계정 정책에서의 CORS 성공을 보장하지 않습니다. [Google Content Service](https://developers.google.com/apps-script/guides/content)

`GET /exec`은 다음과 같은 서비스 상태만 반환합니다. 자료 수·참여자 검색·응답 읽기·시트 내보내기·JSONP 기능은 없습니다. GET의 `ok`는 **서비스 상태**이며 제출 ACK가 아닙니다.

```json
{"ok":true,"service":"focus-jump-lab","protocolVersion":"HF-EF-v2-web-draft-1"}
```

## 4. 배포 후 실제 브라우저 시험 — 필수

Node 모의 테스트는 실제 Google 연결을 시험하지 않습니다. 다음 과정은 **별도 테스트 시트·별도 배포·합성 참여자**에서 연구자가 직접 수행해야 합니다.

1. 실제 사용할 기기·브라우저에서 Pages 앱을 엽니다. 배포 `/exec` 주소와 테스트 수집 코드를 실행 시 입력합니다.
2. 실제 사람의 자료 대신 합성 참여자 코드 `TEST001` 등을 사용합니다. **데모 모드는 의도적으로 서버가 거부**하므로 서버 시험은 테스트용 일반 참여자와 테스트 확인 체크를 사용합니다. 실제 동의를 받았다는 연구자료로 해석하거나 운영 시트에 합치지 마세요.
3. 준비·사전기록·설문을 더미 값으로 저장하고 JSON 백업을 다운로드합니다.
4. 전송 후 읽을 수 있는 성공 응답의 `submissionId`가 요청과 일치하는지 확인합니다. 시트에서 해당 `participant_id`와 `response_key`를 대조합니다.
5. 같은 자료를 재전송해 행 수가 증가하지 않는지 확인합니다. 새 요청 ID를 써도 참여자·단계 ID와 과거 응답 내용이 같으면 중복되지 않아야 합니다.
6. 오류·CORS·타임아웃으로 `UNCONFIRMED`가 표시되면 **먼저 시트를 확인**합니다. 서버에는 기록됐지만 브라우저만 응답을 못 읽었을 수 있습니다. 이때 새 참여자를 만들지 말고 백업의 같은 ID와 동일 응답으로 재시도합니다.
7. 확인이 계속 실패하면 무한 재시도하지 마세요. JSON을 안전하게 보관하고 배포 권한·`/exec` 주소·코드·Apps Script 실행 상태를 연구자가 조사합니다. 필요하면 승인된 동일 출처 서버를 별도로 설계하고, 그전까지는 JSON/분석 내보내기 방식으로 운영합니다.
8. 테스트 시트와 합성 자료는 실제 연구 수집과 분리합니다. 실제 연구 전, 운영 시트에는 테스트 자료를 옮기지 않았는지 확인합니다.

창을 닫거나 새로고침하기 전 JSON 백업은 여전히 필수입니다. Sheets는 **쓰기 전용 수집 사본**이고 자동 이어하기·기기 간 동기화가 아닙니다. 다른 탭·기기에서는 파일을 수동 가져오기 해야 합니다.

## 5. 서버 검증과 재시도 보장 범위

[`Code.gs`](Code.gs)는 다음을 검증합니다.

- 정확한 `schemaVersion = 1`, `protocolVersion = HF-EF-v2-web-draft-1`, 올바른 수집 코드 및 본문 크기.
- `submissionId`, 참여자 `id`: 영문·숫자·하이픈 1–80자. 참여자 `code`: 영문·숫자·밑줄·하이픈 1–30자.
- 실제 참여자만 허용(`isDemo === false`), 동의·적격성·프로토콜 검토 모두 `true`.
- 참여자 필드·상태, 0부터 시작하는 `stepIndex`, `responses.length === stepIndex`, 완료 상태와 마지막 단계 일치.
- A–D별 `buildSteps` 순서와 모든 응답의 `stepId`, `kind`, `visit`, `pressure`, `focus`, `block`, `trial` 일치.
- 밀리초·`Z`를 포함하는 UTC ISO 타임스탬프, 생성 ≤ 각 응답 시작 ≤ 종료 ≤ 전송 시각 및 응답 간 역전 없음. 기기 시계가 바뀌었다면 원자료를 검토해야 합니다. 서버가 실제 10분·48시간 준수를 자동 인증하지는 않습니다.
- MRF 세 항목 1–11 정수, 평가압박 1–7 정수, 집중도 0–100 정수. 결측 `null`에는 비어 있지 않은 `missingReason` 필요.
- 유효 거리: 유한 숫자 `(0, 500]` cm. 무효·결측: 거리 `null` 및 비어 있지 않은 `reason`.
- 연구자 코드 최대 60자, 참여자 메모·개별 사유 최대 2,000자, 응답 `values` JSON 최대 8,000자와 깊이·항목 수 제한.
- 요청·참여자·응답의 허용된 외곽 필드와 단계별 값 키만 수용합니다. 안내·체크·휴식·방문 간격의 확인값·예외 사유도 검증하며 추가 인구통계 키를 받지 않습니다.
- 선택 메타데이터 `unit`은 `cm`, `question_version`은 현재 문항 버전이어야 합니다. 설문의 `response_time_ms`, `response_methods`(`radio`/`range`/`keyboard`/`numeric`), 문항별 마지막 선택 시각 `item_timestamps`를 검증·보존합니다. 이것은 전체 선택 변경 이력이 아닙니다.

### 안정적인 키와 불변 응답

| 탭 | 고유 키 | 쓰기 규칙 |
|---|---|---|
| `Participants` | `participant_id` | 동일 ID 1행 갱신. ID·코드·군·생성시각·동의 정보는 불변. 진행을 과거로 되돌리지 않음. |
| `Responses` | `participantId:stepId` | 완료된 각 단계 1행. 원응답 해시가 같으면 재사용, 다르면 `RESPONSE_CONFLICT`. |
| `Trials` | `participantId:stepId` | `baseline`·`jump`만 1행씩. 동일 키 재시도 중복 금지. |
| `Conditions` | `participantId:condition` | 다섯 조건의 요약을 갱신. 합계 덧셈이 아닌 전체 유효 응답에서 재계산. |

단일 `ScriptLock`으로 같은 스크립트의 쓰기를 직렬화합니다. 사전 검증·충돌 검사 후 `Responses → Trials → Conditions → Participants` 순서로 기록하고 `flush()`가 완료된 뒤 ACK합니다. 중간 오류 시 시트 일부가 이미 기록되어 있을 수 있으며, **동일 스냅샷 재시도로 누락된 행·요약을 채우도록** 설계했습니다. Google Sheets의 여러 탭을 하나의 데이터베이스 트랜잭션으로 만드는 것은 아닙니다.

과거 응답 값·타임스탬프를 바꾸어 재시도하면 충돌로 거부합니다. 자동 덮어쓰기나 충돌 버전 관리 기능은 없습니다. 운영 시트를 여러 Apps Script 프로젝트로 동시에 쓰거나 헤더·키·자료를 수동 편집하면 이 보장을 유지할 수 없습니다. 자료 정정은 연구 책임자의 별도 절차로 관리하고, 서버 검증을 피하려고 새 ID를 만들어 이중 등록하지 마세요.

이전 스냅샷을 늦게 다시 보내도 더 진행된 기록을 지우지 않습니다. ACK는 요청의 불변 응답이 수집되어 있음을 뜻하며, 과거 메모·상태로 최신 참여자 행을 되돌렸다는 뜻은 아닙니다. 완료·철회된 참여자는 최신 요청으로도 조용히 활성 상태로 재개할 수 없습니다.

모든 셀은 일반 텍스트 형식으로 쓰며, 문자열이 `=`, `+`, `-`, `@`, 탭(`\t`), 캐리지리턴(`\r`)으로 시작하면 작은따옴표로 이스케이프합니다. JSON도 같은 쓰기 경로를 거치고 셀 전체가 텍스트로 보존됩니다. JSON 내부 문자열을 별도 프로그램에서 셀로 다시 풀어 쓸 때는 그 프로그램에서도 수식 주입 방어가 필요합니다.

## 6. 시트 데이터 사전

헤더의 실제 순서는 [`HEADERS`](Code.gs)가 기준입니다. 필드명은 분석 호환성을 위해 영문으로 고정합니다. 모든 시각은 UTC ISO 문자열입니다. 빈칸은 해당 없음 또는 결측이며, 해석은 `kind`, `validity`, `missing_reason`, `recorded_n`과 함께 합니다.

### Participants — 참여자당 1행

```text
participant_id, participant_code, group, is_demo, researcher,
created_at_utc, consent_confirmed, eligibility_confirmed, protocol_reviewed,
protocol_version, question_version, session_order, focus_order,
step_index, status, response_count, started_at_utc, ended_at_utc, notes,
last_submission_id, last_sent_at_utc, received_at_utc,
baseline_max_cm, baseline_mean_cm, baseline_valid_n,
lowHF_max_cm, lowHF_mean_cm, lowHF_valid_n,
lowEF_max_cm, lowEF_mean_cm, lowEF_valid_n,
highHF_max_cm, highHF_mean_cm, highHF_valid_n,
highEF_max_cm, highEF_mean_cm, highEF_valid_n,
high_difference_cm, identity_hash
```

- `session_order`: 예 `low>high`. `focus_order`: A군 예 `v1:HF>EF|v2:EF>HF`.
- `step_index`: 다음 진행 위치(0 기반). `response_count`: 수집된 완료 단계 수. `status`: `active`, `completed`, `withdrawn`.
- `started_at_utc`, `ended_at_utc`: 처음/마지막 **기록 응답**의 시각. 중도 진행·철회 상태에서는 전체 완료 시각이 아닙니다.
- `last_submission_id`, `last_sent_at_utc`, `received_at_utc`: 최신으로 반영된 참여자 스냅샷의 요청 ID·전송·수신 시각. 모든 요청의 감사 로그가 아닙니다.
- `*_max_cm`, `*_mean_cm`, `*_valid_n`: 조건별 유효 기록 최댓값·소수 둘째 자리 평균·유효 시행 수.
- `high_difference_cm`: **고압박 HF 최댓값 − 고압박 EF 최댓값**. 어느 쪽이든 유효 기록이 없으면 빈칸.
- `identity_hash`: 불변 식별·배정·동의 필드의 충돌 검사 해시. 익명화나 개인정보 암호화 수단이 아닙니다.

### Responses — 완료 응답 단계당 1행

```text
response_key, participant_id, participant_code, group,
protocol_version, question_version, session_order, focus_order,
step_index, step_id, kind, visit, pressure, focus, block, trial,
started_at_utc, ended_at_utc,
cognitive_anxiety, somatic_anxiety, self_confidence,
focus_adherence, internal_focus, evaluation_pressure,
distance_cm, validity, reason, missing_reason, values_json, response_hash, identity_hash
```

- `step_index`: 응답이 속한 단계 위치(0 기반). `visit`: 사전 0, 방문 1·2. `block`, `trial`: 해당하는 경우 1·2, 그 외 빈칸.
- `pressure`: `low`/`high` 또는 빈칸. `focus`: `HF`/`EF` 또는 빈칸.
- `values_json`: 단계 완료 시 응답 값 객체를 정렬된 키의 JSON 텍스트로 보존합니다. 안내 확인·휴식 기록 등도 여기에 포함되며 원시 클릭 이벤트가 아닙니다.
- 개별 점수 열은 해당 종류의 설문에서만 사용합니다. **`self_confidence`는 높을수록 자신감이 높음**이며 기본 역채점·총점이 없습니다.
- `missing_reason`: 설문 결측 등의 응답 수준 사유. `reason`: 점프 시행의 무효·결측 사유 또는 메모.
- `response_hash`: 타임스탬프·맥락·값을 포함한 불변 응답의 충돌 검사 해시입니다. 수정 이력 로그가 아닙니다.
- 완료 화면 자체는 응답 행을 추가하지 않습니다. 현재 프로토콜 전체 완료 시 준비·안내·휴식 등까지 합해 30개 응답 행입니다.

### Trials — 사전·조건 점프당 1행

```text
trial_key, participant_id, participant_code, group,
protocol_version, question_version, session_order, focus_order,
step_index, step_id, kind, visit, pressure, focus, block, trial,
started_at_utc, ended_at_utc, distance_cm, validity, reason, response_hash, identity_hash
```

사전 2회 + 본 실험 8회로 전체 완료 시 최대 10행입니다. 무효·결측도 행을 보존합니다. `validity = valid`만 거리 요약에 포함하며 무효·결측의 거리 셀은 빈칸입니다.

### Conditions — 참여자당 다섯 조건 요약

```text
condition_key, participant_id, participant_code, group,
protocol_version, question_version, session_order, focus_order,
condition, visit, pressure, focus, block,
max_cm, mean_cm, valid_n, recorded_n, started_at_utc, ended_at_utc
```

`condition`은 `baseline`, `lowHF`, `lowEF`, `highHF`, `highEF`입니다. `valid_n`은 유효 시행 수, `recorded_n`은 무효·결측 포함 기록 수입니다. 아직 수행 전인 조건도 요약 행이 존재하며 이때 두 수는 0, 거리·시간은 빈칸입니다. 조건 시각은 해당 점프 기록의 처음·마지막 시각이며 블록 안내·휴식까지 포함한 시간이 아닙니다.

기본 요약은 기술통계이며 개인 1명의 HF–EF 차이로 비열등성을 추론하지 않습니다. 문항과 해석 원칙은 [측정 가이드](../docs/MEASUREMENT_GUIDE.md)를 참조하세요.

## 7. 오류 대응

| 오류 코드 / 화면 | 점검·조치 |
|---|---|
| `UNCONFIRMED` | 저장 실패로 단정하지 말고 시트부터 확인. 동일 ID·불변 응답 재시도. CORS·HTML 로그인 응답·리디렉션·기관 정책 확인. |
| `NOT_CONFIGURED`, `SETUP_REQUIRED` | `setup()` 실행 및 두 Script Properties 확인. 코드 값을 로그에 출력하지 않음. |
| `UNAUTHORIZED` | 수집 코드를 비공개 경로로 확인. 요청·응답 본문을 공개 게시하지 않음. |
| `DEMO_REJECTED` | 예상된 보호 동작. 데모는 운영 수집 불가; 합성 일반 참여자 시험은 별도 테스트 시트 사용. |
| `SCHEMA_VERSION`, `PROTOCOL_VERSION` | 앱·Apps Script 버전 동시 확인. 버전 문자열만 바꿔 구버전 자료를 강제 통과시키지 않음. |
| `STEP_INDEX`, `RESPONSE_ORDER`, `RESPONSE_TIME`, `INVALID_STATUS` | 원본 JSON과 실제 진행·기기 시계 확인. 손상 자료를 임의 수정해 재전송하지 않음. |
| `SCORE_RANGE`, `TRIAL_DISTANCE`, `TRIAL_REASON`, `MISSING_REASON` | 범위·결측값·사유를 원기록과 대조. 기존 수집 응답 수정은 별도 정정 절차 필요. |
| `RESPONSE_CONFLICT`, `TRIAL_CONFLICT`, `PARTICIPANT_CONFLICT`, `STATUS_CONFLICT` | 자동 덮어쓰기 중단. 같은 ID의 과거 내용·배정·완료 상태 변경 여부 조사. |
| `PARTICIPANT_CODE_CONFLICT` | 같은 코드가 다른 내부 ID로 재등록됐는지 확인. 원래 JSON 백업을 가져오기. |
| `BUSY_RETRY`, `WRITE_FAILED_RETRY` | 잠시 후 동일 스냅샷 재시도. Apps Script 실행 현황·할당량 점검. 실패해도 이미 쓴 행이 있을 수 있음. |
| `SHEET_HEADERS`, `SHEET_DUPLICATE_KEY`, `SHEET_HISTORY` | 탭·헤더·고유 키·수동 편집 여부를 관리자에게 점검 요청. 빈 시트로 조용히 대체하지 않음. |
| `BODY_TOO_LARGE`, `SHEET_CAPACITY` | 요청 128 KiB, 탭별 헤더 포함 50,000행 제한. 안전하게 백업하고 승인된 확장 계획 수립. |

Apps Script 실행 예외 원문은 클라이언트에 노출하지 않습니다. 연구자료를 `Logger`나 공개 디버그 로그에 쓰지 마세요. 이 수집기는 대규모 데이터베이스가 아니며 요청마다 탭의 키를 읽어 검사하므로 자료량·동시 사용이 늘면 할당량·응답시간 검토가 필요합니다.

## 8. 로컬 모의 테스트

저장소 루트에서 실행합니다.

```sh
npm ci
npm test
# 수집기만:
node --import tsx --test tests/apps-script.test.ts
```

[`tests/apps-script.test.ts`](../tests/apps-script.test.ts)는 A–D 단계 일치, 유효성·동의·데모 거부, 시트 요약, 불변 응답 충돌, 동일 재시도, 모든 쓰기 경계의 중간 실패 복구, `flush` 실패 시 ACK 금지, 과거 스냅샷, 수식 주입 방어 등을 모의 시험합니다. 실제 Google 배포·권한·브라우저 CORS는 4절의 별도 현장 시험이 필요합니다.
