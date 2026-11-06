-- Canonical normalized phone identity for users.
--
-- This migration is additive: it adds a nullable column, backfills the
-- canonical E.164 value derived from the existing display phone, and only then
-- enforces NOT NULL plus the unique and format constraints.
--
-- It deliberately does not rewrite User.phone, merge users, or delete rows.
-- If any existing row has an invalid Indian mobile number, or if two rows
-- normalize to the same number, the migration raises an exception before the
-- constraints are created. Remediation:
--   1. Review the user IDs and masked phone endings listed in the error.
--   2. Correct invalid phone values, or decide manually which duplicate account
--      should retain the phone and how the other account should be handled.
--   3. Mark the failed migration as rolled back, then re-run the deployment.
--      Never delete or merge production users without an explicit, reviewed
--      data decision.
--
-- Privacy note: error examples intentionally show only the last four phone
-- digits. If this migration has already been applied in any environment, do not
-- edit it silently; create a new additive migration and document the checksum
-- difference instead.

ALTER TABLE "User" ADD COLUMN "phoneNormalized" TEXT;

DO $$
DECLARE
  invalid_count integer;
  duplicate_count integer;
  invalid_examples text;
  duplicate_examples text;
BEGIN
  -- Normalize the same common Indian formats accepted by the application:
  -- punctuation and whitespace are ignored; 91/0 prefixes are stripped only
  -- when the remaining ten digits form a valid Indian mobile number.
  UPDATE "User"
  SET "phoneNormalized" = normalized.normalized_phone
  FROM (
    SELECT
      "id",
      CASE
        WHEN length(digits) = 12
          AND digits LIKE '91%'
          AND substr(digits, 3) ~ '^[6-9][0-9]{9}$'
          THEN '+91' || substr(digits, 3)
        WHEN length(digits) = 11
          AND digits LIKE '0%'
          AND substr(digits, 2) ~ '^[6-9][0-9]{9}$'
          THEN '+91' || substr(digits, 2)
        WHEN digits ~ '^[6-9][0-9]{9}$'
          THEN '+91' || digits
        ELSE NULL
      END AS normalized_phone
    FROM (
      SELECT "id", regexp_replace("phone", '[^0-9]', '', 'g') AS digits
      FROM "User"
    ) AS digit_rows
  ) AS normalized
  WHERE "User"."id" = normalized."id";

  SELECT count(*)
  INTO invalid_count
  FROM "User"
  WHERE "phoneNormalized" IS NULL;

  SELECT string_agg(
    format(
      '%s (ending %s)',
      "id",
      right(regexp_replace("phone", '[^0-9]', '', 'g'), 4)
    ),
    ', ' ORDER BY "id"
  )
  INTO invalid_examples
  FROM (
    SELECT "id", "phone"
    FROM "User"
    WHERE "phoneNormalized" IS NULL
    ORDER BY "id"
    LIMIT 10
  ) AS invalid_rows;

  IF invalid_count > 0 THEN
    RAISE EXCEPTION
      'Cannot add User.phoneNormalized: % user row(s) have an invalid Indian mobile number. Examples: %. Correct the phone values and rerun the migration. No users were deleted or merged.',
      invalid_count,
      coalesce(invalid_examples, 'none');
  END IF;

  SELECT count(*)
  INTO duplicate_count
  FROM (
    SELECT "phoneNormalized"
    FROM "User"
    GROUP BY "phoneNormalized"
    HAVING count(*) > 1
  ) AS duplicate_groups;

  SELECT string_agg(
    format('ending %s -> %s', right("phoneNormalized", 4), "ids"),
    '; ' ORDER BY "phoneNormalized"
  )
  INTO duplicate_examples
  FROM (
    SELECT
      "phoneNormalized",
      string_agg("id", ', ' ORDER BY "id") AS "ids"
    FROM "User"
    GROUP BY "phoneNormalized"
    HAVING count(*) > 1
    ORDER BY "phoneNormalized"
    LIMIT 5
  ) AS duplicate_rows;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION
      'Cannot add User.phoneNormalized: % duplicate normalized phone number(s) are shared by multiple users. Examples: %. Resolve the duplicates manually by reviewing the listed user IDs, then rerun the migration. No users were deleted or merged.',
      duplicate_count,
      coalesce(duplicate_examples, 'none');
  END IF;
END
$$;

ALTER TABLE "User" ALTER COLUMN "phoneNormalized" SET NOT NULL;

CREATE UNIQUE INDEX "User_phoneNormalized_key" ON "User"("phoneNormalized");

ALTER TABLE "User" ADD CONSTRAINT "User_phoneNormalized_format"
  CHECK ("phoneNormalized" ~ '^[+]91[6-9][0-9]{9}$');
