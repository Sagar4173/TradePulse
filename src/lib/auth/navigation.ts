import type { Role } from "./types";

export type NavigationIcon =
  | "dashboard"
  | "catalogue"
  | "capture"
  | "cart"
  | "orders"
  | "retailers"
  | "account"
  | "users"
  | "products"
  | "inventory"
  | "schemes"
  | "audit";

export type NavigationItem = {
  href: string;
  label: string;
  icon: NavigationIcon;
};

const DASHBOARD: NavigationItem = {
  href: "/dashboard",
  label: "Dashboard",
  icon: "dashboard",
};

const ACCOUNT: NavigationItem = {
  href: "/account",
  label: "Account",
  icon: "account",
};

const NAVIGATION: Record<Role, readonly NavigationItem[]> = {
  RETAILER: [
    DASHBOARD,
    { href: "/catalogue", label: "Product Catalogue", icon: "catalogue" },
    { href: "/ai-capture", label: "AI Order Capture", icon: "capture" },
    { href: "/cart", label: "Cart", icon: "cart" },
    { href: "/orders", label: "My Orders", icon: "orders" },
    ACCOUNT,
  ],
  SALESMAN: [
    DASHBOARD,
    { href: "/retailers", label: "Assigned Retailers", icon: "retailers" },
    { href: "/orders", label: "Orders", icon: "orders" },
    ACCOUNT,
  ],
  ORDER_DESK: [
    DASHBOARD,
    { href: "/orders", label: "Order Management", icon: "orders" },
    { href: "/retailers", label: "Retailers", icon: "retailers" },
    ACCOUNT,
  ],
  ADMIN: [
    DASHBOARD,
    { href: "/users", label: "Users", icon: "users" },
    { href: "/retailers", label: "Retailers", icon: "retailers" },
    { href: "/orders", label: "Order Management", icon: "orders" },
    { href: "/products", label: "Products", icon: "products" },
    { href: "/inventory", label: "Inventory", icon: "inventory" },
    { href: "/schemes", label: "Schemes", icon: "schemes" },
    { href: "/audit-logs", label: "Audit Logs", icon: "audit" },
  ],
};

export function getNavigationForRole(role: Role): readonly NavigationItem[] {
  return NAVIGATION[role];
}

export const ROLE_LABELS: Record<Role, string> = {
  RETAILER: "Retailer",
  SALESMAN: "Salesman",
  ORDER_DESK: "Order Desk",
  ADMIN: "Administrator",
};
