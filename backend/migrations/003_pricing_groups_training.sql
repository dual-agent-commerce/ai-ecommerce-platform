-- One-time migration for AI pricing groups, training state, and notifications.
-- Run AFTER 001_sean_pricing_quotes.sql and 002_sean_quote_rejection.sql.
-- This migration preserves historical quotes, mock pricing reviews and listing jobs.
BEGIN;

CREATE TABLE IF NOT EXISTS pricing_groups (
    group_id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    product_ids JSONB NOT NULL,
    archived_at TIMESTAMPTZ NULL,
    active_algorithm TEXT NULL,
    active_quote_id BIGINT NULL,
    last_applied_at TIMESTAMPTZ NULL,
    model_id TEXT NULL,
    model_available BOOLEAN NOT NULL DEFAULT FALSE,
    last_train_status TEXT NULL,
    last_train_period VARCHAR(32) NULL,
    last_train_missing JSONB NULL,
    last_train_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (jsonb_typeof(product_ids) = 'array')
);

-- Safe migration even if an earlier draft created the table without these columns.
ALTER TABLE pricing_groups ADD COLUMN IF NOT EXISTS active_algorithm TEXT NULL;
ALTER TABLE pricing_groups ADD COLUMN IF NOT EXISTS active_quote_id BIGINT NULL;
ALTER TABLE pricing_groups ADD COLUMN IF NOT EXISTS last_applied_at TIMESTAMPTZ NULL;
ALTER TABLE pricing_groups ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL;

-- Import groups from the old quote-centric UI. One group per distinct group_id.
-- Product ids preserve the ORIGINAL order used in Sean calls.
INSERT INTO pricing_groups (group_id, name, product_ids, model_id, model_available,
                            active_algorithm, active_quote_id, last_applied_at)
SELECT q.group_id,
       LEFT(COALESCE((SELECT string_agg(item->>'name', '、' ORDER BY idx)
                     FROM jsonb_array_elements(q.products_snapshot) WITH ORDINALITY AS t(item,idx)), q.group_id), 120),
       COALESCE((SELECT jsonb_agg((item->>'id')::integer ORDER BY idx)
                 FROM jsonb_array_elements(q.products_snapshot) WITH ORDINALITY AS t(item,idx)), '[]'::jsonb),
       (SELECT (r->>'model_id') FROM jsonb_array_elements(q.pricing_response->'results') r
         WHERE r->>'algorithm' = 'ols_rr' AND jsonb_typeof(r->'prices') = 'array' LIMIT 1),
       COALESCE((SELECT TRUE FROM jsonb_array_elements(q.pricing_response->'results') r
         WHERE r->>'algorithm' = 'ols_rr' AND jsonb_typeof(r->'prices') = 'array' LIMIT 1), FALSE),
       (SELECT a.selected_algorithm FROM sean_pricing_quotes a WHERE a.group_id=q.group_id AND a.selected_algorithm IS NOT NULL ORDER BY a.id DESC LIMIT 1),
       (SELECT a.id FROM sean_pricing_quotes a WHERE a.group_id=q.group_id AND a.selected_algorithm IS NOT NULL ORDER BY a.id DESC LIMIT 1),
       (SELECT a.selected_at FROM sean_pricing_quotes a WHERE a.group_id=q.group_id AND a.selected_algorithm IS NOT NULL ORDER BY a.id DESC LIMIT 1)
FROM (SELECT DISTINCT ON (group_id) * FROM sean_pricing_quotes ORDER BY group_id, id DESC) q
ON CONFLICT (group_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS sales_history (
    product_id INTEGER NOT NULL REFERENCES products(id),
    period VARCHAR(32) NOT NULL,
    price NUMERIC(14, 2) NOT NULL CHECK (price > 0),
    units_sold INTEGER NOT NULL CHECK (units_sold >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (product_id, period)
);
CREATE INDEX IF NOT EXISTS idx_sales_history_period ON sales_history (period);

CREATE TABLE IF NOT EXISTS pricing_training_runs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    group_id VARCHAR(64) NOT NULL REFERENCES pricing_groups(group_id),
    period VARCHAR(32) NULL,
    status VARCHAR(32) NOT NULL,
    job_id TEXT UNIQUE NULL,
    missing JSONB NULL,
    model_id TEXT NULL,
    previous_model_id TEXT NULL,
    error_message TEXT NULL,
    poll_errors INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_pricing_training_runs_active ON pricing_training_runs (status, created_at);
-- Prevent duplicate active jobs for the same group, including concurrent requests.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pricing_training_one_active
ON pricing_training_runs (group_id) WHERE status IN ('training','running');

CREATE TABLE IF NOT EXISTS pricing_notifications (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    group_id VARCHAR(64) NOT NULL REFERENCES pricing_groups(group_id),
    training_run_id BIGINT UNIQUE REFERENCES pricing_training_runs(id),
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_pricing_notifications_unread ON pricing_notifications (read_at, created_at DESC);
COMMIT;
