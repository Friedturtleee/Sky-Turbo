"use client";

import { useEffect, useState } from "react";
import { useI18n } from "./i18n";

export function DebouncedSearchField({
  onSearch,
  placeholder,
}: {
  onSearch: (value: string) => void;
  placeholder: string;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => onSearch(value), 180);
    return () => window.clearTimeout(timer);
  }, [onSearch, value]);
  return <label className="search-field"><span>{t("common.search")}</span><input value={value} onChange={(event) => setValue(event.target.value)} placeholder={placeholder} /></label>;
}
