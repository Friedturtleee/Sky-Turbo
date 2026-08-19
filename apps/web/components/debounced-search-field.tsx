"use client";

import { useEffect, useState } from "react";

export function DebouncedSearchField({
  onSearch,
  placeholder,
}: {
  onSearch: (value: string) => void;
  placeholder: string;
}) {
  const [value, setValue] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => onSearch(value), 180);
    return () => window.clearTimeout(timer);
  }, [onSearch, value]);
  return <label className="search-field"><span>搜尋</span><input value={value} onChange={(event) => setValue(event.target.value)} placeholder={placeholder} /></label>;
}

