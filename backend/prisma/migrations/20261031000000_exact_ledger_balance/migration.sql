CREATE OR REPLACE FUNCTION check_transaction_balance_invariant()
RETURNS TRIGGER AS $$
DECLARE
    v_total_debits NUMERIC(18, 4);
    v_total_credits NUMERIC(18, 4);
BEGIN
    SELECT
        COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN base_amount ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN base_amount ELSE 0 END), 0)
    INTO
        v_total_debits,
        v_total_credits
    FROM entries
    WHERE transaction_id = NEW.id;

    IF v_total_debits <> v_total_credits THEN
        RAISE EXCEPTION 'Double-entry invariant violated for transaction %! Total debits (%) != total credits (%)',
            NEW.id, v_total_debits, v_total_credits
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
