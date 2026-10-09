"use client";

import { useEffect, useRef, useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney, variantLabel } from "@/lib/format";

interface V {
  id: string;
  sku: string;
  barcode: string | null;
  size: string | null;
  color: string | null;
  price: string;
}

function BarcodeSvg({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    let cancelled = false;
    void import("jsbarcode").then(({ default: JsBarcode }) => {
      if (cancelled || !ref.current) return;
      const format = /^\d{13}$/.test(value) ? "EAN13" : "CODE128";
      try {
        JsBarcode(ref.current, value, { format, height: 38, width: 1.4, fontSize: 11, margin: 0, displayValue: true });
      } catch {
        JsBarcode(ref.current, value, { format: "CODE128", height: 38, width: 1.4, fontSize: 11, margin: 0 });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [value]);
  return <svg ref={ref} aria-label={`Barcode ${value}`} />;
}

export function BarcodeLabels({ productName, variants }: { productName: string; variants: V[] }) {
  const [counts, setCounts] = useState<Record<string, number>>(() => Object.fromEntries(variants.map((v) => [v.id, v.barcode ? 1 : 0])));
  const labels = variants.flatMap((v) => (v.barcode ? Array.from({ length: Math.min(counts[v.id] ?? 0, 200) }, (_, i) => ({ ...v, key: `${v.id}-${i}` })) : []));
  return (
    <div className="space-y-4">
      <div className="no-print overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs">
            <tr>
              <th className="p-2 text-left font-medium">Variant</th>
              <th className="p-2 text-left font-medium">Barcode</th>
              <th className="p-2 text-right font-medium">Labels</th>
            </tr>
          </thead>
          <tbody>
            {variants.map((v) => (
              <tr key={v.id} className="border-t">
                <td className="p-2">{variantLabel(v) || v.sku}</td>
                <td className="p-2 font-mono text-xs">{v.barcode ?? <span className="text-muted-foreground">no barcode — add one first</span>}</td>
                <td className="p-2 text-right">
                  <Input
                    type="number"
                    min={0}
                    max={200}
                    value={counts[v.id] ?? 0}
                    disabled={!v.barcode}
                    onChange={(e) => setCounts({ ...counts, [v.id]: Math.max(0, Math.min(200, Number(e.target.value) || 0)) })}
                    className="ml-auto h-8 w-20 text-right"
                    aria-label={`Number of labels for ${variantLabel(v) || v.sku}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="no-print">
        <Button onClick={() => window.print()} disabled={labels.length === 0}>
          <Printer /> Print {labels.length} label(s)
        </Button>
      </div>
      <div className="print-area grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-4">
        {labels.map((l) => (
          <div key={l.key} className="flex flex-col items-center rounded border bg-white p-2 text-center text-[10px] break-inside-avoid">
            <div className="w-full truncate font-semibold">{productName}</div>
            <div className="w-full truncate">{variantLabel(l)}</div>
            <BarcodeSvg value={l.barcode!} />
            <div className="font-semibold">{formatMoney(l.price)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
