const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb, seedIfEmpty, nextId } = require('../src/db');

const count = (db, table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

describe('db', () => {
  test('a fresh database is seeded once', () => {
    const db = openDb(':memory:');
    assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'clock'").get().value, '2026-03-10T12:00');
    assert.equal(count(db, 'donors'), 5);
    assert.equal(count(db, 'volunteers'), 6);
    assert.equal(count(db, 'volunteer_zones'), 9);
    assert.equal(count(db, 'donations'), 5);
    assert.equal(count(db, 'claims'), 0);
    assert.equal(seedIfEmpty(db), false);
    assert.equal(count(db, 'donations'), 5);
  });

  test('saved state survives reopening and is not reseeded', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'surplus-'));
    const file = path.join(dir, 'test.db');
    const first = openDb(file);
    first.prepare("UPDATE meta SET value = '2026-03-10T15:00' WHERE key = 'clock'").run();
    first.prepare("UPDATE donations SET cancelled = 1 WHERE id = 'DN2'").run();
    first.close();

    const second = openDb(file);
    assert.equal(second.prepare("SELECT value FROM meta WHERE key = 'clock'").get().value, '2026-03-10T15:00');
    assert.equal(second.prepare("SELECT cancelled FROM donations WHERE id = 'DN2'").get().cancelled, 1);
    second.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('constraints reject bad rows', () => {
    const db = openDb(':memory:');
    const donation = db.prepare(`INSERT INTO donations
      (id, donor_id, description, quantity_kg, pickup_from, pickup_until) VALUES (?, ?, 'x', ?, ?, ?)`);
    assert.throws(() => donation.run('DN9', 'D1', 0, '2026-03-10T18:00', '2026-03-10T19:00'), /CHECK/);
    assert.throws(() => donation.run('DN9', 'D1', 5, '2026-03-10T19:00', '2026-03-10T18:00'), /CHECK/);
    assert.throws(() => donation.run('DN9', 'NOPE', 5, '2026-03-10T18:00', '2026-03-10T19:00'), /FOREIGN KEY/);

    const claim = db.prepare(`INSERT INTO claims
      (id, donation_id, volunteer_id, kg, planned_at, status) VALUES ('C1', 'DN1', 'V1', ?, '2026-03-10T18:00', ?)`);
    assert.throws(() => claim.run(0, 'ACTIVE'), /CHECK/);
    assert.throws(() => claim.run(5, 'BOGUS'), /CHECK/);
  });

  test('nextId continues after the highest numeric suffix', () => {
    const db = openDb(':memory:');
    assert.equal(nextId(db, 'donations'), 'DN6');
    assert.equal(nextId(db, 'claims'), 'C1');
    db.prepare(`INSERT INTO donations (id, donor_id, description, quantity_kg, pickup_from, pickup_until)
      VALUES ('DN10', 'D1', 'x', 1, '2026-03-10T18:00', '2026-03-10T19:00')`).run();
    assert.equal(nextId(db, 'donors'), 'D6');
    assert.equal(nextId(db, 'volunteers'), 'V7');
    assert.throws(() => nextId(db, 'unknown_table'));
  });
});
