-- Milestone 2.5 retailer link-request history hardening (additive, not applied).
--
-- Migration 3 created RetailerLinkRequest with a global unique pair and
-- cascading foreign keys. That combination silently destroys review history:
-- deleting a user or retailer removed their requests, and a rejected request
-- blocked a later legitimate request for the same user/retailer pair.
--
-- This migration:
--   1. Replaces the global unique (userId, retailerId) constraint with a
--      non-unique history index.
--   2. Adds a partial unique index that allows at most one PENDING request per
--      user/retailer pair while preserving APPROVED and REJECTED history.
--   3. Changes the user, retailer, and reviewer foreign keys to ON DELETE
--      RESTRICT so reviewed history cannot be cascade-deleted. Deleting a user
--      or retailer must be an explicit, reviewed decision.
--
-- No existing rows are rewritten or deleted. The previous global unique index
-- guarantees that no duplicate PENDING pair can exist, so the partial unique
-- index can be created without a data cleanup step. Review this SQL before
-- applying it; do not apply it as part of the code-hardening phase.
--
-- Rollback (only with an explicit reviewed decision): drop the partial unique
-- index, restore a global unique index on (userId, retailerId), and restore the
-- previous CASCADE/SET NULL foreign-key actions. A rollback fails if history
-- would create a duplicate pair, which is expected: that history is the reason
-- this migration exists.

-- Replace the global uniqueness constraint with history-preserving indexes.
DROP INDEX "RetailerLinkRequest_userId_retailerId_key";

CREATE INDEX "RetailerLinkRequest_userId_retailerId_idx"
    ON "RetailerLinkRequest"("userId", "retailerId");

CREATE UNIQUE INDEX "RetailerLinkRequest_userId_retailerId_pending_key"
    ON "RetailerLinkRequest"("userId", "retailerId")
    WHERE "status" = 'PENDING';

-- Preserve link-request and review history when referenced rows are deleted.
ALTER TABLE "RetailerLinkRequest"
    DROP CONSTRAINT "RetailerLinkRequest_userId_fkey";
ALTER TABLE "RetailerLinkRequest"
    ADD CONSTRAINT "RetailerLinkRequest_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RetailerLinkRequest"
    DROP CONSTRAINT "RetailerLinkRequest_retailerId_fkey";
ALTER TABLE "RetailerLinkRequest"
    ADD CONSTRAINT "RetailerLinkRequest_retailerId_fkey"
    FOREIGN KEY ("retailerId") REFERENCES "Retailer"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RetailerLinkRequest"
    DROP CONSTRAINT "RetailerLinkRequest_reviewedById_fkey";
ALTER TABLE "RetailerLinkRequest"
    ADD CONSTRAINT "RetailerLinkRequest_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
