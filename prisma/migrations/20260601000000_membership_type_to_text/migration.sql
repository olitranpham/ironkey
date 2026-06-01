-- Convert membershipType from the MembershipType enum to plain TEXT.
-- Existing enum values (FOUNDING, GENERAL, etc.) are preserved as-is;
-- the backfill script lowercases them in a separate pass.

ALTER TABLE "Member" ALTER COLUMN "membershipType" TYPE TEXT;
ALTER TABLE "Member" ALTER COLUMN "membershipType" SET DEFAULT 'general';

DROP TYPE "MembershipType";
