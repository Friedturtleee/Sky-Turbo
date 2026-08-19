import { HYPIXEL_ITEM_TEXTURES } from "@/lib/hypixel-item-textures.generated";

export function ItemIcon({ name, productId }: { name: string; productId: string }) {
  const texture = HYPIXEL_ITEM_TEXTURES[productId] as string | { src: string; kind: "skin" } | undefined;
  const source = typeof texture === "string" ? texture : texture?.src;
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
  return <span className={`item-icon${texture ? " has-texture" : ""}`} aria-hidden="true">
    {texture && typeof texture !== "string" && texture.kind === "skin"
      ? <span className="skin-head">
          <img className="skin-layer" src={texture.src} alt="" loading="lazy" />
          <img className="skin-layer hat" src={texture.src} alt="" loading="lazy" />
        </span>
      : source ? <img src={source} alt="" loading="lazy" /> : initials}
  </span>;
}
