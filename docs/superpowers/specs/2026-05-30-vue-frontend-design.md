# Vue フロントエンド + PIN ペアリング認証 — 設計

- 日付: 2026-05-30
- 対象: `yot` カレンダーバックエンド（Hono + Zod OpenAPI + SQLite）に Web フロントエンドを追加する

## 目的

既存の REST API（`/api/*`）と SSE フィード（`/api/stream`）を操作する、単一ユーザー向けのカレンダー Web UI を追加する。カレンダービューとリストビューの両方を提供し、認証は API キーを直接扱わせない PIN ペアリング方式とする。

## 確定事項（要件）

- **スタック**: Vue 3 + Vite + Tailwind CSS + Vue Router（SPA）
- **カレンダー UI**: Schedule-X（Vue 3 公式アダプタ、月/週/日ビュー）
- **構成**: 構成 A — プロジェクトルートに独立した `web/` Vite プロジェクト。バックエンドの `package.json` / `tsconfig.json` は変更しない
- **ホスティング**: ハイブリッド。開発時は Vite dev server + proxy（`/api` → `localhost:4010`）、本番は `web/dist/` を Hono が静的配信
- **ビュー**: カレンダービュー + リストビュー（両方）、SPA ルーティング
- **認証**: PIN ペアリング。`npm run auth` が PIN を表示 → ブラウザで入力 → 正解なら API キーを HttpOnly cookie に格納
- **セッション有効期限**: 無期限（cookie は長期 Max-Age、API キー自体も無期限という既存挙動を踏襲）
- **scope**: `npm run auth` 実行時に read/write を選択

## アーキテクチャ

```
web/ (Vue SPA, dev: :5173)                 src/ (Hono backend, :4010)
  ├─ views (Calendar/List/Pair)              ├─ rest/auth.ts (pair/logout/session/pin)
  ├─ composables (calendars/events/           ├─ auth/pairing.ts (in-memory PIN Map)
  │   tags/sse/auth, Pinia なし)              ├─ auth/middleware.ts (+cookie 読み取り)
  ├─ api/client.ts (cookie 認証 fetch)        ├─ auth/rate-limit.ts
  └─ @yot/schemas/* (型のみ import) ─────────▶ src/schemas/*（共有）
        │ dev: Vite proxy                     └─ index.ts (静的配信 + SPA fallback)
        │ prod: 静的配信
        ▼
   REST /api/*  ·  SSE /api/stream（いずれも cookie 認証）
```

## 認証フロー（DB テーブル不要・インメモリ）

`npm run auth` は稼働中サーバーとは別プロセスだが、DB を介さずに**認証済み HTTP エンドポイント経由でサーバーのメモリに PIN を登録**する。これにより PIN はサーバープロセス内の `Map` で完結し、スキーマ変更も期限切れ掃除も不要。

```
1. npm run auth
   - .env の YOT_API_KEY と PORT を読む
   - read/write を選択
   - POST /api/auth/pin (Authorization: Bearer <key>) { scope }
       サーバー: 6桁PIN生成 → Map<pin_hash, {scope, expires_at}> に保存（5分有効）
                 要求 scope ≤ 認証キーの scope を強制（権限昇格防止）→ 生PIN返却
   - ターミナルに PIN を表示（@clack/prompts note）

2. ブラウザ /pair で PIN 入力 → POST /api/auth/pair { pin }（公開エンドポイント）
   サーバー: pin_hash 照合・未期限確認 → Map から即削除（ワンタイム）
           → apiKeys.create("web", scope) で新規キー発行（生キーはサーバー内に留まる）
           → Set-Cookie: yot_session=<生キー>; HttpOnly; SameSite=Strict; Path=/;
                          Max-Age=<長期>; Secure(https時のみ)
           → { ok: true, scope }

3. 以降のリクエストは cookie で認証。SSE も EventSource が cookie を自動送信（?key= 廃止）

4. POST /api/auth/logout → cookie のキーを revoke + cookie 削除
```

- **レート制限**: `/api/auth/pair` に IP 単位のインメモリ制限（5回失敗/分でロック）。6桁 PIN + 5分期限 + ワンタイム + レート制限で総当たりを実質不可能にする
- **Secure フラグ**: localhost http 開発で cookie が落ちないよう、リクエストが https のときのみ付与

## バックエンド変更（src/）

| ファイル | 変更内容 |
|---|---|
| `src/auth/pairing.ts`（新規） | `PairingService`: インメモリ `Map`。`createPin(scope)` / `redeem(pin)`（照合・削除・期限切れ除外）。`hashKey` を再利用 |
| `src/auth/rate-limit.ts`（新規） | IP 単位の簡易インメモリレート制限ヘルパ |
| `src/auth/middleware.ts` | `extractRawKey` に cookie(`yot_session`) 読み取りを追加。優先順位: Authorization → x-api-key → cookie → query。query フォールバックは SSE が cookie で動くため削除を検討 |
| `src/rest/auth.ts`（新規） | 公開: `POST /api/auth/pair`・`POST /api/auth/logout`。認証後: `POST /api/auth/pin`・`GET /api/auth/session` |
| `src/rest/app.ts` | auth ルート登録（pair/logout は認証ゲートより前、pin/session は後） |
| `src/services/container.ts` | `PairingService` を `createServices` に追加 |
| `src/index.ts` | `@hono/node-server/serve-static` で `web/dist` を配信 + SPA フォールバック（未マッチ GET → `index.html`）。旧 `app.get("/", INDEX_HTML)` を置換 |
| `src/web/page.ts` | 廃止（削除）。Vue アプリが置き換える |

## CLI スクリプト

| ファイル | 内容 |
|---|---|
| `scripts/auth.ts`（新規） | `.env` の `YOT_API_KEY`/`PORT` を読み、scope を選択、`POST /api/auth/pin` を呼んで PIN を表示。サーバー未起動なら分かりやすくエラー |
| `package.json` | `"auth": "tsx scripts/auth.ts"` を追加 |

## フロントエンド（web/ 新規）

| 領域 | 内容 |
|---|---|
| 雛形 | `web/package.json`（vue, vue-router, @schedule-x/*, tailwindcss v4 + @tailwindcss/vite, vite, @vitejs/plugin-vue, typescript）、`vite.config.ts`（plugin-vue + tailwind, proxy `/api`→4010）、`tsconfig.json`（`paths`: `@yot/schemas/*`→`../src/schemas/*`、型のみ）、`index.html`, `src/main.ts`, `src/App.vue`, `src/style.css` |
| API クライアント | `src/api/client.ts`: `credentials: "include"` の fetch ラッパー。401 → `/pair` へ。型は `@yot/schemas` から推論 |
| Composables | `useCalendars`/`useEvents`/`useTags`（CRUD, `ref()`, Pinia なし）、`useSSE`（`EventSource("/api/stream")`、`*.created/updated/deleted` でリフェッチ、接続状態 ref、自動再接続）、`useAuth`（pair/logout/session） |
| ルーティング | `src/router.ts`: `/`→CalendarView, `/list`→ListView, `/pair`→PairView。ガードで未認証は `/pair` へ |
| ビュー/コンポーネント | `PairView`（PIN 入力）、`CalendarView`（Schedule-X）、`ListView`（フィルタ: calendar/tag/期間/検索）、`Sidebar`（カレンダー一覧・表示切替・SSE 状態）、`EventForm`/`CalendarForm`/`TagManager` |
| ルート package.json | `"web:dev"`, `"web:build"` を追加、`"build": "tsc && npm --prefix web run build"` |

## テスト

- `src/auth/pairing.test.ts`: createPin → redeem 成功 / 二重 redeem 失敗 / 期限切れ失敗 / scope 反映
- `src/rest/auth.test.ts`: pin 発行（scope 昇格拒否）/ pair で cookie セット / 無効 PIN で 401 / レート制限 / logout で revoke
- フロントは初期段階では手動確認（必要に応じて後追いでコンポーネントテスト）

## 非対象（YAGNI）

- 複数ユーザー / 共有カレンダー
- npm workspaces や turborepo 等のモノレポツール
- Pinia 等の外部状態管理
- OpenAPI からの型自動生成（直接 import で十分）

## 未解決事項

なし（全決定確定済み）。
