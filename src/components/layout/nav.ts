import {
  ArrowDownToLine,
  BarChart3,
  Boxes,
  Factory,
  LayoutDashboard,
  Package,
  ReceiptText,
  ScrollText,
  Settings,
  ShoppingCart,
  Truck,
  Undo2,
  UserRound,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/lib/permissions";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: Permission;
  shortcut?: string;
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  { items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, permission: "dashboard.view" }] },
  {
    label: "Operations",
    items: [
      { href: "/sales", label: "Sales", icon: ShoppingCart, permission: "sales.view" },
      { href: "/purchases", label: "Purchases", icon: ArrowDownToLine, permission: "purchases.view" },
      { href: "/dispatch", label: "Dispatch", icon: Truck, permission: "dispatch.view" },
      { href: "/returns", label: "Returns", icon: Undo2, permission: "returns.view" },
    ],
  },
  {
    label: "Stock",
    items: [
      { href: "/inventory", label: "Inventory", icon: Warehouse, permission: "inventory.view" },
      { href: "/products", label: "Products", icon: Package, permission: "products.view" },
      { href: "/manufacturing", label: "Manufacturing", icon: Factory, permission: "manufacturing.view" },
    ],
  },
  {
    label: "Contacts",
    items: [
      { href: "/suppliers", label: "Suppliers", icon: Boxes, permission: "suppliers.view" },
      { href: "/customers", label: "Customers", icon: UserRound, permission: "customers.view" },
    ],
  },
  {
    label: "Insights",
    items: [
      { href: "/reports/sales", label: "Reports", icon: BarChart3, permission: "reports.view" },
      { href: "/audit", label: "Audit log", icon: ScrollText, permission: "audit.view" },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/users", label: "Users", icon: Users, permission: "users.manage" },
      { href: "/settings", label: "Settings", icon: Settings, permission: "settings.manage" },
    ],
  },
];

export const QUICK_ACTIONS: (NavItem & { keywords?: string })[] = [
  { href: "/sales/new", label: "New sale (POS)", icon: ReceiptText, permission: "sales.create", shortcut: "Alt+N", keywords: "bill billing invoice pos" },
  { href: "/purchases/new", label: "New purchase", icon: ArrowDownToLine, permission: "purchases.create", keywords: "receive stock grn" },
  { href: "/inventory?scan=1", label: "Scan product / stock lookup", icon: Warehouse, permission: "inventory.view", keywords: "barcode lookup" },
  { href: "/products/new", label: "Add product", icon: Package, permission: "products.manage", keywords: "create item sku" },
  { href: "/returns/new", label: "Process return", icon: Undo2, permission: "returns.create", keywords: "refund exchange" },
  { href: "/inventory/adjust", label: "Adjust stock / record damage", icon: Warehouse, permission: "inventory.adjust", keywords: "damage lost found" },
  { href: "/manufacturing/new", label: "Start production", icon: Factory, permission: "manufacturing.produce", keywords: "manufacture bom" },
  { href: "/inventory", label: "View inventory", icon: Warehouse, permission: "inventory.view" },
];
