"use client";

import { useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** Client table (TanStack Table) with column sorting over the current server page. */
export function DataTable<T>({
  columns,
  data,
  empty,
  getRowId,
}: {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  empty?: React.ReactNode;
  getRowId: (row: T) => string;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId,
  });
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id} className="bg-muted/40 hover:bg-muted/40">
              {hg.headers.map((h) => {
                const meta = h.column.columnDef.meta as { align?: "right" } | undefined;
                const sortable = h.column.getCanSort();
                const dir = h.column.getIsSorted();
                return (
                  <TableHead key={h.id} className={cn("text-xs font-medium whitespace-nowrap", meta?.align === "right" && "text-right")}>
                    {sortable ? (
                      <button
                        type="button"
                        className={cn("inline-flex items-center gap-1 hover:text-foreground", meta?.align === "right" && "flex-row-reverse")}
                        onClick={h.column.getToggleSortingHandler()}
                        aria-label={`Sort by ${String(h.column.columnDef.header)}`}
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {dir === "asc" ? <ArrowUp className="size-3" /> : dir === "desc" ? <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-40" />}
                      </button>
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns.length} className="p-0">
                {empty}
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => {
                  const meta = cell.column.columnDef.meta as { align?: "right" } | undefined;
                  return (
                    <TableCell key={cell.id} className={cn(meta?.align === "right" && "text-right tabular")}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
