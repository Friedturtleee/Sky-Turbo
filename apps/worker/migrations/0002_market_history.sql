CREATE TABLE market_state (
  key TEXT PRIMARY KEY,
  updated_at INTEGER NOT NULL,
  payload TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE market_history (
  tier TEXT NOT NULL CHECK (tier IN ('5m', '1h', '1d')),
  bucket INTEGER NOT NULL,
  partition INTEGER NOT NULL CHECK (partition >= 0 AND partition < 8),
  updated_at INTEGER NOT NULL,
  payload BLOB NOT NULL,
  PRIMARY KEY (tier, bucket, partition)
) STRICT, WITHOUT ROWID;

CREATE INDEX market_history_product_lookup
  ON market_history (tier, partition, bucket);

-- SkyCofl records are gzip-compressed before storage. This keeps the complete
-- imported archive comfortably inside D1 Free's 500 MB per-database limit.
CREATE TABLE imported_history (
  product_id TEXT PRIMARY KEY,
  updated_at INTEGER NOT NULL,
  payload BLOB NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE imported_meta (
  key TEXT PRIMARY KEY CHECK (key IN ('summary', 'manifest')),
  updated_at INTEGER NOT NULL,
  payload BLOB NOT NULL
) STRICT, WITHOUT ROWID;
