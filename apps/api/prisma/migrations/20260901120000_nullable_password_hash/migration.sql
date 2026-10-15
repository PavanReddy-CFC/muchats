-- AlterTable
-- passwordHash is null for a federated (Qennect) user — they authenticate via Qennect,
-- never a muchats-issued password.
ALTER TABLE "users" ALTER COLUMN "passwordHash" DROP NOT NULL;
