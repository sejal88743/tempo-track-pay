import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";

export type SortDir = "asc" | "desc";
export type SortState = { key: string; dir: SortDir } | null;
export type Accessors<T> = Record<string, (row: T) => string | number | null | undefined>;

function cmp(a: string | number | null | undefined, b: string | number | null | undefined) {
  const av = a ?? "";
  const bv = b ?? "";
  if (typeof av === "number" && typeof bv === "number") return av - bv;
  return String(av).localeCompare(String(bv), "en", { numeric: true, sensitivity: "base" });
}

/** Generic column sorting — click once = ascending, twice = descending, thrice = off. */
export function useSortable<T>(rows: T[], accessors: Accessors<T>) {
  const [sort, setSort] = useState<SortState>(null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const acc = accessors[sort.key];
    if (!acc) return rows;
    const out = [...rows].sort((a, b) => cmp(acc(a), acc(b)));
    return sort.dir === "asc" ? out : out.reverse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);

  const toggle = (key: string) =>
    setSort((s) => {
      if (!s || s.key !== key) return { key, dir: "asc" };
      return s.dir === "asc" ? { key, dir: "desc" } : null;
    });

  return { sorted, sort, toggle };
}

export function SortHeader({
  label,
  sortKey,
  sort,
  toggle,
  className,
  align = "left",
}: {
  label: string;
  sortKey: string;
  sort: SortState;
  toggle: (key: string) => void;
  className?: string;
  align?: "left" | "right";
}) {
  const active = sort?.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort!.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => toggle(sortKey)}
        className={`inline-flex items-center gap-1 select-none hover:text-foreground transition-colors ${
          active ? "text-foreground font-semibold" : ""
        } ${align === "right" ? "flex-row-reverse w-full justify-start" : ""}`}
      >
        {label}
        <Icon className={`size-3.5 ${active ? "opacity-100" : "opacity-40"}`} />
      </button>
    </TableHead>
  );
}
