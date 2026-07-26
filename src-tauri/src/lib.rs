// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri_plugin_sql::{Builder as SqlBuilder, Migration, MigrationKind};

// ── Database migrations ─────────────────────────────────────────────

fn get_migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create_initial_tables",
            sql: r#"
                CREATE TABLE IF NOT EXISTS local_contacts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    local_id TEXT NOT NULL UNIQUE,
                    callsign TEXT NOT NULL,
                    qso_date TEXT,
                    time_on TEXT,
                    mode TEXT,
                    band TEXT,
                    freq TEXT,
                    rst_sent TEXT,
                    rst_rcvd TEXT,
                    gridsquare TEXT,
                    my_gridsquare TEXT,
                    state TEXT,
                    county TEXT,
                    country TEXT,
                    operator_name TEXT,
                    net_name TEXT,
                    station_callsign TEXT,
                    remarks TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                    synced INTEGER NOT NULL DEFAULT 0,
                    backend_id INTEGER,
                    sync_error TEXT
                );

                CREATE TABLE IF NOT EXISTS local_nets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    local_id TEXT NOT NULL UNIQUE,
                    name TEXT NOT NULL,
                    frequency TEXT,
                    mode TEXT,
                    band TEXT,
                    net_control TEXT,
                    logger TEXT,
                    status TEXT NOT NULL DEFAULT 'open',
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    closed_at TEXT,
                    synced INTEGER NOT NULL DEFAULT 0,
                    backend_net_id INTEGER,
                    sync_error TEXT
                );

                CREATE TABLE IF NOT EXISTS local_checkins (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    local_net_id TEXT NOT NULL,
                    serial_no INTEGER,
                    callsign TEXT NOT NULL,
                    first_name TEXT,
                    state TEXT,
                    county TEXT,
                    city TEXT,
                    grid TEXT,
                    country TEXT,
                    status TEXT,
                    remarks TEXT,
                    qsl TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    synced INTEGER NOT NULL DEFAULT 0,
                    backend_id INTEGER,
                    sync_error TEXT,
                    FOREIGN KEY (local_net_id) REFERENCES local_nets(local_id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS local_aim (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    local_net_id TEXT NOT NULL,
                    callsign TEXT NOT NULL,
                    message TEXT NOT NULL,
                    is_net_control INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    synced INTEGER NOT NULL DEFAULT 0,
                    backend_id INTEGER,
                    sync_error TEXT,
                    FOREIGN KEY (local_net_id) REFERENCES local_nets(local_id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS sync_queue (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    action TEXT NOT NULL,
                    entity_type TEXT NOT NULL,
                    local_id TEXT,
                    payload TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    attempts INTEGER NOT NULL DEFAULT 0,
                    last_attempt_at TEXT,
                    status TEXT NOT NULL DEFAULT 'pending',
                    error TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_local_contacts_synced ON local_contacts(synced);
                CREATE INDEX IF NOT EXISTS idx_local_nets_synced ON local_nets(synced);
                CREATE INDEX IF NOT EXISTS idx_local_checkins_synced ON local_checkins(synced);
                CREATE INDEX IF NOT EXISTS idx_local_aim_synced ON local_aim(synced);
                CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status);
            "#,
            kind: MigrationKind::Up,
        },
    ]
}

// ── App entry point ────────────────────────────────────────────────
// The frontend uses @tauri-apps/plugin-sql directly for all database
// operations. No Rust IPC commands are needed — the SQL plugin
// handles everything from the renderer process.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            SqlBuilder::default()
                .add_migrations("sqlite:log2go-offline.db", get_migrations())
                .build(),
        )
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}