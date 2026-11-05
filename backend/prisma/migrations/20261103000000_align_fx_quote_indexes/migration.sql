DROP INDEX IF EXISTS "fx_quotes_quoteId_idx";

ALTER INDEX IF EXISTS "fx_quotes_user_id_state_expires_at_idx"
    RENAME TO "fx_quotes_user_id_state_expiresAt_idx";
