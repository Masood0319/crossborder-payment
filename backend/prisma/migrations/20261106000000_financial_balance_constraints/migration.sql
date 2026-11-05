DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "wallets" w
        JOIN "accounts" a ON a."id" = w."shadow_account_id"
        WHERE w."balance" < 0
           OR a."currentBalance" < 0
           OR w."balance" <> a."currentBalance"
    ) THEN
        RAISE EXCEPTION 'Cannot add wallet integrity constraints: a wallet is negative or differs from its shadow ledger account';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "accounts"
        WHERE "currentBalance" < 0
    ) THEN
        RAISE EXCEPTION 'Cannot add account integrity constraint: a ledger account has a negative balance';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "entries"
        WHERE "amount" <= 0
           OR "exchange_rate" <= 0
           OR "base_amount" < 0
           OR "sequence_order" <= 0
    ) THEN
        RAISE EXCEPTION 'Cannot add ledger entry constraints: an existing entry has invalid amount, rate, base value, or sequence';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "transactions" t
        LEFT JOIN "entries" e ON e."transaction_id" = t."id"
        WHERE t."status" IN ('POSTED', 'REVERSED')
        GROUP BY t."id"
        HAVING COUNT(e."id") < 2
            OR COALESCE(SUM(e."base_amount") FILTER (WHERE e."direction" = 'DEBIT'), 0)
                <> COALESCE(SUM(e."base_amount") FILTER (WHERE e."direction" = 'CREDIT'), 0)
    ) THEN
        RAISE EXCEPTION 'Cannot add posted journal constraints: an existing posted transaction has fewer than two entries or is unbalanced';
    END IF;
END;
$$;

ALTER TABLE "wallets"
    ADD CONSTRAINT "wallets_balance_nonnegative_check" CHECK ("balance" >= 0);
ALTER TABLE "accounts"
    ADD CONSTRAINT "accounts_balance_nonnegative_check" CHECK ("currentBalance" >= 0);
ALTER TABLE "entries"
    ADD CONSTRAINT "entries_amount_positive_check" CHECK ("amount" > 0),
    ADD CONSTRAINT "entries_exchange_rate_positive_check" CHECK ("exchange_rate" > 0),
    ADD CONSTRAINT "entries_base_amount_nonnegative_check" CHECK ("base_amount" >= 0),
    ADD CONSTRAINT "entries_sequence_order_positive_check" CHECK ("sequence_order" > 0);
ALTER TABLE "transactions"
    ADD CONSTRAINT "transactions_base_totals_nonnegative_check"
        CHECK ("totalDebitBase" >= 0 AND "totalCreditBase" >= 0);

CREATE OR REPLACE FUNCTION check_transaction_balance_invariant()
RETURNS TRIGGER AS $$
DECLARE
    v_total_debits NUMERIC(18, 4);
    v_total_credits NUMERIC(18, 4);
    v_entry_count BIGINT;
BEGIN
    SELECT
        COUNT(*),
        COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN base_amount ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN base_amount ELSE 0 END), 0)
    INTO v_entry_count, v_total_debits, v_total_credits
    FROM entries
    WHERE transaction_id = NEW.id;

    IF NEW.status IN ('POSTED', 'REVERSED') AND v_entry_count < 2 THEN
        RAISE EXCEPTION 'Posted financial transactions require at least two ledger entries'
            USING ERRCODE = '23514';
    END IF;

    IF v_total_debits <> v_total_credits THEN
        RAISE EXCEPTION 'Double-entry invariant violated for transaction %! Total debits (%) != total credits (%)',
            NEW.id, v_total_debits, v_total_credits
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION check_inserted_entry_balance_invariant()
RETURNS TRIGGER AS $$
DECLARE
    v_status "TransactionStatus";
    v_total_debits NUMERIC(18, 4);
    v_total_credits NUMERIC(18, 4);
    v_entry_count BIGINT;
BEGIN
    SELECT status INTO v_status
    FROM transactions
    WHERE id = NEW.transaction_id;

    SELECT
        COUNT(*),
        COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN base_amount ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN base_amount ELSE 0 END), 0)
    INTO v_entry_count, v_total_debits, v_total_credits
    FROM entries
    WHERE transaction_id = NEW.transaction_id;

    IF v_status IN ('POSTED', 'REVERSED') AND v_entry_count < 2 THEN
        RAISE EXCEPTION 'Posted financial transactions require at least two ledger entries'
            USING ERRCODE = '23514';
    END IF;

    IF v_total_debits <> v_total_credits THEN
        RAISE EXCEPTION 'Double-entry invariant violated for transaction %! Total debits (%) != total credits (%)',
            NEW.transaction_id, v_total_debits, v_total_credits
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "trg_enforce_entry_balance_invariant"
AFTER INSERT ON "entries"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_inserted_entry_balance_invariant();

CREATE OR REPLACE FUNCTION enforce_wallet_shadow_balance_consistency()
RETURNS TRIGGER AS $$
DECLARE
    v_wallet_balance NUMERIC(18, 4);
    v_account_balance NUMERIC(18, 4);
    v_account_id UUID;
BEGIN
    IF TG_TABLE_NAME = 'wallets' THEN
        v_account_id := NEW."shadow_account_id";
        v_wallet_balance := NEW."balance";
        SELECT "currentBalance" INTO v_account_balance
        FROM "accounts"
        WHERE "id" = v_account_id;
    ELSE
        v_account_id := NEW."id";
        v_account_balance := NEW."currentBalance";
        SELECT "balance" INTO v_wallet_balance
        FROM "wallets"
        WHERE "shadow_account_id" = v_account_id;
        IF NOT FOUND THEN
            RETURN NEW;
        END IF;
    END IF;

    IF v_wallet_balance IS NULL OR v_wallet_balance <> v_account_balance THEN
        RAISE EXCEPTION 'Wallet balance must equal its shadow ledger account balance'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "trg_wallet_shadow_balance_consistency"
AFTER INSERT OR UPDATE ON "wallets"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_wallet_shadow_balance_consistency();

CREATE CONSTRAINT TRIGGER "trg_account_wallet_balance_consistency"
AFTER INSERT OR UPDATE ON "accounts"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_wallet_shadow_balance_consistency();
