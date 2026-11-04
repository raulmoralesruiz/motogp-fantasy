-- D-07 (ADR-0039): 2FA TOTP (RFC 6238) por cuenta, recomendado para
-- `global_admin`. `totp_secret` = secreto base32 (solo si está matriculado);
-- `totp_enabled_at` = null ⇒ matriculado sin confirmar o desactivado.
ALTER TABLE "users"
ADD COLUMN "totp_secret" TEXT;

ALTER TABLE "users"
ADD COLUMN "totp_enabled_at" TIMESTAMPTZ;
