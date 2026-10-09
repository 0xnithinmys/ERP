import Link from "@/components/shared/app-link";
import {
  AlertTriangle,
  ArrowDownToLine,
  IndianRupee,
  PackageX,
  Plus,
  ShoppingCart,
  Truck,
  Undo2,
  Warehouse,
} from "lucide-react";
import { requirePagePermission } from "@/server/auth/session";
import { getDashboard } from "@/server/services/report.service";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatMoney, formatQty, formatTime } from "@/lib/format";
import { can } from "@/server/auth/actor";
import { SalesChart } from "./sales-chart";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const actor = await requirePagePermission("dashboard.view");
  const d = await getDashboard(actor);
  const m = (v: string) => (d.showMoney ? formatMoney(v, d.currency) : "—");

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Hello, ${actor.name.split(" ")[0]}`}
        description="Here is what is happening in the shop today."
        actions={
          <>
            {can(actor, "sales.create") && (
              <Button asChild>
                <Link href="/sales/new">
                  <Plus /> New sale
                </Link>
              </Button>
            )}
            {can(actor, "purchases.create") && (
              <Button asChild variant="outline">
                <Link href="/purchases/new">
                  <ArrowDownToLine /> Receive stock
                </Link>
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Today's sales" value={m(d.cards.salesToday.value)} sub={`${d.cards.salesToday.count} invoice(s)`} icon={ShoppingCart} href="/sales" />
        <StatCard label="Today's purchases" value={m(d.cards.purchasesToday.value)} sub={`${d.cards.purchasesToday.count} receipt(s)`} icon={ArrowDownToLine} href="/purchases" />
        <StatCard label="Today's returns" value={d.cards.returnsToday.count} sub={d.showMoney ? `${formatMoney(d.cards.returnsToday.value)} refunded` : undefined} icon={Undo2} href="/returns" />
        <StatCard label="Pending dispatch" value={d.cards.pendingDispatch} sub="Pending + packed" icon={Truck} tone={d.cards.pendingDispatch > 0 ? "warning" : "success"} href="/dispatch" />
        <StatCard label="Inventory value (at cost)" value={m(d.cards.inventoryValue)} icon={IndianRupee} href="/reports/inventory" />
        <StatCard label="Low stock items" value={d.cards.lowStock} icon={AlertTriangle} tone={d.cards.lowStock ? "warning" : "success"} href="/inventory?status=low" />
        <StatCard label="Out of stock items" value={d.cards.outOfStock} icon={PackageX} tone={d.cards.outOfStock ? "danger" : "success"} href="/inventory?status=out" />
        <StatCard label="Inventory" value="View stock" icon={Warehouse} href="/inventory" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Sales — last 14 days</CardTitle>
          </CardHeader>
          <CardContent>
            {d.showMoney ? <SalesChart data={d.salesDaily} /> : <p className="text-sm text-muted-foreground">Sales values are visible to the owner/admin.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top sellers (14 days)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {d.topProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sales yet.</p>
            ) : (
              d.topProducts.map((p, i) => (
                <div key={p.variantId} className="flex items-center gap-3 text-sm">
                  <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-medium">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="font-medium tabular">{formatQty(p.qty)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent sales</CardTitle>
            <CardAction><Link href="/sales" className="text-sm text-primary hover:underline">View all</Link></CardAction>
          </CardHeader>
          <CardContent className="space-y-1">
            {d.recentSales.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sales yet. Open the POS to create the first sale.</p>
            ) : (
              d.recentSales.map((s) => (
                <Link key={s.id} href={`/sales/${s.id}`} className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                  <span className="w-24 font-mono text-xs">{s.number}</span>
                  <span className="min-w-0 flex-1 truncate">{s.customerName}</span>
                  <span className="hidden text-xs text-muted-foreground sm:inline">{formatTime(s.createdAt, d.timezone)}</span>
                  <StatusBadge status={s.status === "CANCELLED" ? "CANCELLED" : s.paymentStatus} />
                  <span className="w-24 text-right font-medium tabular">{m(s.total)}</span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Needs restocking</CardTitle>
            <CardAction><Link href="/inventory?status=low" className="text-sm text-primary hover:underline">View all</Link></CardAction>
          </CardHeader>
          <CardContent className="space-y-1">
            {d.lowStock.length === 0 ? (
              <p className="text-sm text-muted-foreground">All items are above their minimum level.</p>
            ) : (
              d.lowStock.map((v) => (
                <Link key={v.variantId} href={`/inventory/${v.variantId}`} className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                  <span className="min-w-0 flex-1 truncate">{v.name}</span>
                  <span className="text-xs text-muted-foreground">min {formatQty(v.threshold)}</span>
                  <StatusBadge status={Number(v.onHand) <= 0 ? "OUT_OF_STOCK" : "LOW_STOCK"} label={`${formatQty(v.onHand)} ${v.unit.toLowerCase()}`} />
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
