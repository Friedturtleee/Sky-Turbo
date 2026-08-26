# Sky Turbo

Sky Turbo is a real-time market analysis tool for Hypixel SkyBlock. It combines Bazaar, Shard Fusion, Craft, NPC, Auction House, and price anomaly monitoring. Production site: [bz.friedturtleee.me](https://bz.friedturtleee.me).

> This project provides market estimates only. It does not guarantee order fulfillment, Fusion RNG outcomes, or actual profit. It is not affiliated with or endorsed by Hypixel Inc., Mojang, or Microsoft.

## Features

- **Bazaar Flip**: After-tax spreads, CPH, trading volume, volatility, top-30 order-book depth, and price history.
- **Skyblock Index / Crashing**: Market index and items with abnormal price drops over the past 24 hours.
- **Shard Flip**: Four trading strategies, recursive Fusion paths, integer material quantities, Crocodile EV, order-book depth, and Max Fusion.
- **Craft Flip**: Uses NEU recipes pinned to a specific commit to calculate profit per craft and maximum profit across visible market depth.
- **NPC Flip**: Bazaar/AH exit prices, daily NPC limits, mayor modifiers, and special handling for Derpy and Diaz.
- **AH Flip**: Parses full NBT data to estimate the value of gemstones, enchantments, reforges, stars, pets, attributes, and more.
- **Bookmarks and preferences**: Stored in the browser without authentication; synchronized to Cloudflare D1 when Clerk is enabled.
- **Traditional Chinese and English interfaces**.

## Architecture

This project is a pnpm monorepo:

```text
apps/web       Next.js 16 website and public API (deployed on Vercel)
apps/worker    Cloudflare Worker, Cron, D1 storage, and Clerk JWT verification
packages/core  Shared calculation core for market, Shard, Craft, NPC, AH, and historical data
scripts        Data synchronization, historical backfills, AH collection, and live smoke tests
```

Market data flow:

```text
Hypixel API -> Cloudflare Cron -> Vercel internal ingest -> Worker/D1
      \---------------- public API fallback ----------------/
Browser -> Next.js API/UI -> Worker history/bookmarks
```

The Worker handles scheduling, persistence, and user data only. Market normalization and primary calculations are performed in Web/Core. If D1 is not configured, the Bazaar features can still use live Hypixel data directly.

For more detailed product and formula documentation, see [PROJECT_MASTER_DOCUMENT.md](./PROJECT_MASTER_DOCUMENT.md) and [SPECIFICATION.md](./SPECIFICATION.md).

## Requirements

- Node.js `>=20.9.0`
- pnpm `10.32.1` (Corepack recommended)
- Optional: Cloudflare, Vercel, and Clerk accounts

## Local Development

```bash
corepack enable
pnpm install --frozen-lockfile
```

Copy `.env.example` to `.env.local` and include at least the following local values:

```dotenv
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_EDGE_API_URL=http://localhost:8787
INGEST_SECRET=replace-with-a-high-entropy-random-value
```

To enable account synchronization, also configure `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`. Do not commit `.env.local`, `apps/worker/.dev.vars`, or any real token to Git.

Start the Web app:

```bash
pnpm dev
```

Start the local Worker/D1:

```bash
pnpm --filter @sky-turbo/worker exec wrangler d1 migrations apply sky-turbo --local
pnpm dev:worker
```

Store local Worker secrets in `apps/worker/.dev.vars`:

```dotenv
INGEST_SECRET=the-same-high-entropy-random-value-as-the-web-app
ALLOWED_ORIGIN=http://localhost:3000
VERCEL_INGEST_URL=http://localhost:3000/api/v1/internal/ingest
```

To test Clerk locally, override `CLERK_ISSUER` and `CLERK_JWKS_URL` in the same file with values from your local Clerk instance so that `azp`/issuer validation matches localhost.

## Environment Variables

| Name | Requirement | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Recommended | Public Web URL. |
| `NEXT_PUBLIC_EDGE_API_URL` | Required when using the Worker | Public Worker URL; exposed to the browser and must not contain secrets. |
| `INGEST_SECRET` | Required when writing to D1 | Protects Vercel ingestion and Worker internal routes; must be identical on both sides. |
| `INGEST_SECRET_FILE` | Optional | Allows backfill scripts to read the secret from a gitignored file. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Optional | Enables Clerk authentication on the frontend. |
| `CLERK_SECRET_KEY` | Optional | Clerk server-side secret. |
| `COFLNET_API_TOKEN` | Optional | SkyCofl authorization token. |
| `COFLNET_CONTACT` | Recommended when using SkyCofl | API contact identifier. |
| `COFLNET_REQUESTS_PER_MINUTE` | Optional | Backfill rate; defaults to `90`. |
| `COFLNET_USAGE_APPROVED` | Optional | Set to `true` only after obtaining permission to store/use the data. |
| `AH_SCAN_MAX_PAGES` | Optional | Limits the number of pages in a full AH scan. |
| `AH_BOOTSTRAP_MAX_PAGES` | Optional | Number of pages in the initial quick scan; defaults to `2`. |
| `AH_CANDIDATE_LIMIT` | Optional | Maximum number of AH candidates valued per run. |
| `AH_RESULT_LIMIT` | Optional | Maximum number of results returned by the AH API. |

Non-secret Cloudflare settings (`ALLOWED_ORIGIN`, `VERCEL_INGEST_URL`, `CLERK_ISSUER`, and `CLERK_JWKS_URL`) are defined in `apps/worker/wrangler.jsonc`. Before deploying, replace them with values for your own domains and Clerk instance.

## Common Commands

```bash
pnpm dev                 # Next.js development server
pnpm dev:worker          # Cloudflare Worker development server
pnpm test                # Run all unit tests
pnpm typecheck           # Type-check the entire monorepo
pnpm lint                # Run lint/type lint in each workspace
pnpm build               # Core + Web + Worker dry-run build
pnpm smoke:live          # Basic smoke tests using the live Hypixel API
pnpm sync:flip-data      # Update Shard, NPC, Craft, and icon data
```

Additional data operations:

```bash
pnpm backfill            # Backfill Bazaar history
pnpm backfill:ah-history # Backfill AH history
pnpm collect:ah          # Collect and publish an AH Flip snapshot
```

## Shard Fusion Data and the Anteater Fix

Shard data comes from [Campionnn/SkyShards](https://github.com/Campionnn/SkyShards) at a pinned commit recorded in `packages/core/data/fusion-source.json`.

The two Fusion input slots are ordered, so `[A, B]` must not automatically be treated as `[B, A]`. The current data preserves the correct special recipe for Anteater:

```text
First slot: Queen Ant x5 + second slot: King Cobra x2 -> Anteater x2
```

Standard ID Fusion, Chameleon Fusion, and Special Fusion may produce different output quantities. The calculator uses the output quantity from the data directly instead of inferring it from rarity. Recursive paths round each Fusion batch up before comparing total integer material costs, preventing a path with a lower average unit cost from being selected when its actual batch cost is higher. Post-sync tests verify the Anteater recipe, ensure the complete dataset has not been mirrored incorrectly, and validate alternative-path selection using integer batch sizes.

Run the following commands when updating the data:

```bash
pnpm sync:shards
pnpm --filter @sky-turbo/core test
```

## API Summary

Web API:

- `GET /api/v1/market/items`
- `GET /api/v1/market/items/:productId`
- `GET /api/v1/market/items/:productId/history?range=1h|1d|1mo|all`
- `GET /api/v1/market/items/:productId/orderbook`
- `GET /api/v1/shard-flips`
- `GET /api/v1/craft-flips`
- `GET /api/v1/npc-flips`
- `GET /api/v1/ah-flips`
- `GET /api/v1/skyblock-index?range=1d|7d|1mo`
- `POST /api/v1/internal/ingest` (Bearer secret)

Successful responses use `{ data, error: null }`; failed responses use `{ data: null, error: { message } }`. See [SPECIFICATION.md](./SPECIFICATION.md) for complete query parameters and the Edge API.

## Deployment

### Cloudflare Worker

1. Create your own D1 database, then update the database ID and public settings in `apps/worker/wrangler.jsonc` to reference your resources.
2. Set the secret through the interactive prompt (do not include the secret in the command arguments):

```bash
pnpm --filter @sky-turbo/worker exec wrangler secret put INGEST_SECRET
```

3. Apply migrations, validate, and deploy:

```bash
pnpm --filter @sky-turbo/worker exec wrangler d1 migrations apply sky-turbo --remote
pnpm --filter @sky-turbo/worker build
pnpm --filter @sky-turbo/worker exec wrangler deploy
```

### Vercel Web

Configure the environment variables used by `apps/web` in Vercel, and ensure that:

- `NEXT_PUBLIC_EDGE_API_URL` points to the newly deployed Worker.
- `INGEST_SECRET` is identical in the Web app and Worker.
- The Worker's `VERCEL_INGEST_URL` points to `/api/v1/internal/ingest` on the Web app.
- When Clerk is enabled, the Worker's issuer, JWKS URL, and allowed origin match the production domain.

Before deploying, run at least:

```bash
pnpm audit --prod --audit-level moderate
pnpm test
pnpm typecheck
pnpm build
```

## Security

- `.env*`, `.dev.vars*`, `.secrets/`, and platform configuration directories are excluded from version control.
- Internal ingestion uses timing-safe Bearer secret comparison, and Worker request bodies have explicit size limits.
- Clerk JWT validation checks the signature, issuer, algorithm, expiration, and `azp` authorized party.
- All D1 queries use prepared statements.
- Web and Worker responses include security headers that prevent framing and MIME sniffing and restrict referrer information and browser permissions.
- The public AH endpoint does not accept cache-bypass forced scans, preventing abuse that could amplify upstream requests.
- Production APIs do not return raw exception details.

If you discover a vulnerability, report it through a private GitHub security advisory. Do not post tokens, exploit details, or user data in a public issue. Immediately revoke and rotate any exposed secrets in Vercel, Cloudflare, and Clerk.

## Data Sources, Licenses, and Disclaimers

This project integrates third-party data and assets from Hypixel, SkyShards, SkyCofl, the NotEnoughUpdates Repository, SkyblockRepo, TradingView Lightweight Charts, Minecraft/Hypixel textures, and other sources. Their sources, licenses, pinned commits, and required notices are listed in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

Before submitting a PR, verify that synchronized data remains traceable to a pinned source, all tests pass, and no credentials, player personal information, or third-party data lacking long-term storage permission have been added.
