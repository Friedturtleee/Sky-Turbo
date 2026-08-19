# Third-Party Notices

## SkyShards

Fusion recipe data and Shard item icons are derived from [Campionnn/SkyShards](https://github.com/Campionnn/SkyShards), licensed under the MIT License. The synchronized data source is pinned in `packages/core/data/fusion-source.json`; the icon archive hash is recorded in the generated texture metadata. Copyright remains with its respective authors.

The MIT license text is available in the upstream repository and is copied to `apps/web/public/skyshards/LICENSE.txt`: <https://github.com/Campionnn/SkyShards/blob/master/LICENSE>.

## TradingView Lightweight Charts

Charts use [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts), licensed under Apache License 2.0. The application footer retains the required TradingView attribution and link.

Apache License 2.0: <https://www.apache.org/licenses/LICENSE-2.0>.

## Hypixel

Market data is retrieved from the public Hypixel API. Hypixel is a trademark of Hypixel Inc. This project is not affiliated with or endorsed by Hypixel Studios or Hypixel Inc. API use remains subject to the [Hypixel API Policy](https://developer.hypixel.net/policies/).

Item textures are synchronized from the official [Hypixel SkyBlock Resource Pack endpoint](https://api.hypixel.net/v2/resources/packs). The pack and its assets are copyright © Hypixel Inc. and are used under the included Hypixel SkyBlock Resource Pack License for this free Hypixel-related website. The application does not sell access to the pack or its assets and does not imply endorsement by Hypixel. A copy of the pack license is distributed with the synchronized assets at `apps/web/public/hypixel-skyblock-pack/LICENSE.txt`.

Custom player-head textures referenced by Hypixel's public SkyBlock Items API are downloaded from `textures.minecraft.net` during the icon synchronization step and served locally. Rights in those textures remain with their respective creators and platform owners.

## Minecraft

Fallback item and block textures are extracted from the official Minecraft client download published through Mojang's version manifest. Minecraft assets are copyright © Mojang AB / Microsoft and are used subject to the [Minecraft EULA](https://www.minecraft.net/eula) and [Usage Guidelines](https://www.minecraft.net/usage-guidelines). This project is not affiliated with or endorsed by Mojang or Microsoft. The client version and verified SHA-1 are recorded in `apps/web/public/hypixel-skyblock-pack/metadata.json`.

## SkyCofl

Optional historical backfill can retrieve aggregate Bazaar history from the [SkyCofl API](https://sky.coflnet.com/wiki/api). Use is subject to SkyCofl's current API access, rate-limit, attribution, redistribution, and competition restrictions. The backfill command remains disabled until the operator explicitly confirms that permission for this application's data storage and use has been obtained. SkyCofl data is marked as an imported source and never overrides first-party Hypixel snapshots in the same time bucket.

Other JavaScript dependencies retain the licenses declared in their package metadata and the generated `pnpm-lock.yaml` dependency graph.
