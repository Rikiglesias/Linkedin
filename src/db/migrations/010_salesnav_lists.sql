CREATE TABLE IF NOT EXISTS salesnav_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    url TEXT NOT NULL UNIQUE,
    last_synced_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS salesnav_list_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id INTEGER NOT NULL,
    lead_id INTEGER NOT NULL,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (list_id) REFERENCES salesnav_lists(id),
    FOREIGN KEY (lead_id) REFERENCES leads(id),
    UNIQUE(list_id, lead_id)
);

CREATE INDEX IF NOT EXISTS idx_salesnav_lists_last_synced_at
    ON salesnav_lists(last_synced_at);

CREATE INDEX IF NOT EXISTS idx_salesnav_list_items_list_id
    ON salesnav_list_items(list_id);

CREATE INDEX IF NOT EXISTS idx_salesnav_list_items_lead_id
    ON salesnav_list_items(lead_id);

