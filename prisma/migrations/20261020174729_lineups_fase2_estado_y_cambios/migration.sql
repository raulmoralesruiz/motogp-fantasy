-- AlterEnum
ALTER TYPE "LineupChangeType" ADD VALUE 'wildcard';

-- AlterTable
ALTER TABLE "lineup_changes" ALTER COLUMN "asset_type" DROP NOT NULL,
ALTER COLUMN "asset_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "injury_confirmations" (
    "id" UUID NOT NULL,
    "gp_id" UUID NOT NULL,
    "asset_type" "AssetType" NOT NULL,
    "asset_id" UUID NOT NULL,
    "reason" TEXT,
    "confirmed_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "injury_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_exemptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "gp_id" UUID NOT NULL,
    "injury_confirmation_id" UUID NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_exemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "injury_confirmations_gp_id_idx" ON "injury_confirmations"("gp_id");

-- CreateIndex
CREATE UNIQUE INDEX "injury_confirmations_gp_id_asset_type_asset_id_key" ON "injury_confirmations"("gp_id", "asset_type", "asset_id");

-- CreateIndex
CREATE INDEX "change_exemptions_user_id_gp_id_idx" ON "change_exemptions"("user_id", "gp_id");

-- CreateIndex
CREATE UNIQUE INDEX "change_exemptions_user_id_gp_id_injury_confirmation_id_key" ON "change_exemptions"("user_id", "gp_id", "injury_confirmation_id");

-- AddForeignKey
ALTER TABLE "injury_confirmations" ADD CONSTRAINT "injury_confirmations_gp_id_fkey" FOREIGN KEY ("gp_id") REFERENCES "gps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "injury_confirmations" ADD CONSTRAINT "injury_confirmations_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_exemptions" ADD CONSTRAINT "change_exemptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_exemptions" ADD CONSTRAINT "change_exemptions_gp_id_fkey" FOREIGN KEY ("gp_id") REFERENCES "gps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_exemptions" ADD CONSTRAINT "change_exemptions_injury_confirmation_id_fkey" FOREIGN KEY ("injury_confirmation_id") REFERENCES "injury_confirmations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
