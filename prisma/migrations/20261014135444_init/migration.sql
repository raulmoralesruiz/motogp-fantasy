-- CreateEnum
CREATE TYPE "SeasonStatus" AS ENUM ('planned', 'active', 'finished', 'archived');

-- CreateEnum
CREATE TYPE "GpStatus" AS ENUM ('scheduled', 'locked', 'finished', 'cancelled');

-- CreateEnum
CREATE TYPE "WeekendEventType" AS ENUM ('q1', 'q2', 'sprint', 'race');

-- CreateEnum
CREATE TYPE "WeekendEventStatus" AS ENUM ('scheduled', 'finished', 'cancelled');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('rider', 'constructor', 'team');

-- CreateEnum
CREATE TYPE "PriceReason" AS ENUM ('formula', 'manual');

-- CreateEnum
CREATE TYPE "LineupStatus" AS ENUM ('draft', 'locked', 'submitted');

-- CreateEnum
CREATE TYPE "SlotType" AS ENUM ('gold', 'silver', 'constructor', 'team');

-- CreateEnum
CREATE TYPE "LineupChangeType" AS ENUM ('add', 'remove', 'swap', 'gold_silver');

-- CreateEnum
CREATE TYPE "BudgetMovementType" AS ENUM ('base', 'carry', 'spend', 'adjust');

-- CreateEnum
CREATE TYPE "LeagueType" AS ENUM ('private', 'public');

-- CreateEnum
CREATE TYPE "LeagueVisibility" AS ENUM ('public', 'unlisted', 'private');

-- CreateEnum
CREATE TYPE "LeagueEntryMode" AS ENUM ('code', 'invite', 'mixed');

-- CreateEnum
CREATE TYPE "LeagueStatus" AS ENUM ('planned', 'active', 'finished', 'archived');

-- CreateEnum
CREATE TYPE "LeagueMemberRole" AS ENUM ('admin', 'member');

-- CreateEnum
CREATE TYPE "LeagueMemberStatus" AS ENUM ('active', 'left', 'kicked');

-- CreateEnum
CREATE TYPE "LeagueInviteStatus" AS ENUM ('active', 'revoked');

-- CreateEnum
CREATE TYPE "ResultStatus" AS ENUM ('provisional', 'definitive', 'corrected');

-- CreateEnum
CREATE TYPE "ResultSource" AS ENUM ('auto', 'manual');

-- CreateEnum
CREATE TYPE "ResultsEventStatus" AS ENUM ('scheduled', 'finished', 'neutralized', 'cancelled');

-- CreateEnum
CREATE TYPE "RoleName" AS ENUM ('user', 'global_admin');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "is_anonymized" BOOLEAN NOT NULL DEFAULT false,
    "anonymized_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "avatar_url" TEXT,
    "preferences" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "name" "RoleName" NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "granted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seasons" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "start_date" TIMESTAMPTZ,
    "end_date" TIMESTAMPTZ,
    "status" "SeasonStatus" NOT NULL DEFAULT 'planned',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "season_rules" (
    "id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "season_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "circuits" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "location" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "circuits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gps" (
    "id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "round" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "circuit_id" UUID NOT NULL,
    "date" TIMESTAMPTZ NOT NULL,
    "status" "GpStatus" NOT NULL DEFAULT 'scheduled',
    "lockout_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekend_events" (
    "id" UUID NOT NULL,
    "gp_id" UUID NOT NULL,
    "type" "WeekendEventType" NOT NULL,
    "order_num" INTEGER NOT NULL,
    "start_time" TIMESTAMPTZ,
    "status" "WeekendEventStatus" NOT NULL DEFAULT 'scheduled',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weekend_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "riders" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "number" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "riders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "constructors" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "constructors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "constructor_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rider_affiliations" (
    "id" UUID NOT NULL,
    "rider_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "constructor_id" UUID NOT NULL,
    "gp_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rider_affiliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prices" (
    "id" UUID NOT NULL,
    "asset_type" "AssetType" NOT NULL,
    "asset_id" UUID NOT NULL,
    "gp_id" UUID,
    "price" DECIMAL(10,2) NOT NULL,
    "reason" "PriceReason" NOT NULL DEFAULT 'formula',
    "rules_version" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lineups" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "gp_id" UUID NOT NULL,
    "status" "LineupStatus" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lineups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lineup_slots" (
    "id" UUID NOT NULL,
    "lineup_id" UUID NOT NULL,
    "slot_type" "SlotType" NOT NULL,
    "asset_type" "AssetType" NOT NULL,
    "asset_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lineup_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lineup_changes" (
    "id" UUID NOT NULL,
    "lineup_id" UUID NOT NULL,
    "gp_id" UUID NOT NULL,
    "type" "LineupChangeType" NOT NULL,
    "asset_type" "AssetType" NOT NULL,
    "asset_id" UUID NOT NULL,
    "cost_before" DECIMAL(10,2),
    "cost_after" DECIMAL(10,2),
    "reason" TEXT,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lineup_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_movements" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "gp_id" UUID NOT NULL,
    "type" "BudgetMovementType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "reference" TEXT,
    "rules_version" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leagues" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LeagueType" NOT NULL DEFAULT 'private',
    "visibility" "LeagueVisibility" NOT NULL DEFAULT 'private',
    "min_members" INTEGER NOT NULL DEFAULT 2,
    "max_members" INTEGER NOT NULL DEFAULT 50,
    "entry_mode" "LeagueEntryMode" NOT NULL DEFAULT 'code',
    "start_date" TIMESTAMPTZ,
    "end_date" TIMESTAMPTZ,
    "status" "LeagueStatus" NOT NULL DEFAULT 'planned',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leagues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "league_members" (
    "id" UUID NOT NULL,
    "league_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "LeagueMemberRole" NOT NULL DEFAULT 'member',
    "status" "LeagueMemberStatus" NOT NULL DEFAULT 'active',
    "joined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "league_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "league_invites" (
    "id" UUID NOT NULL,
    "league_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "status" "LeagueInviteStatus" NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMPTZ,
    "max_uses" INTEGER,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "league_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "results_events" (
    "id" UUID NOT NULL,
    "gp_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "status" "ResultsEventStatus" NOT NULL DEFAULT 'scheduled',
    "neutralized" BOOLEAN NOT NULL DEFAULT false,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "results_version" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "results_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "results" (
    "id" UUID NOT NULL,
    "gp_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "rider_id" UUID NOT NULL,
    "position" INTEGER,
    "raw_points" DECIMAL(10,2),
    "status" "ResultStatus" NOT NULL DEFAULT 'provisional',
    "results_version" TEXT,
    "source" "ResultSource" NOT NULL DEFAULT 'manual',
    "source_name" TEXT,
    "raw" JSONB,
    "imported_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "results_history" (
    "id" UUID NOT NULL,
    "result_id" UUID NOT NULL,
    "before_data" JSONB NOT NULL,
    "after_data" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "results_version" TEXT,
    "user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "results_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scores" (
    "id" UUID NOT NULL,
    "lineup_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "gp_id" UUID NOT NULL,
    "points_total" DECIMAL(10,2) NOT NULL,
    "breakdown" JSONB NOT NULL,
    "rules_version" TEXT NOT NULL,
    "results_version" TEXT NOT NULL,
    "computed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rankings" (
    "id" UUID NOT NULL,
    "league_id" UUID NOT NULL,
    "gp_id" UUID,
    "user_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "points" DECIMAL(10,2) NOT NULL,
    "tiebreakers" JSONB,
    "results_version" TEXT NOT NULL,
    "computed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rankings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before_data" JSONB,
    "after_data" JSONB,
    "ip" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_user_id_key" ON "profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_id_role_id_key" ON "user_roles"("user_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "season_rules_season_id_version_key" ON "season_rules"("season_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "circuits_name_country_key" ON "circuits"("name", "country");

-- CreateIndex
CREATE UNIQUE INDEX "gps_season_id_round_key" ON "gps"("season_id", "round");

-- CreateIndex
CREATE UNIQUE INDEX "weekend_events_gp_id_type_order_num_key" ON "weekend_events"("gp_id", "type", "order_num");

-- CreateIndex
CREATE UNIQUE INDEX "riders_name_key" ON "riders"("name");

-- CreateIndex
CREATE UNIQUE INDEX "constructors_name_key" ON "constructors"("name");

-- CreateIndex
CREATE UNIQUE INDEX "teams_name_key" ON "teams"("name");

-- CreateIndex
CREATE UNIQUE INDEX "rider_affiliations_rider_id_gp_id_key" ON "rider_affiliations"("rider_id", "gp_id");

-- CreateIndex
CREATE UNIQUE INDEX "prices_asset_type_asset_id_gp_id_key" ON "prices"("asset_type", "asset_id", "gp_id");

-- CreateIndex
CREATE INDEX "lineups_gp_id_idx" ON "lineups"("gp_id");

-- CreateIndex
CREATE UNIQUE INDEX "lineups_user_id_gp_id_key" ON "lineups"("user_id", "gp_id");

-- CreateIndex
CREATE INDEX "lineup_slots_lineup_id_idx" ON "lineup_slots"("lineup_id");

-- CreateIndex
CREATE INDEX "lineup_slots_asset_type_asset_id_idx" ON "lineup_slots"("asset_type", "asset_id");

-- CreateIndex
CREATE INDEX "lineup_changes_lineup_id_idx" ON "lineup_changes"("lineup_id");

-- CreateIndex
CREATE INDEX "budget_movements_user_id_gp_id_idx" ON "budget_movements"("user_id", "gp_id");

-- CreateIndex
CREATE INDEX "league_members_user_id_idx" ON "league_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "league_members_league_id_user_id_key" ON "league_members"("league_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "league_invites_code_key" ON "league_invites"("code");

-- CreateIndex
CREATE INDEX "league_invites_league_id_idx" ON "league_invites"("league_id");

-- CreateIndex
CREATE UNIQUE INDEX "results_events_gp_id_event_id_key" ON "results_events"("gp_id", "event_id");

-- CreateIndex
CREATE INDEX "results_event_id_idx" ON "results"("event_id");

-- CreateIndex
CREATE INDEX "results_rider_id_idx" ON "results"("rider_id");

-- CreateIndex
CREATE UNIQUE INDEX "results_gp_id_event_id_rider_id_key" ON "results"("gp_id", "event_id", "rider_id");

-- CreateIndex
CREATE INDEX "results_history_result_id_idx" ON "results_history"("result_id");

-- CreateIndex
CREATE INDEX "scores_user_id_gp_id_idx" ON "scores"("user_id", "gp_id");

-- CreateIndex
CREATE INDEX "scores_gp_id_idx" ON "scores"("gp_id");

-- CreateIndex
CREATE UNIQUE INDEX "scores_lineup_id_results_version_key" ON "scores"("lineup_id", "results_version");

-- CreateIndex
CREATE INDEX "rankings_league_id_gp_id_idx" ON "rankings"("league_id", "gp_id");

-- CreateIndex
CREATE INDEX "rankings_league_id_idx" ON "rankings"("league_id");

-- CreateIndex
CREATE INDEX "audit_log_actor_id_created_at_idx" ON "audit_log"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_entity_entity_id_idx" ON "audit_log"("entity", "entity_id");

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_rules" ADD CONSTRAINT "season_rules_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gps" ADD CONSTRAINT "gps_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gps" ADD CONSTRAINT "gps_circuit_id_fkey" FOREIGN KEY ("circuit_id") REFERENCES "circuits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekend_events" ADD CONSTRAINT "weekend_events_gp_id_fkey" FOREIGN KEY ("gp_id") REFERENCES "gps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_constructor_id_fkey" FOREIGN KEY ("constructor_id") REFERENCES "constructors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_affiliations" ADD CONSTRAINT "rider_affiliations_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_affiliations" ADD CONSTRAINT "rider_affiliations_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_affiliations" ADD CONSTRAINT "rider_affiliations_constructor_id_fkey" FOREIGN KEY ("constructor_id") REFERENCES "constructors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_affiliations" ADD CONSTRAINT "rider_affiliations_gp_id_fkey" FOREIGN KEY ("gp_id") REFERENCES "gps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prices" ADD CONSTRAINT "prices_gp_id_fkey" FOREIGN KEY ("gp_id") REFERENCES "gps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lineups" ADD CONSTRAINT "lineups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lineups" ADD CONSTRAINT "lineups_gp_id_fkey" FOREIGN KEY ("gp_id") REFERENCES "gps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lineup_slots" ADD CONSTRAINT "lineup_slots_lineup_id_fkey" FOREIGN KEY ("lineup_id") REFERENCES "lineups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lineup_changes" ADD CONSTRAINT "lineup_changes_lineup_id_fkey" FOREIGN KEY ("lineup_id") REFERENCES "lineups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lineup_changes" ADD CONSTRAINT "lineup_changes_gp_id_fkey" FOREIGN KEY ("gp_id") REFERENCES "gps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lineup_changes" ADD CONSTRAINT "lineup_changes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_movements" ADD CONSTRAINT "budget_movements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_movements" ADD CONSTRAINT "budget_movements_gp_id_fkey" FOREIGN KEY ("gp_id") REFERENCES "gps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_members" ADD CONSTRAINT "league_members_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_members" ADD CONSTRAINT "league_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_invites" ADD CONSTRAINT "league_invites_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_invites" ADD CONSTRAINT "league_invites_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "results_events" ADD CONSTRAINT "results_events_gp_id_fkey" FOREIGN KEY ("gp_id") REFERENCES "gps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "results_events" ADD CONSTRAINT "results_events_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "weekend_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "results" ADD CONSTRAINT "results_gp_id_fkey" FOREIGN KEY ("gp_id") REFERENCES "gps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "results" ADD CONSTRAINT "results_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "weekend_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "results" ADD CONSTRAINT "results_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "results_history" ADD CONSTRAINT "results_history_result_id_fkey" FOREIGN KEY ("result_id") REFERENCES "results"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "results_history" ADD CONSTRAINT "results_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scores" ADD CONSTRAINT "scores_lineup_id_fkey" FOREIGN KEY ("lineup_id") REFERENCES "lineups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scores" ADD CONSTRAINT "scores_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scores" ADD CONSTRAINT "scores_gp_id_fkey" FOREIGN KEY ("gp_id") REFERENCES "gps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rankings" ADD CONSTRAINT "rankings_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rankings" ADD CONSTRAINT "rankings_gp_id_fkey" FOREIGN KEY ("gp_id") REFERENCES "gps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rankings" ADD CONSTRAINT "rankings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
