import type { Role } from "./types";

export const PERMISSIONS = {
  DASHBOARD_VIEW: "dashboard:view",
  CATALOGUE_VIEW: "catalogue:view",
  ORDERS_VIEW_OWN: "orders:view:own",
  ORDERS_VIEW_ASSIGNED: "orders:view:assigned",
  ORDERS_VIEW_ALL: "orders:view:all",
  ORDERS_SUBMIT_OWN: "orders:submit:own",
  ORDERS_CANCEL_OWN: "orders:cancel:own",
  ORDERS_MANAGE: "orders:manage",
  ORDERS_EXPORT: "orders:export",
  AI_CAPTURE_USE: "ai-capture:use",
  AI_CAPTURE_MANAGE: "ai-capture:manage",
  RETAILERS_VIEW_ASSIGNED: "retailers:view:assigned",
  RETAILERS_VIEW_ALL: "retailers:view:all",
  USERS_VIEW: "users:view",
  USERS_MANAGE: "users:manage",
  PRODUCTS_VIEW: "products:view",
  INVENTORY_VIEW: "inventory:view",
  SCHEMES_VIEW: "schemes:view",
  AUDIT_VIEW: "audit:view",
  CREDIT_VIEW_OWN: "credit:view:own",
  CREDIT_VIEW_ALL: "credit:view:all",
  ACCOUNT_VIEW: "account:view",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const ALL_PERMISSIONS = Object.values(PERMISSIONS) as Permission[];

const RETAILER_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.DASHBOARD_VIEW,
  PERMISSIONS.CATALOGUE_VIEW,
  PERMISSIONS.ORDERS_VIEW_OWN,
  PERMISSIONS.ORDERS_SUBMIT_OWN,
  PERMISSIONS.ORDERS_CANCEL_OWN,
  PERMISSIONS.AI_CAPTURE_USE,
  PERMISSIONS.CREDIT_VIEW_OWN,
  PERMISSIONS.ACCOUNT_VIEW,
];

const SALESMAN_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.DASHBOARD_VIEW,
  PERMISSIONS.ORDERS_VIEW_ASSIGNED,
  PERMISSIONS.RETAILERS_VIEW_ASSIGNED,
  PERMISSIONS.ACCOUNT_VIEW,
];

const ORDER_DESK_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.DASHBOARD_VIEW,
  PERMISSIONS.ORDERS_VIEW_ALL,
  PERMISSIONS.ORDERS_MANAGE,
  PERMISSIONS.ORDERS_EXPORT,
  PERMISSIONS.RETAILERS_VIEW_ALL,
  PERMISSIONS.CREDIT_VIEW_ALL,
  PERMISSIONS.ACCOUNT_VIEW,
];

/**
 * The single source of truth for server-side role authorization. UI navigation
 * and disabled controls are conveniences layered on top of this map.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  RETAILER: RETAILER_PERMISSIONS,
  SALESMAN: SALESMAN_PERMISSIONS,
  ORDER_DESK: ORDER_DESK_PERMISSIONS,
  ADMIN: ALL_PERMISSIONS,
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function hasAnyPermission(
  role: Role,
  permissions: readonly Permission[],
): boolean {
  return permissions.some((permission) => hasPermission(role, permission));
}

export function canAccessRetailer(
  role: Role,
  ownRetailerId: string | null,
  assignedRetailerIds: readonly string[],
  targetRetailerId: string,
): boolean {
  switch (role) {
    case "RETAILER":
      return ownRetailerId !== null && ownRetailerId === targetRetailerId;
    case "SALESMAN":
      return assignedRetailerIds.includes(targetRetailerId);
    case "ORDER_DESK":
    case "ADMIN":
      return true;
  }
}

export function canAccessOrder(
  role: Role,
  ownRetailerId: string | null,
  assignedRetailerIds: readonly string[],
  orderRetailerId: string,
): boolean {
  return canAccessRetailer(
    role,
    ownRetailerId,
    assignedRetailerIds,
    orderRetailerId,
  );
}
