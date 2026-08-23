CREATE TABLE ah_flip_state (
  key TEXT PRIMARY KEY CHECK (key = 'latest'),
  updated_at INTEGER NOT NULL,
  payload BLOB NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE imported_ah_history (
  product_id TEXT PRIMARY KEY,
  updated_at INTEGER NOT NULL,
  payload BLOB NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE imported_ah_meta (
  key TEXT PRIMARY KEY CHECK (key IN ('summary', 'manifest')),
  updated_at INTEGER NOT NULL,
  payload BLOB NOT NULL
) STRICT, WITHOUT ROWID;
