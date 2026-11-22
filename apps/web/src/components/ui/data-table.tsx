"use client";

import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3, Inbox } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Checkbox } from "./field";
import { EmptyState, Skeleton } from "./display";
import { Menu, MenuCheckbox, MenuContent, MenuLabel, MenuTrigger } from "./overlay";

export type { ColumnDef };

export function DataTable<T>({
  columns,
  data,
  loading,
  getRowId,
  sorting,
  onSortingChange,
  manualSorting,
  selectable,
  rowSelection,
  onRowSelectionChange,
  onRowClick,
  emptyTitle = "No records",
  emptyDescription,
  columnVisibility,
  onColumnVisibilityChange,
  className,
  rowClassName,
  dense,
}: {
  columns: ColumnDef<T, any>[];
  data: T[];
  loading?: boolean;
  getRowId?: (row: T) => string;
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  manualSorting?: boolean;
  selectable?: boolean;
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: OnChangeFn<RowSelectionState>;
  onRowClick?: (row: T) => void;
  emptyTitle?: string;
  emptyDescription?: React.ReactNode;
  columnVisibility?: VisibilityState;
  onColumnVisibilityChange?: OnChangeFn<VisibilityState>;
  className?: string;
  rowClassName?: (row: T) => string | undefined;
  dense?: boolean;
}) {
  const [localSorting, setLocalSorting] = useState<SortingState>([]);
  const cols: ColumnDef<T, any>[] = selectable
    ? [
        {
          id: "_select",
          size: 36,
          enableSorting: false,
          enableHiding: false,
          header: ({ table }) => (
            <Checkbox
              aria-label="Select all rows"
              checked={table.getIsAllRowsSelected()}
              ref={(el: HTMLInputElement | null) => {
                if (el) el.indeterminate = table.getIsSomeRowsSelected();
              }}
              onChange={table.getToggleAllRowsSelectedHandler()}
            />
          ),
          cell: ({ row }) => <Checkbox aria-label="Select row" checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} onClick={(e) => e.stopPropagation()} />,
        },
        ...columns,
      ]
    : columns;

  const table = useReactTable({
    data,
    columns: cols,
    getRowId: getRowId as any,
    state: { sorting: sorting ?? localSorting, rowSelection: rowSelection ?? {}, columnVisibility: columnVisibility ?? {} },
    onSortingChange: onSortingChange ?? setLocalSorting,
    onRowSelectionChange,
    onColumnVisibilityChange,
    enableRowSelection: !!selectable,
    manualSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: manualSorting ? undefined : getSortedRowModel(),
  });

  return (
    <div className={cn("scrollbar-thin relative w-full overflow-x-auto", className)}>
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => {
                const sortable = h.column.getCanSort();
                const dir = h.column.getIsSorted();
                const align = (h.column.columnDef.meta as any)?.align;
                return (
                  <th
                    key={h.id}
                    style={{ width: h.column.columnDef.size !== 150 ? h.column.columnDef.size : undefined }}
                    className={cn(
                      "sticky top-0 z-[1] whitespace-nowrap border-b border-line bg-surface-2 px-3 text-left text-xs font-semibold text-muted first:pl-4 last:pr-4",
                      dense ? "h-8" : "h-9",
                      align === "right" && "text-right",
                    )}
                    aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}
                  >
                    {h.isPlaceholder ? null : sortable ? (
                      <button type="button" onClick={h.column.getToggleSortingHandler()} className={cn("inline-flex items-center gap-1 hover:text-fg", align === "right" && "flex-row-reverse")}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {dir === "asc" ? <ArrowUp className="size-3" /> : dir === "desc" ? <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-40" />}
                      </button>
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}>
                  {table.getVisibleLeafColumns().map((c) => (
                    <td key={c.id} className="border-b border-line px-3 py-3 first:pl-4">
                      <Skeleton className="h-4 w-full max-w-36" />
                    </td>
                  ))}
                </tr>
              ))
            : table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  className={cn(
                    "group transition-colors hover:bg-surface-2",
                    onRowClick && "cursor-pointer",
                    row.getIsSelected() && "bg-primary-soft/60 hover:bg-primary-soft",
                    rowClassName?.(row.original),
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className={cn(
                        "border-b border-line px-3 align-middle text-fg first:pl-4 last:pr-4",
                        dense ? "py-1.5" : "py-2.5",
                        (cell.column.columnDef.meta as any)?.align === "right" && "text-right tabular",
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
      {!loading && data.length === 0 && <EmptyState icon={Inbox} title={emptyTitle} description={emptyDescription} />}
    </div>
  );
}

export function ColumnToggle<T>({ columns, visibility, onChange }: { columns: ColumnDef<T, any>[]; visibility: VisibilityState; onChange: (v: VisibilityState) => void }) {
  const hideable = columns.filter((c) => c.enableHiding !== false && (c as any).id);
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Columns3 /> Columns
        </Button>
      </MenuTrigger>
      <MenuContent className="w-52">
        <MenuLabel>Visible columns</MenuLabel>
        {hideable.map((c) => {
          const id = (c as any).id as string;
          return (
            <MenuCheckbox key={id} checked={visibility[id] !== false} onCheckedChange={(v) => onChange({ ...visibility, [id]: !!v })} onSelect={(e) => e.preventDefault()}>
              {typeof c.header === "string" ? c.header : id}
            </MenuCheckbox>
          );
        })}
      </MenuContent>
    </Menu>
  );
}

export function Pagination({ page, pageSize, total, onPage, onPageSize }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; onPageSize?: (n: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-[13px] text-muted">
      <div className="tabular">
        {from.toLocaleString("en-IN")}–{to.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}
      </div>
      <div className="flex items-center gap-2">
        {onPageSize && (
          <select aria-label="Rows per page" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} className="h-8 rounded-md border border-line-strong bg-surface px-2 text-[13px]">
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
          </select>
        )}
        <Button variant="outline" size="icon-sm" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page">
          <ChevronLeft />
        </Button>
        <span className="tabular min-w-16 text-center">
          {page} / {pages}
        </span>
        <Button variant="outline" size="icon-sm" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page">
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
