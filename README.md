# Sky Turbo

Sky Turbo 是 Hypixel SkyBlock 的即時市場分析工具，整合 Bazaar、Shard Fusion、Craft、NPC、Auction House 與價格異常監測。正式站點：[bz.friedturtleee.me](https://bz.friedturtleee.me)。

> 本專案只提供市場估算，不保證掛單成交、Fusion RNG 或實際收益；與 Hypixel Inc.、Mojang 或 Microsoft 無關，也未獲其背書。

## 功能

- **Bazaar Flip**：稅後價差、CPH、成交量、波動率、前 30 檔深度與價格歷史。
- **Skyblock Index / Crashing**：市場指數與 24 小時異常下跌商品。
- **Shard Flip**：四種買賣策略、遞迴 Fusion 路徑、整數原料、Crocodile EV、掛單深度與 Max Fusion。
- **Craft Flip**：使用固定 commit 的 NEU recipes，計算單次與可見深度最大收益。
- **NPC Flip**：Bazaar／AH 出場價格、NPC 每日上限、市長與 Derpy／Diaz 特例。
- **AH Flip**：解析完整 NBT，估算寶石、附魔、Reforge、星級、Pet 與 Attribute 等價值。
- **Bookmarks 與偏好**：無登入時存在瀏覽器；啟用 Clerk 後同步至 Cloudflare D1。
- **繁體中文／英文介面**。

## 技術架構

這是一個 pnpm monorepo：

```text
apps/web       Next.js 16 網站與公開 API（部署於 Vercel）
apps/worker    Cloudflare Worker、Cron、D1 儲存與 Clerk JWT 驗證
packages/core  市場、Shard、Craft、NPC、AH 與歷史資料的共用計算核心
scripts        資料同步、歷史回填、AH 收集與 live smoke test
```

行情流程：

```text
Hypixel API -> Cloudflare Cron -> Vercel internal ingest -> Worker/D1
      \---------------- public API fallback ----------------/
Browser -> Next.js API/UI -> Worker history/bookmarks
```

Worker 只負責排程、持久化與個人資料；市場正規化與主要計算在 Web／Core 完成。若未設定 D1，Bazaar 功能仍可直接使用 Hypixel 即時資料。

更完整的產品與公式說明請見 [PROJECT_MASTER_DOCUMENT.md](./PROJECT_MASTER_DOCUMENT.md) 與 [SPECIFICATION.md](./SPECIFICATION.md)。

## 系統需求

- Node.js `>=20.9.0`
- pnpm `10.32.1`（建議使用 Corepack）
- 選用：Cloudflare、Vercel、Clerk 帳號

## 本機開發

```bash
corepack enable
pnpm install --frozen-lockfile
```

複製 `.env.example` 為 `.env.local`，至少保留以下本機值：

```dotenv
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_EDGE_API_URL=http://localhost:8787
INGEST_SECRET=請替換成高熵隨機值
```

如需登入同步，再設定 `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` 與 `CLERK_SECRET_KEY`。不要將 `.env.local`、`apps/worker/.dev.vars` 或任何真實 token 提交到 Git。

啟動 Web：

```bash
pnpm dev
```

啟動本機 Worker／D1：

```bash
pnpm --filter @sky-turbo/worker exec wrangler d1 migrations apply sky-turbo --local
pnpm dev:worker
```

Worker 的本機 secret 放在 `apps/worker/.dev.vars`：

```dotenv
INGEST_SECRET=與 Web 相同的高熵隨機值
ALLOWED_ORIGIN=http://localhost:3000
VERCEL_INGEST_URL=http://localhost:3000/api/v1/internal/ingest
```

如需在本機測試 Clerk，同一檔案也要用本機 Clerk instance 覆寫 `CLERK_ISSUER` 與 `CLERK_JWKS_URL`，讓 `azp`／issuer 驗證與 localhost 一致。

## 環境變數

| 名稱 | 必要性 | 用途 |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | 建議 | Web 公開 URL。 |
| `NEXT_PUBLIC_EDGE_API_URL` | 使用 Worker 時必要 | Worker 公開 URL；會暴露給瀏覽器，不能包含秘密。 |
| `INGEST_SECRET` | 寫入 D1 時必要 | 保護 Vercel ingestion 與 Worker internal routes；兩端必須相同。 |
| `INGEST_SECRET_FILE` | 選用 | 回填腳本從 gitignored 檔案讀 secret。 |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | 選用 | 啟用 Clerk 前端登入。 |
| `CLERK_SECRET_KEY` | 選用 | Clerk server-side secret。 |
| `COFLNET_API_TOKEN` | 選用 | SkyCofl 授權 token。 |
| `COFLNET_CONTACT` | 使用 SkyCofl 時建議 | API 聯絡識別。 |
| `COFLNET_REQUESTS_PER_MINUTE` | 選用 | 回填器速率，預設 `90`。 |
| `COFLNET_USAGE_APPROVED` | 選用 | 只有取得資料儲存／使用許可後才設為 `true`。 |
| `AH_SCAN_MAX_PAGES` | 選用 | 限制 AH 完整掃描頁數。 |
| `AH_BOOTSTRAP_MAX_PAGES` | 選用 | 首次快速掃描頁數，預設 `2`。 |
| `AH_CANDIDATE_LIMIT` | 選用 | 每次 AH 候選估價上限。 |
| `AH_RESULT_LIMIT` | 選用 | AH API 回傳結果上限。 |

Cloudflare 非秘密設定（`ALLOWED_ORIGIN`、`VERCEL_INGEST_URL`、`CLERK_ISSUER`、`CLERK_JWKS_URL`）位於 `apps/worker/wrangler.jsonc`，自行部署前必須改成自己的網域與 Clerk instance。

## 常用指令

```bash
pnpm dev                 # Next.js dev server
pnpm dev:worker          # Cloudflare Worker dev server
pnpm test                # 全部單元測試
pnpm typecheck           # 全 monorepo 型別檢查
pnpm lint                # 各 workspace lint/type lint
pnpm build               # Core + Web + Worker dry-run build
pnpm smoke:live          # 使用 Hypixel live API 的基本煙霧測試
pnpm sync:flip-data      # 更新 Shard、NPC、Craft 與圖示資料
```

其他資料作業：

```bash
pnpm backfill            # Bazaar 歷史回填
pnpm backfill:ah-history # AH 歷史回填
pnpm collect:ah          # 收集並發布 AH Flip snapshot
```

## Shard Fusion 資料與 Anteater 修正

Shard 資料來自固定 commit 的 [Campionnn/SkyShards](https://github.com/Campionnn/SkyShards)，版本記錄在 `packages/core/data/fusion-source.json`。

Fusion 的兩個輸入槽有順序，不能自動把 `[A, B]` 當成 `[B, A]`。目前資料保留 Anteater 的正確特殊配方：

```text
第一槽 Queen Ant x5 + 第二槽 King Cobra x2 -> Anteater x2
```

一般 ID Fusion、Chameleon Fusion 與 Special Fusion 的產量可能不同；計算器直接採用資料中的輸出數量，不以稀有度猜測。遞迴路徑會先把每一層 Fusion 批次向上取整，再比較完整整數原料成本，避免「平均單價較低、實際一批反而較貴」。同步後的測試會檢查 Anteater 配方、整份資料沒有被錯誤鏡像，以及整數批次的替代路徑選擇。

更新資料時請執行：

```bash
pnpm sync:shards
pnpm --filter @sky-turbo/core test
```

## API 摘要

Web API：

- `GET /api/v1/market/items`
- `GET /api/v1/market/items/:productId`
- `GET /api/v1/market/items/:productId/history?range=1h|1d|1mo|all`
- `GET /api/v1/market/items/:productId/orderbook`
- `GET /api/v1/shard-flips`
- `GET /api/v1/craft-flips`
- `GET /api/v1/npc-flips`
- `GET /api/v1/ah-flips`
- `GET /api/v1/skyblock-index?range=1d|7d|1mo`
- `POST /api/v1/internal/ingest`（Bearer secret）

成功回應為 `{ data, error: null }`；失敗回應為 `{ data: null, error: { message } }`。完整 query 參數與 Edge API 請見 [SPECIFICATION.md](./SPECIFICATION.md)。

## 部署

### Cloudflare Worker

1. 建立自己的 D1 database，將 `apps/worker/wrangler.jsonc` 的 database ID 與公開設定改成自己的資源。
2. 以互動提示設定 secret（不要把 secret 放進指令參數）：

```bash
pnpm --filter @sky-turbo/worker exec wrangler secret put INGEST_SECRET
```

3. 套用 migration、驗證並部署：

```bash
pnpm --filter @sky-turbo/worker exec wrangler d1 migrations apply sky-turbo --remote
pnpm --filter @sky-turbo/worker build
pnpm --filter @sky-turbo/worker exec wrangler deploy
```

### Vercel Web

將 `apps/web` 使用到的環境變數設在 Vercel，並確保：

- `NEXT_PUBLIC_EDGE_API_URL` 指向剛部署的 Worker。
- Web 與 Worker 的 `INGEST_SECRET` 完全相同。
- Worker 的 `VERCEL_INGEST_URL` 指向 Web 的 `/api/v1/internal/ingest`。
- Clerk 啟用時，Worker 的 issuer／JWKS／allowed origin 與實際正式網域一致。

部署前至少執行：

```bash
pnpm audit --prod --audit-level moderate
pnpm test
pnpm typecheck
pnpm build
```

## 安全設計

- `.env*`、`.dev.vars*`、`.secrets/` 與平台設定目錄皆不進版控。
- Internal ingestion 使用 timing-safe Bearer secret 比對；Worker request body 有明確大小上限。
- Clerk JWT 驗證 signature、issuer、演算法、期限與 `azp` authorized party。
- D1 查詢全部使用 prepared statements。
- Web 與 Worker 回應包含防 framing、MIME sniffing、referrer／權限限制等安全標頭。
- 公開 AH endpoint 不接受 cache-bypass 強制掃描，避免被濫用放大上游請求。
- Production API 不回傳原始 exception details。

若發現漏洞，請使用 GitHub 的 private security advisory 回報，不要在公開 issue 貼出 token、可利用細節或使用者資料。已洩漏的 secret 應立即在 Vercel／Cloudflare／Clerk 撤銷並輪替。

## 資料來源、授權與聲明

本專案整合 Hypixel、SkyShards、SkyCofl、NotEnoughUpdates Repository、SkyblockRepo、TradingView Lightweight Charts、Minecraft／Hypixel textures 等第三方資料與資產。各自的來源、授權、固定 commit 與必要聲明列在 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

提交 PR 前請確認同步資料仍可追溯到固定來源、測試通過，且沒有加入憑證、玩家個資或未獲准長期儲存的第三方資料。
