# Sky Turbo

Hypixel SkyBlock Bazaar 與 Shard Fusion 即時看盤器。介面使用繁體中文，物品名稱保留英文；所有 flip 數字均明確區分掛單與即時成交，賣出收入固定扣除 1.125% Bazaar 稅。

## 本機啟動

需求：Node.js 20.9+、pnpm 10+。

```bash
pnpm install
pnpm sync:shards
pnpm dev

```

開啟 `http://localhost:3000`。沒有 Clerk 或 D1 設定時也能啟動：行情直接讀取 Hypixel，書籤存於瀏覽器，歷史圖表從當下開始顯示單點資料。

```bash
pnpm test
pnpm typecheck
pnpm build

```

## 歷史資料回填

`pnpm backfill:history` 會從 SkyCofl 逐商品抓取 `day`、`week`、`history`，透過受保護的 Worker 寫入 D1。每個商品／區間都是獨立 checkpoint；停止後重新執行只抓缺少的區間，不會覆蓋持續由 Hypixel 累積的時間槽。讀取時以 Hypixel 自有資料優先，SkyCofl 只補空槽。

商品數由程式在執行時向 Hypixel 取得；2026-08-19 實測為 2,124 個，空資料庫最多 `2,124 × 3 = 6,372` 次 SkyCofl 請求。固定 90 req/min 時理論約 70.8 分鐘，計入重試和 D1 寫入後預估 75–90 分鐘。實際時間會隨商品數及既有 checkpoint 改變。

先在根目錄 `.env.local` 填入：

```dotenv
NEXT_PUBLIC_EDGE_API_URL=https://sky-turbo-edge.<你的帳號>.workers.dev
INGEST_SECRET=<與 Worker 完全相同的長隨機字串>
# 或將真實值放進 gitignored 檔案，避免寫入 .env：
INGEST_SECRET_FILE=.secrets/INGEST_SECRET

# 一般歷史端點目前不強制 token；有 Premium+／custom-app token 才填。
COFLNET_API_TOKEN=
COFLNET_CONTACT=your-email-or-discord
COFLNET_REQUESTS_PER_MINUTE=90
COFLNET_USAGE_APPROVED=true
```

`COFLNET_USAGE_APPROVED=true` 代表已取得 SkyCofl 對此應用保存／使用資料的同意。其 API 文件禁止未經同意的資料服務、大量再散布及直接競爭用途，因此程式預設拒絕執行。`COFLNET_CONTACT` 會放入 User-Agent，避免匿名大量請求。

```bash
# 正式補齊全部缺口
pnpm backfill:history

# 只測試一個商品，不寫 D1
pnpm backfill:history -- --dry-run --product=BOOSTER_COOKIE

# 限制本次商品數；完成品已各自存檔，下次可續跑
pnpm backfill:history -- --limit=100

# 明確重新抓取已完成的區間
pnpm backfill:history -- --refresh
```

程式將請求平均間隔設為 667ms，同時低於 SkyCofl 的 30 req/10s 與 100 req/min 限制；遇到 `429` 會遵守 `Retry-After` 並重試。每個商品以 gzip JSON BLOB 保存於 D1，manifest 會記錄請求數、失敗數與執行時間。

## 專案結構

```text
apps/web       Next.js 16 UI、API、Hypixel ingestion
apps/worker    Cloudflare Cron、D1 market history、Clerk JWT／bookmarks
packages/core  Bazaar／Fusion 純計算核心與測試
scripts        固定版本的 SkyShards 資料同步工具
```

環境變數範本在 [.env.example](./.env.example) 與 [apps/worker/.dev.vars.example](./apps/worker/.dev.vars.example)。產品範圍、公式及部署方式分別記錄於 [PROJECT_MASTER_DOCUMENT.md](./PROJECT_MASTER_DOCUMENT.md) 與 [SPECIFICATION.md](./SPECIFICATION.md)。

## 正式環境資源

本方案使用 Cloudflare Workers Free、D1 Free、Vercel Hobby，以及可選的 Clerk Hobby；不建立 R2、不購買網域，也不需要填信用卡。使用免費的 `workers.dev` 與 `vercel.app` 網域即可。

1. 登入免費 Cloudflare 帳號後建立 D1：`pnpm --filter @sky-turbo/worker exec wrangler d1 create sky-turbo --location=apac`，把回傳 ID 寫入 `apps/worker/wrangler.jsonc`。
2. 套用 migration：`pnpm --filter @sky-turbo/worker exec wrangler d1 migrations apply sky-turbo --remote`。
3. 執行 `pnpm --filter @sky-turbo/worker exec wrangler secret put INGEST_SECRET`，輸入一個自行產生的長隨機值，然後部署 Worker。
4. Vercel 選 Hobby，Root Directory 設為 `apps/web`；加入相同的 `INGEST_SECRET`，並把 `NEXT_PUBLIC_EDGE_API_URL` 設成 Worker 的 `workers.dev` URL。
5. 將 `apps/worker/wrangler.jsonc` 的 `ALLOWED_ORIGIN` 改為 Vercel 的 `vercel.app` URL、`VERCEL_INGEST_URL` 改為 `<Vercel URL>/api/v1/internal/ingest`，再部署 Worker。
6. Clerk 完全可選；不設定時書籤會存在瀏覽器。如需跨裝置同步，可使用不需信用卡的 Clerk Hobby。

D1 使用 8 個 gzip 分區：5 分鐘資料保留 8 天、每小時資料保留 93 天、每日資料長期保留。以目前商品數估算，進入穩定 retention 後包含索引與刪除約 13,000 billed rows written／日，低於 D1 Free 的 100,000／日限制；最密集的每日切換約 29 個 D1 queries／invocation，也低於 Free 的 50 個限制。超額時免費方案會暫停查詢而不是自動扣款。

此專案與 Hypixel Studios 或 Hypixel Inc. 無關，亦未受其背書。
