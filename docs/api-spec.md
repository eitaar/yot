# yot API 仕様書

フロントエンド(`web/`)とバックエンド(`src/`)をつなぐ HTTP API の仕様。
すべてのエンドポイントは `/api` 配下にあり、通信は JSON over HTTP + SSE 1本のみ。
コードの共有はなく、この契約だけがフロントとバックの結合点である。

実装の対応箇所: ルート定義は `src/rest/`、スキーマは `src/schemas/`、
フロント側クライアントは `web/src/api/client.ts`。
OpenAPI ドキュメントは稼働中のサーバーの `GET /api/doc`(JSON)と
`GET /api/ui`(Swagger UI)からも取得できる。

---

## 1. 共通仕様

### ベース URL

```
/api
```

フロントは same-origin で `fetch("/api...", { credentials: "include" })` を使う。
バックエンドは `web/dist` を静的配信しているため、通常は同一オリジンになる。

### 認証

単一ユーザー前提の API キー認証。キーは以下の順で解決される
(`src/auth/middleware.ts`):

1. `Authorization: Bearer <key>` ヘッダー(`Bearer` なしの生値も可)
2. `X-Api-Key: <key>` ヘッダー
3. Cookie `yot_session`(Web フロントはこれを使用)
4. クエリ `?key=<key>`(ヘッダーを付けられない `EventSource` 用のフォールバック)

キーには **スコープ** がある:

| スコープ | 権限 |
|---|---|
| `read` | GET / HEAD / OPTIONS のみ |
| `write` | すべてのメソッド |

`read` キーで変更系メソッドを呼ぶと `403 forbidden`。
認証失敗は `401 unauthorized`(レスポンスに `WWW-Authenticate: Bearer realm="yot"`)。

**認証不要(公開)エンドポイント**: `GET /health`, `GET /doc`, `GET /ui`,
`POST /auth/pair`, `POST /auth/logout`。それ以外はすべて認証必須。

### エラーレスポンス

すべてのエラーは統一フォーマット:

```json
{
  "error": {
    "code": "not_found",
    "message": "Not found",
    "details": [ ... ]   // validation_error のときのみ(Zod issues 配列)
  }
}
```

| HTTP | code | 意味 |
|---|---|---|
| 400 | `validation_error` | リクエストボディ/クエリの検証失敗 |
| 401 | `unauthorized` | API キー欠落・無効、PIN 無効 |
| 403 | `forbidden` | read キーでの書き込み |
| 404 | `not_found` | リソースなし |
| 409 | `conflict` | 一意制約違反(タグ名重複など) |
| 429 | `rate_limited` | `/auth/pair` の試行超過 |
| 500 | `internal_error` | 想定外のサーバーエラー |

### 日時フォーマット

すべての日時は ISO 8601 UTC 文字列(例: `2026-05-29T11:00:00.000Z`)。

---

## 2. データモデル

### Calendar

```jsonc
{
  "id": "string",
  "name": "Work",
  "color": "#3b82f6",        // string | null
  "description": "string | null",
  "created_at": "ISO8601",
  "updated_at": "ISO8601"
}
```

### Event

```jsonc
{
  "id": "string",
  "calendar_id": "string",
  "title": "Team sync",
  "description": "string | null",
  "context": "string | null",       // AI 向けの補足情報（駐車場、料金、評判など自由形式）
  "location": "string | null",
  "start_at": "ISO8601",
  "end_at": "ISO8601",
  "all_day": false,
  "image_path": "string | null",   // /api/img/{image_path} で取得できるファイル名
  "url": "string | null",
  "source_uid": "string | null",   // ICS インポート元の UID
  "created_at": "ISO8601",
  "updated_at": "ISO8601",
  "tags": ["important"],           // タグ「名」の配列(ID ではない)
  "reminders": [ /* Reminder[] */ ]
}
```

### Reminder

```jsonc
{
  "id": "string",
  "event_id": "string",
  "minutes_before": 10,            // 0 以上の整数
  "method": "notification"
}
```

### Tag

```jsonc
{
  "id": "string",
  "name": "important",
  "color": "#ef4444"               // string | null
}
```

---

## 3. エンドポイント

### 3.1 メタ(公開)

| メソッド/パス | 説明 | レスポンス |
|---|---|---|
| `GET /health` | 死活確認 | `200` `{ "status": "ok" }` |
| `GET /doc` | OpenAPI 3.0 ドキュメント(JSON) | `200` |
| `GET /ui` | Swagger UI(HTML) | `200` |

### 3.2 認証

#### `POST /auth/pair` (公開)

PIN を API キーに引き換える。Web フロントとネイティブクライアント両方のログイン手段。

- ボディ:
  ```jsonc
  {
    "pin": "string",
    "client": "web" | "native",  // 省略時 "web"
    "device_name": "string"      // 任意。キー名として記録(64 文字まで)
  }
  ```
- 成功 `200`(`client` 省略時・`"web"`): `{ "ok": true, "scope": "read" | "write" }`
  - `Set-Cookie: yot_session=<key>; HttpOnly; SameSite=Strict; Path=/; Max-Age=34560000`
    (HTTPS 接続時のみ `Secure` 付与)
- 成功 `200`(`client: "native"`): `{ "ok": true, "scope": "read" | "write", "key": "cal_..." }`
  - Cookie は発行しない。クライアントは `key` を保存し `Authorization: Bearer` で送る
- `device_name` 省略時のキー名は `client` に応じて `web` / `native`
- 失敗: `401`(PIN 無効/期限切れ)、`429`(IP ごとのレート制限超過)

#### `POST /auth/logout` (公開)

提示された API キーを失効させ、Cookie を削除する。
キーは `Authorization` ヘッダー・`X-Api-Key`・`yot_session` Cookie のいずれからでも受け付ける
(`?key=` クエリは対象外)。

- 成功 `200`: `{ "ok": true }`(キーが提示されなくても 200)

#### `POST /auth/pin` (要認証)

新しいペアリング PIN を発行する(別デバイスの追加用)。

- ボディ: `{ "scope"?: "read" | "write" }`(省略時 `write`。
  呼び出しキーが `read` の場合は要求に関わらず `read` に降格)
- 成功 `200`: `{ "pin": "string", "scope": "read" | "write", "expires_in": 300 }`

#### `GET /auth/session` (要認証)

現在のセッションのスコープを返す。フロントの起動時チェックに使用。

- 成功 `200`: `{ "scope": "read" | "write" }`

### 3.3 カレンダー

| メソッド/パス | ボディ | 成功 | エラー |
|---|---|---|---|
| `GET /calendars` | — | `200` `Calendar[]` | |
| `POST /calendars` | CreateCalendar | `201` `Calendar` | 400 |
| `GET /calendars/{id}` | — | `200` `Calendar` | 404 |
| `PATCH /calendars/{id}` | UpdateCalendar | `200` `Calendar` | 400, 404 |
| `DELETE /calendars/{id}` | — | `204` | 404 |

- **CreateCalendar**: `{ name: string(必須, 1文字以上), color?: string, description?: string }`
- **UpdateCalendar**: 全フィールド任意。`color` / `description` は `null` を渡すとクリア。

### 3.4 イベント

| メソッド/パス | ボディ | 成功 | エラー |
|---|---|---|---|
| `GET /events` | —(クエリ後述) | `200` `Event[]` | |
| `POST /events` | CreateEvent | `201` `Event` | 400 |
| `GET /events/{id}` | — | `200` `Event` | 404 |
| `PATCH /events/{id}` | UpdateEvent | `200` `Event` | 400, 404 |
| `DELETE /events/{id}` | — | `204` | 404 |

**`GET /events` のクエリパラメータ**(すべて任意):

| パラメータ | 型 | 説明 |
|---|---|---|
| `calendarId` | string | カレンダー ID で絞り込み |
| `from` | ISO8601 | `start_at` の下限(inclusive) |
| `to` | ISO8601 | `start_at` の上限(inclusive) |
| `tag` | string | このタグ「名」を持つイベントに絞り込み |
| `q` | string | タイトルと説明の部分一致検索 |
| `limit` | int 1–500 | 既定 50 |
| `offset` | int ≥0 | 既定 0 |

- **CreateEvent**: `{ calendar_id: string, title: string, start_at: ISO8601, end_at: ISO8601, all_day?: boolean(既定 false), description?, context?, location?, url?, image_path?: string }`
- **UpdateEvent**: 全フィールド任意。nullable なフィールド
  (`description`, `context`, `location`, `url`, `image_path`)は `null` でクリア。
  ※フロントの `EventUpdate` 型は `tags: string[]` も送るが、REST の
  `UpdateEventSchema` には `tags` がなく無視される(タグ操作は下記の専用ルートを使う)。

#### リマインダー(サブリソース)

| メソッド/パス | ボディ | 成功 | エラー |
|---|---|---|---|
| `POST /events/{id}/reminders` | CreateReminder | `201` `Reminder` | 404 |
| `DELETE /events/{id}/reminders/{rid}` | — | `204` | 404 |

- **CreateReminder**: `{ minutes_before: int ≥0, method?: string(既定 "notification") }`

#### タグの付け外し(サブリソース)

| メソッド/パス | 成功 | エラー |
|---|---|---|
| `POST /events/{id}/tags/{tagId}` | `200` 更新後の `Event` | 404(イベントまたはタグなし) |
| `DELETE /events/{id}/tags/{tagId}` | `200` 更新後の `Event` | 404 |

### 3.5 タグ

| メソッド/パス | ボディ | 成功 | エラー |
|---|---|---|---|
| `GET /tags` | — | `200` `Tag[]` | |
| `POST /tags` | CreateTag | `201` `Tag` | 400, 409(名前重複) |
| `PATCH /tags/{id}` | UpdateTag | `200` `Tag` | 400, 404, 409 |
| `DELETE /tags/{id}` | — | `204` | 404 |

- **CreateTag**: `{ name: string(必須), color?: string }`
- **UpdateTag**: 全フィールド任意。`color: null` でクリア。

### 3.6 画像アップロード・配信

OpenAPI ドキュメント対象外の plain ルート(`src/rest/uploads.ts`)。

#### `POST /uploads/image`

- リクエスト: `multipart/form-data`、フィールド名 `file`
- 成功 `201`: `{ "path": "string" }`(保存されたファイル名。
  `Event.image_path` にそのまま設定して使う)
- 失敗: `400`(`file` フィールドなし)

#### `POST /uploads/image-from-url`

- ボディ: `{ "url": "string" }` — サーバー側が URL から画像を取得して保存
- 成功 `201`: `{ "path": "string" }`
- 失敗: `400`

#### `GET /img/{file}`

保存済み画像の配信。

- 成功 `200`: 画像バイナリ(`Content-Type` は保存時の MIME、
  `Cache-Control: private, max-age=31536000, immutable`)
- 失敗: `404`(ボディなし)

### 3.7 ICS インポート

#### `POST /events/import`

- リクエスト: `multipart/form-data`
  - `file`: .ics ファイル(最大 10 MB)
  - `calendar_id`: インポート先カレンダー ID
- 成功 `200`:

```json
{
  "created": 12,
  "skippedRecurring": 3,
  "skippedDuplicate": 5,
  "errors": ["..."]
}
```

- 失敗: `400`(フィールド不足・サイズ超過)、`404`(カレンダーなし)

### 3.8 リアルタイム更新(SSE)

#### `GET /stream`

Server-Sent Events。全変更イベントをリアルタイム配信する。
ブラウザは `new EventSource("/api/stream", { withCredentials: true })` で接続
(Cookie 認証。ヘッダーを付けられないクライアントは `?key=` を使う)。

フレーム形式: SSE の `event:` が変更種別、`data:` が JSON。

```
event: event.created
data: {"id":"...","title":"...", ...}
```

**イベント種別一覧**:

| event | data |
|---|---|
| `ready` | `"connected"`(接続直後に 1 回) |
| `ping` | epoch ミリ秒文字列(25 秒間隔のハートビート) |
| `event.created` | `Event` 全体 |
| `event.updated` | `Event` 全体(タグ・リマインダー変更時も発火) |
| `event.deleted` | `{ "id": "string" }` |
| `calendar.created` | `Calendar` 全体 |
| `calendar.updated` | `Calendar` 全体 |
| `calendar.deleted` | `{ "id": "string" }` |
| `tag.created` | `Tag` 全体 |
| `tag.updated` | `Tag` 全体 |
| `tag.deleted` | `{ "id": "string" }` |

接続維持のための実装上の注意: 接続直後に約 2 KB のパディングコメントを送出して
プロキシのバッファリングを回避し、`X-Accel-Buffering: no` と
`Cache-Control: no-cache, no-transform` を付与している。

### 3.9 内部リレー(フロント非使用)

#### `POST /internal/events`

MCP プロセス(stdio)からの変更イベントを HTTP サーバーのイベントバスへ中継し、
SSE でファンアウトさせるための内部エンドポイント。要認証。

- ボディ: `{ "type": "xxx.yyy"(正規表現 ^[a-z]+\.[a-z]+$), "data": any }`
- 成功 `204`
- 失敗: `400`

---

## 4. フロントエンドが使用するエンドポイント一覧

`web/src/api/client.ts` が実際に呼ぶのは以下(参照実装として):

- 認証: `GET /auth/session`, `POST /auth/pair`, `POST /auth/logout`
- カレンダー: `GET /calendars`, `POST /calendars`, `PATCH /calendars/{id}`
- イベント: `GET /events`, `POST /events`, `GET /events/{id}`,
  `PATCH /events/{id}`, `DELETE /events/{id}`,
  `POST|DELETE /events/{id}/tags/{tagId}`
- タグ: `GET /tags`, `POST /tags`, `PATCH /tags/{id}`, `DELETE /tags/{id}`
- 画像: `POST /uploads/image`, `POST /uploads/image-from-url`, `GET /img/{file}`
- インポート: `POST /events/import`
- SSE: `GET /stream`(`web/src/composables/useSSE.ts`)

フロントは 401 を受けると登録済みハンドラでログイン画面へ誘導する
(`setUnauthorizedHandler`)。`204` はボディなしとして扱う。

リマインダー操作(`POST /events/{id}/reminders` 等)と
`DELETE /calendars/{id}`, `GET /calendars/{id}` は REST に存在するが
現状 Web フロントからは未使用(MCP 経由で使用される)。
