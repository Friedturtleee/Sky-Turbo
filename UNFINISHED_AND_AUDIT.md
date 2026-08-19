# 未完成項目與上線稽核

本文件刻意區分「程式已實作」與「需要帳號／真實流量才能完成」的工作。

## 需在首次部署完成

- [ ] 建立 Vercel Hobby、Cloudflare Workers Free／D1 Free，以及可選的 Clerk Hobby 資源；不要啟用付費方案或 R2。
- [ ] 將 `wrangler.jsonc` 的 D1 placeholder UUID 換成真實 database ID，production vars 換成正式網域。
- [ ] 套用 D1 migration，設定 Worker secrets，部署 Vercel 後再部署 Cron Worker。
- [ ] 在 Clerk Dashboard 加入正式網域、Email／OAuth connection 與 allowed origins。
- [ ] 確認 Vercel 與 Worker 使用相同的 `INGEST_SECRET`，D1 僅透過 Worker binding 存取。
- [ ] 以正式環境跑 24 小時，確認 5m／1h／1d D1 分區正常封存與解壓縮。

## 已知產品限制

- 未執行 SkyCofl 回填前，24h／7d／1mo 指標會顯示「累積中」，直到 D1 累積足夠資料。
- 5m 自動保留 8 天、1h 自動保留 93 天；1d 長期保留。D1 接近 400 MB 時仍需檢查實際成長率。
- 商品顯示名稱目前由 product ID 格式化；少數特殊名稱日後需接 Hypixel item metadata mapping。
- Item icon 目前只有穩定 placeholder contract，尚未選擇圖示授權來源。
- Hypixel orderbook 只提供前 30 檔，無法表示完整市場深度。
- Coins per Hour 是 moving-week liquidity 的線性估算，沒有排隊順位、滑價、cancel risk 或玩家資金上限模型。
- Fusion solver 已有公式單元測試，但正式上線前仍應選取至少 20 條 SkyShards UI 結果做 fixture 對照。

## 可靠性與成本稽核

- [ ] 新增 ingestion failure alert 與 last-success health indicator。
- [ ] 量測 `/api/v1/shard-flips` cold start；若超標，將四策略／11 等級結果在 ingestion 時預計算並評估是否能放入 D1 免費空間。
- [ ] 對 history API 加 server-side request coalescing，避免熱門商品重複讀取同一批 D1 rows。
- [ ] 觀察 Vercel CPU time、Worker requests、D1 rows read／written 與 database size，接近免費額度 70% 時告警。
- [ ] 加入 API-level rate limiting 或 Cloudflare WAF rule，避免公開 API 被大量抓取。
- [ ] 定期檢查 Hypixel API policy、Bazaar 稅率與 SkyShards upstream license／schema 是否變更。

## 隱私與安全稽核

- [ ] 在正式網域確認 CORS 只允許 Vercel origin。
- [ ] 輪替曾在本機或 CI log 暴露的 secret；任何真實 secret 都不可 commit。
- [ ] 視公開規模補上 Privacy 頁面，說明 Clerk user ID 與 bookmarks 的保存／刪除方式。
- [ ] 若未來商業化，先更換符合商業用途的 Vercel plan，並重新審查各服務條款。
