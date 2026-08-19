# Sky Turbo

Hypixel SkyBlock Bazaar 與 Shard Fusion 即時看盤器。介面使用繁體中文，物品名稱保留英文；所有 flip 數字均明確區分掛單與即時成交。

## 本機啟動

需求：Node.js 20.9+、pnpm 10+。

```bash
pnpm install
pnpm sync:shards
pnpm sync:item-icons
pnpm dev

```

開啟 `http://localhost:3000`。沒有 Clerk 或 D1 設定時也能啟動：行情直接讀取 Hypixel，書籤存於瀏覽器，歷史圖表從當下開始顯示單點資料。

`pnpm sync:item-icons` 會替當下所有 Bazaar 商品產生圖示映射，不需要 API key。同步來源依序為 Hypixel 官方 SkyBlock 資源包、Items API 的玩家頭顱、Minecraft 原版材質、SkyShards 的 Shard 圖示；附魔等級與 Essence 等沒有獨立材質的項目則共用對應分類圖示。Hypixel 與 Minecraft 下載檔會驗證 SHA-1，所有實際使用的 PNG 都會保存成網站靜態檔，不需在訪客開啟頁面時連線外部圖片服務。

同步完成後可查看 `apps/web/public/hypixel-skyblock-pack/metadata.json`：`mappedItems` 應與 `bazaarProducts` 相同，`genericFallbackProducts` 應為空陣列。目前產生的映射涵蓋 2,124 / 2,124 項；Bazaar 新增商品後重新執行同步即可更新。

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
