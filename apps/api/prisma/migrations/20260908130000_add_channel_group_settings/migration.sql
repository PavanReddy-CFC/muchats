-- CreateEnum
CREATE TYPE "ChannelPostingPolicy" AS ENUM ('EVERYONE', 'ADMINS_ONLY');

-- AlterTable
ALTER TABLE "channels" ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "postingPolicy" "ChannelPostingPolicy" NOT NULL DEFAULT 'EVERYONE';
