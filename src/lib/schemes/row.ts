import type { SchemeCandidate } from "./engine";

export type SchemeRow = {
  id: string;
  name?: string;
  type: string;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  minimumQuantity: number | null;
  freeQuantity: number | null;
  discountPercent: { toString(): string } | string | null;
};

export function toSchemeCandidate(row: SchemeRow): SchemeCandidate {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    isActive: row.isActive,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    minimumQuantity: row.minimumQuantity,
    freeQuantity: row.freeQuantity,
    discountPercent: row.discountPercent,
  };
}
