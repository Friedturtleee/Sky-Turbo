# Sky Turbo

Hypixel SkyBlock Bazaar、Auction House、Craft、Shard Fusion 與 NPC Flip 即時看盤器。介面使用繁體中文，物品名稱保留英文；所有 flip 數字均明確區分掛單與即時成交。

## 本機啟動

需求：Node.js 20.9+、pnpm 10+。

```bash
pnpm install
pnpm sync:flip-data
pnpm dev

```

開啟 `http://localhost:3000`。沒有 Clerk 或 D1 設定時也能啟動：行情直接讀取 Hypixel，書籤存於瀏覽器，歷史圖表從當下開始顯示單點資料。

`pnpm sync:flip-data` 是更新全部 Flip 靜態資料的一鍵指令，會依序同步 Shard Fusion、NPC 商店、NEU crafting recipes、AH reforge / dye 對照表與所有相關物品圖示。只需更新合成配方與 AH 升級對照表時可執行 `pnpm sync:craft-recipes`；只需重建圖示時可執行 `pnpm sync:item-icons`。這些同步不需要 Hypixel API key。

Craft Flip 只顯示原料與成品全部存在於 Bazaar 的標準 crafting recipes，並支援 `Buy Order → Sell Order`、`Instant Buy → Sell Order`、`Buy Order → Instant Sell`、`Instant Buy → Instant Sell` 四種策略。Max Profit 會逐檔計算 Instant 深度、以近 7 日原料與成品流動性限制最大合成次數；點擊成品可查看最大獲利或至少 80% Max Profit 所需的完整原料與總成本。配方資料會記錄 NEU 上游的精確 commit，SkyBlock 更新後重新執行 `pnpm sync:flip-data` 即可刷新。

NPC Flip 會計算單次最佳出售方式與每日 Max Profit。標準商店轉售商品使用 640 個每日上限；現任市長資料由 Hypixel Election API 自動判斷，Diaz 的 Shopping Spree 對適用商店乘 10。Kiara 的 Viper、Crocodile、Eel、Gecko Shard 使用各自特殊庫存、不套用 Diaz，並可選擇是否套用 Abiphone Contact 的 +1 庫存；Agatha、Miria 與 Galatea 新商店的可交易品也包含在同步資料中。點擊商品或「查看詳細」可切換「拿完每日庫存」及「至少 80% Max Profit」，查看全部所需 Coins／成本物品。

AH Flip 只分析現行 BIN。它會完整解析拍賣 NBT，辨認 Gemstone、Dye、Hot Potato / Fuming Book、Reforge、附魔、星級、Pet、Attribute 與其他升級，再優先使用 SkyCofl 的完整 NBT 中位估值。無法取得精準估值時仍會顯示保守的 Component Estimate，但一律標記為高風險。Profit 已扣除依出售總額級距計算的 AH 稅費；`Nearest` 依拍賣建立時間由新到舊排序。

圖示同步來源依序為 Hypixel 官方 SkyBlock 資源包、Items API 的玩家頭顱、Minecraft 原版材質與 SkyShards 的 Shard 圖示；附魔等級與 Essence 等沒有獨立材質的項目則共用對應分類圖示。Hypixel 與 Minecraft 下載檔會驗證 SHA-1，所有實際使用的 PNG 都會保存成網站靜態檔，不需在訪客開啟頁面時連線外部圖片服務。

同步完成後可查看 `apps/web/public/hypixel-skyblock-pack/metadata.json`：`mappedItems` 應與 `targetProducts` 相同；`genericFallbackProducts` 會列出只能使用通用圖示的特殊或 legacy ID。Bazaar、NPC 或 Craft recipe 新增商品後重新執行同步即可更新。

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
COFLNET_CONTACT=your-email-or-discord
COFLNET_API_TOKEN=
COFLNET_REQUESTS_PER_MINUTE=90
COFLNET_USAGE_APPROVED=true
```

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

### AH 近 7 天成交歷史

AH Flip 的 7 天售價、成交數、售出時間與波動資料也透過指令從 SkyCofl 回填。每個物品有獨立 checkpoint，可中斷續跑：

```bash
# 先驗證單一物品，不寫入 D1
pnpm backfill:ah-history -- --dry-run --product=HYPERION

# 小批次寫入，適合先檢查部署設定
pnpm backfill:ah-history -- --limit=25

# 補齊全部 AH 商品；已存在的紀錄會略過
pnpm backfill:ah-history

# 明確重抓已完成紀錄
pnpm backfill:ah-history -- --refresh
```

### AH 10 秒即時收集器

瀏覽器每 10 秒更新畫面，但只會先檢查 Hypixel auction page 0 的 `lastUpdated`；版本改變時，收集器才會以最多 8 個並行請求抓取全部頁面，並在最後再次驗證 page 0，避免混用兩個拍賣快照。新快照完全估價完成並寫入 D1 後，前端才會替換舊面板。

```bash
# 單次完整掃描，先檢查輸出但不寫 D1
pnpm collect:ah -- --once --dry-run

# 持續每 10 秒檢查；新快照完成後發布到 D1
pnpm collect:ah

# 快速診斷：只抓第一頁、限制估價候選數
pnpm collect:ah -- --once --dry-run --max-pages=1 --candidates=80 --verbose
```

正式啟用前要先套用新增的 D1 migration `0003_ah_flips.sql`，再部署 Worker。`COFLNET_USAGE_APPROVED=true` 僅應在確認 SkyCofl 授權與用途後設定；未設定時網站仍可掃描，但會跳過精準 NBT API，所有 component fallback 都會顯示高風險。

## 專案結構

```text
apps/web       Next.js 16 UI、API、Hypixel ingestion
apps/worker    Cloudflare Cron、D1 market / AH history、AH snapshot、Clerk JWT／bookmarks
packages/core  Bazaar／AH／Craft／Fusion／NPC 計算核心、NBT 掃描器與測試
scripts        AH 收集／歷史回填、Shard、NPC、Craft recipe 與圖示同步工具
```
