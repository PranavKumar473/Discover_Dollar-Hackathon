const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DEFAULT_SEED = path.join(__dirname, '..', 'seed.json');

// Only raw facts are stored. Donation status and remaining kg are derived on read,
// so they can never drift. Claim status is stored because COLLECTED and MISSED are events.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS donors (
    id   TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    zone TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS volunteers (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    capacity_kg INTEGER NOT NULL CHECK (capacity_kg >= 1)
  );
  CREATE TABLE IF NOT EXISTS volunteer_zones (
    volunteer_id TEXT NOT NULL REFERENCES volunteers(id),
    zone         TEXT NOT NULL,
    PRIMARY KEY (volunteer_id, zone)
  );
  CREATE TABLE IF NOT EXISTS donations (
    id           TEXT PRIMARY KEY,
    donor_id     TEXT NOT NULL REFERENCES donors(id),
    description  TEXT NOT NULL,
    quantity_kg  INTEGER NOT NULL CHECK (quantity_kg >= 1),
    pickup_from  TEXT NOT NULL,
    pickup_until TEXT NOT NULL,
    cancelled    INTEGER NOT NULL DEFAULT 0 CHECK (cancelled IN (0, 1)),
    CHECK (pickup_from < pickup_until)
  );
  CREATE TABLE IF NOT EXISTS claims (
    id           TEXT PRIMARY KEY,
    donation_id  TEXT NOT NULL REFERENCES donations(id),
    volunteer_id TEXT NOT NULL REFERENCES volunteers(id),
    kg           INTEGER NOT NULL CHECK (kg >= 1),
    planned_at   TEXT NOT NULL,
    status       TEXT NOT NULL CHECK (status IN ('ACTIVE', 'COLLECTED', 'CANCELLED', 'MISSED'))
  );
`;

function openDb(dbPath = process.env.DB_PATH || './data.db', seedPath = DEFAULT_SEED) {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  seedIfEmpty(db, seedPath);
  return db;
}

// The clock key marks saved state; without this check a restart would reload the seed.
function seedIfEmpty(db, seedPath = DEFAULT_SEED) {
  if (db.prepare("SELECT 1 FROM meta WHERE key = 'clock'").get()) return false;
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

  const insertDonor = db.prepare('INSERT INTO donors (id, name, zone) VALUES (?, ?, ?)');
  const insertVolunteer = db.prepare('INSERT INTO volunteers (id, name, capacity_kg) VALUES (?, ?, ?)');
  const insertZone = db.prepare('INSERT INTO volunteer_zones (volunteer_id, zone) VALUES (?, ?)');
  const insertDonation = db.prepare(`
    INSERT INTO donations (id, donor_id, description, quantity_kg, pickup_from, pickup_until)
    VALUES (?, ?, ?, ?, ?, ?)`);

  db.transaction(() => {
    for (const d of seed.donors) insertDonor.run(d.id, d.name, d.zone);
    for (const v of seed.volunteers) {
      insertVolunteer.run(v.id, v.name, v.capacity_kg);
      for (const zone of v.zones) insertZone.run(v.id, zone);
    }
    for (const d of seed.donations) {
      insertDonation.run(d.id, d.donor_id, d.description, d.quantity_kg, d.pickup_from, d.pickup_until);
    }
    db.prepare("INSERT INTO meta (key, value) VALUES ('clock', ?)").run(seed.clock);
  })();
  return true;
}

const ID_PREFIX = { donations: 'DN', claims: 'C', donors: 'D', volunteers: 'V' };

// Rows are never deleted, so max + 1 never reuses an id. Callers run this
// inside their write transaction so two requests cannot pick the same id.
// The table name comes only from ID_PREFIX, never from user input.
function nextId(db, table) {
  const prefix = ID_PREFIX[table];
  if (!prefix) throw new Error(`No id sequence for ${table}`);
  const row = db.prepare(
    `SELECT MAX(CAST(SUBSTR(id, ${prefix.length + 1}) AS INTEGER)) AS n FROM ${table}`,
  ).get();
  return `${prefix}${(row.n || 0) + 1}`;
}

module.exports = { openDb, seedIfEmpty, nextId };
