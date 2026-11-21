-- Run once against ecommerce_db before starting Sean integration.
CREATE TABLE IF NOT EXISTS sean_pricing_quotes (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    group_id VARCHAR(64) NOT NULL,
    products_snapshot JSONB NOT NULL,
    pricing_response JSONB NOT NULL,
    selected_algorithm TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    selected_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_sean_pricing_quotes_group ON sean_pricing_quotes (group_id, created_at DESC);
