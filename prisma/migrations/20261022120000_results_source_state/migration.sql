-- AlterTable
ALTER TABLE "gps" ADD COLUMN "source_ref" TEXT;

-- CreateTable
CREATE TABLE "rider_mappings" (
    "source" TEXT NOT NULL,
    "rider_ref" TEXT NOT NULL,
    "rider_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rider_mappings_pkey" PRIMARY KEY ("source", "rider_ref")
);

-- CreateTable
CREATE TABLE "source_state" (
    "gp_id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "last_attempt_at" TIMESTAMPTZ,
    "last_success_at" TIMESTAMPTZ,
    "last_unmapped" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_state_pkey" PRIMARY KEY ("gp_id", "event", "source")
);

-- CreateIndex
CREATE INDEX "rider_mappings_rider_id_idx" ON "rider_mappings"("rider_id");

-- AddForeignKey
ALTER TABLE "rider_mappings" ADD CONSTRAINT "rider_mappings_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_state" ADD CONSTRAINT "source_state_gp_id_fkey" FOREIGN KEY ("gp_id") REFERENCES "gps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
