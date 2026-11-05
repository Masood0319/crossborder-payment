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
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Nostro reservation amount must be positive';
    END IF;

    SELECT current_balance, reserved_balance, minimum_threshold
    INTO v_current_balance, v_reserved_balance, v_min_threshold
    FROM nostro_vostro_balances
    WHERE bank_code = p_bank_code AND currency = p_currency
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Nostro pool for bank % and currency % does not exist', p_bank_code, p_currency;
    END IF;

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

CREATE OR REPLACE FUNCTION settle_nostro_reservation(
    p_bank_code VARCHAR(11),
    p_currency VARCHAR(3),
    p_amount NUMERIC(18, 4)
)
RETURNS VOID AS $$
DECLARE
    v_updated BOOLEAN;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Nostro settlement amount must be positive';
    END IF;

    UPDATE nostro_vostro_balances
    SET
        current_balance = current_balance - p_amount,
        reserved_balance = reserved_balance - p_amount,
        available_balance = current_balance - reserved_balance,
        last_reconciled_at = NOW()
    WHERE bank_code = p_bank_code
      AND currency = p_currency
      AND current_balance >= p_amount
      AND reserved_balance >= p_amount;

    v_updated := FOUND;
    IF NOT v_updated THEN
        RAISE EXCEPTION 'Nostro reservation for bank % and currency % is unavailable', p_bank_code, p_currency;
    END IF;
END;
$$ LANGUAGE plpgsql;
