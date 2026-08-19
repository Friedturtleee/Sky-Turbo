export function ItemIcon({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
  return <span className="item-icon" aria-hidden="true">{initials}</span>;
}

