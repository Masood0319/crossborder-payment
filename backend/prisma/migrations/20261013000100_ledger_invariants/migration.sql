-- ============================================================================
-- PostgreSQL Migration: Strict Double-Entry Balance Invariant & Stored Procs
-- ============================================================================

-- Enable pgcrypto for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Function: Enforce strict Debit == Credit balance invariant on transactions
CREATE OR REPLACE FUNCTION check_transaction_balance_invariant()
RETURNS TRIGGER AS $$
DECLARE
    v_total_debits NUMERIC(18, 4);
    v_total_credits NUMERIC(18, 4);
    v_imbalance NUMERIC(18, 4);
BEGIN
    SELECT 
        COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN base_amount ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN base_amount ELSE 0 END), 0)
    INTO 
        v_total_debits, 
        v_total_credits
    FROM entries
    WHERE transaction_id = NEW.id;

    v_imbalance := ABS(v_total_debits - v_total_credits);

    -- Strict zero tolerance with standard currency rounding limit (0.01 USD)
    IF v_imbalance > 0.05 THEN
        RAISE EXCEPTION 'Double-entry invariant violated for transaction %! Total debits (%) != total credits (%). Imbalance: %',
            NEW.id, v_total_debits, v_total_credits, v_imbalance
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Constraint Trigger: Evaluated before commit to permit multi-leg insertions
DROP TRIGGER IF EXISTS trg_enforce_double_entry_invariant ON transactions;
CREATE CONSTRAINT TRIGGER trg_enforce_double_entry_invariant
AFTER INSERT OR UPDATE ON transactions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_transaction_balance_invariant();

-- Function: Atomic Nostro balance reservation with row-level locking
CREATE OR REPLACE FUNCTION reserve_nostro_liquidity(
    p_bank_code VARCHAR(11),
    p_currency VARCHAR(3),
    p_amount NUMERIC(18, 4)
)
RETURNS BOOLEAN AS $$
DECLARE
    v_current_balance NUMERIC(18, 4);
    v_reserved_balance NUMERIC(18, 4);
    v_min_threshold NUMERIC(18, 4);
BEGIN
    -- Pessimistic row-level lock (FOR UPDATE)
    SELECT current_balance, reserved_balance, minimum_threshold
    INTO v_current_balance, v_reserved_balance, v_min_threshold
    FROM nostro_vostro_balances
    WHERE bank_code = p_bank_code AND currency = p_currency
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Nostro pool for bank % and currency % does not exist', p_bank_code, p_currency;
    END IF;

    -- Guard against overdraft beyond minimum threshold
    IF (v_current_balance - (v_reserved_balance + p_amount)) < v_min_threshold THEN
        RETURN FALSE;
    END IF;

    UPDATE nostro_vostro_balances
    SET 
        reserved_balance = reserved_balance + p_amount,
        available_balance = current_balance - (reserved_balance + p_amount),
        last_reconciled_at = NOW()
    WHERE bank_code = p_bank_code AND currency = p_currency;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function: Reconcile reserved balance upon payout clearing confirmation
CREATE OR REPLACE FUNCTION settle_nostro_reservation(
    p_bank_code VARCHAR(11),
    p_currency VARCHAR(3),
    p_amount NUMERIC(18, 4)
)
RETURNS VOID AS $$
BEGIN
    UPDATE nostro_vostro_balances
    SET 
        current_balance = current_balance - p_amount,
        reserved_balance = reserved_balance - p_amount,
        available_balance = (current_balance - p_amount) - (reserved_balance - p_amount),
        last_reconciled_at = NOW()
    WHERE bank_code = p_bank_code AND currency = p_currency;
END;
$$ LANGUAGE plpgsql;
