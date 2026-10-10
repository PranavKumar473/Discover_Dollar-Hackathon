const express = require('express');
const path = require('path');
const { openDb, nextId } = require('./db');
const {
  isValidTime,
  remainingKg,
  deriveStatus,
  validateDonation,
  validateClaim,
  canCancelDonation,
  canCollect,
  canCancelClaim,
  dashboard,
} = require('./rules');

function createApp(customDb) {
  const app = express();
  const db = customDb || openDb();
  app.db = db;

  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Helper to fetch current simulated clock
  function getClock() {
    return db.prepare("SELECT value FROM meta WHERE key = 'clock'").get().value;
  }

  // Helper to fetch a donation with donor zone populated
  function getDonationWithZone(donationId) {
    return db.prepare(`
      SELECT d.*, dn.zone
      FROM donations d
      JOIN donors dn ON d.donor_id = dn.id
      WHERE d.id = ?
    `).get(donationId);
  }

  // Helper to get all claims in the system
  function getAllClaims() {
    return db.prepare('SELECT * FROM claims').all();
  }

  // Middleware: require actor of a specific role (header or body)
  function requireActor(role) {
    return (req, res, next) => {
      const actorId = req.headers['x-actor-id'] || (req.body && (req.body.actor_id || req.body.actorId || req.body.actor));
      if (!actorId) {
        return res.status(400).json({ error: 'X-Actor-Id header or actor_id in body is required' });
      }

      if (role === 'donor') {
        const donor = db.prepare('SELECT * FROM donors WHERE id = ?').get(actorId);
        if (!donor) return res.status(403).json({ error: 'Actor is not a valid donor' });
        req.actor = donor;
      } else if (role === 'volunteer') {
        const volunteer = db.prepare('SELECT * FROM volunteers WHERE id = ?').get(actorId);
        if (!volunteer) return res.status(403).json({ error: 'Actor is not a valid volunteer' });
        volunteer.zones = db.prepare('SELECT zone FROM volunteer_zones WHERE volunteer_id = ?')
          .all(actorId)
          .map((r) => r.zone);
        req.actor = volunteer;
      }
      next();
    };
  }

  // 1. GET /api/people - List all donors and volunteers
  app.get('/api/people', (req, res) => {
    const donors = db.prepare('SELECT * FROM donors ORDER BY id').all();
    const volunteers = db.prepare('SELECT * FROM volunteers ORDER BY id').all().map((v) => {
      const zones = db.prepare('SELECT zone FROM volunteer_zones WHERE volunteer_id = ?')
        .all(v.id)
        .map((r) => r.zone);
      return { ...v, zones };
    });
    res.json({ donors, volunteers });
  });

  // 1b. POST /api/donors - Register a new donor/restaurant
  app.post('/api/donors', (req, res) => {
    const { name, zone } = req.body || {};
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name must be a non-empty string' });
    }
    if (typeof zone !== 'string' || !zone.trim()) {
      return res.status(400).json({ error: 'zone must be a non-empty string' });
    }

    let createdDonor;
    db.transaction(() => {
      const id = nextId(db, 'donors');
      const cleanZone = zone.trim().toUpperCase();
      db.prepare('INSERT INTO donors (id, name, zone) VALUES (?, ?, ?)').run(id, name.trim(), cleanZone);
      createdDonor = { id, name: name.trim(), zone: cleanZone };
    })();

    res.status(201).json(createdDonor);
  });

  // 1c. POST /api/volunteers - Register a new volunteer
  app.post('/api/volunteers', (req, res) => {
    const { name, capacity_kg, zones } = req.body || {};
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name must be a non-empty string' });
    }
    if (typeof capacity_kg !== 'number' || !Number.isInteger(capacity_kg) || capacity_kg < 1) {
      return res.status(400).json({ error: 'capacity_kg must be a positive whole integer' });
    }
    if (!Array.isArray(zones) || zones.length === 0) {
      return res.status(400).json({ error: 'zones must be a non-empty array of strings' });
    }

    const cleanZones = [...new Set(zones.map((z) => String(z).trim().toUpperCase()).filter(Boolean))];
    if (cleanZones.length === 0) {
      return res.status(400).json({ error: 'At least one valid zone is required' });
    }

    let createdVolunteer;
    db.transaction(() => {
      const id = nextId(db, 'volunteers');
      db.prepare('INSERT INTO volunteers (id, name, capacity_kg) VALUES (?, ?, ?)').run(id, name.trim(), capacity_kg);
      const insertZone = db.prepare('INSERT INTO volunteer_zones (volunteer_id, zone) VALUES (?, ?)');
      for (const z of cleanZones) {
        insertZone.run(id, z);
      }
      createdVolunteer = { id, name: name.trim(), capacity_kg, zones: cleanZones };
    })();

    res.status(201).json(createdVolunteer);
  });

  // 1d. GET /api/donors/:id - Lookup restaurant by ID
  app.get('/api/donors/:id', (req, res) => {
    const id = req.params.id ? req.params.id.trim().toUpperCase() : '';
    const donor = db.prepare('SELECT id, name, zone FROM donors WHERE id = ?').get(id);
    if (!donor) {
      return res.status(404).json({ error: `Restaurant with ID ${id} not found` });
    }
    res.json(donor);
  });

  // 1e. GET /api/volunteers/:id - Lookup volunteer by ID
  app.get('/api/volunteers/:id', (req, res) => {
    const id = req.params.id ? req.params.id.trim().toUpperCase() : '';
    const volunteer = db.prepare('SELECT id, name, capacity_kg FROM volunteers WHERE id = ?').get(id);
    if (!volunteer) {
      return res.status(404).json({ error: `Volunteer with ID ${id} not found` });
    }
    const zones = db.prepare('SELECT zone FROM volunteer_zones WHERE volunteer_id = ?').all(id).map((r) => r.zone);
    res.json({ ...volunteer, zones });
  });

  // 2. GET /api/clock - Current simulated clock
  app.get('/api/clock', (req, res) => {
    res.json({ now: getClock() });
  });

  // 3. POST /api/clock - Move simulated clock forward
  app.post('/api/clock', (req, res) => {
    const { now: newNow } = req.body || {};
    if (!isValidTime(newNow)) {
      return res.status(400).json({ error: 'Invalid time format. Expected YYYY-MM-DDTHH:MM' });
    }

    const currentNow = getClock();
    if (newNow < currentNow) {
      return res.status(422).json({ error: `Clock cannot move backwards from ${currentNow}` });
    }

    // Single transaction: update clock and mark past active claims as MISSED
    let missedCount = 0;
    db.transaction(() => {
      db.prepare("UPDATE meta SET value = ? WHERE key = 'clock'").run(newNow);

      // Past pickup_until means strictly before newNow
      const result = db.prepare(`
        UPDATE claims
        SET status = 'MISSED'
        WHERE status = 'ACTIVE'
          AND donation_id IN (
            SELECT id FROM donations WHERE pickup_until < ?
          )
      `).run(newNow);
      missedCount = result.changes;
    })();

    res.json({ now: newNow, missed: missedCount });
  });

  // 4. GET /api/dashboard - Metrics and stats
  app.get('/api/dashboard', (req, res) => {
    const now = getClock();
    const donations = db.prepare(`
      SELECT d.*, dn.zone
      FROM donations d
      JOIN donors dn ON d.donor_id = dn.id
    `).all();
    const claims = getAllClaims();
    const donors = db.prepare('SELECT * FROM donors').all();
    const volunteers = db.prepare('SELECT * FROM volunteers').all();

    const data = dashboard(donations, claims, donors, volunteers, now);
    res.json(data);
  });

  // 5. GET /api/donations - Donor sees their own donations with claims
  app.get('/api/donations', requireActor('donor'), (req, res) => {
    const now = getClock();
    const donorId = req.actor.id;
    const donations = db.prepare(`
      SELECT d.*, dn.zone
      FROM donations d
      JOIN donors dn ON d.donor_id = dn.id
      WHERE d.donor_id = ?
      ORDER BY d.id DESC
    `).all(donorId);

    const allClaims = getAllClaims();
    const results = donations.map((d) => {
      const claimsForDonation = allClaims.filter((c) => c.donation_id === d.id);
      return {
        ...d,
        status: deriveStatus(d, claimsForDonation, now),
        remaining_kg: remainingKg(d, claimsForDonation),
        claims: claimsForDonation,
      };
    });

    res.json(results);
  });

  // 6. POST /api/donations - Donor posts a donation
  app.post('/api/donations', requireActor('donor'), (req, res) => {
    const { description, quantity_kg, pickup_from, pickup_until } = req.body || {};

    if (typeof description !== 'string' || !description.trim()) {
      return res.status(400).json({ error: 'description must be a non-empty string' });
    }
    if (typeof quantity_kg !== 'number' || !Number.isInteger(quantity_kg) || quantity_kg < 1) {
      return res.status(400).json({ error: 'quantity_kg must be a positive whole integer' });
    }
    if (!isValidTime(pickup_from) || !isValidTime(pickup_until)) {
      return res.status(400).json({ error: 'pickup_from and pickup_until must be valid YYYY-MM-DDTHH:MM' });
    }

    const now = getClock();
    const errors = validateDonation({ pickup_from, pickup_until }, now);
    if (errors.length > 0) {
      return res.status(422).json({ errors });
    }

    let createdDonation;
    db.transaction(() => {
      const id = nextId(db, 'donations');
      db.prepare(`
        INSERT INTO donations (id, donor_id, description, quantity_kg, pickup_from, pickup_until)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, req.actor.id, description.trim(), quantity_kg, pickup_from, pickup_until);

      createdDonation = {
        id,
        donor_id: req.actor.id,
        zone: req.actor.zone,
        description: description.trim(),
        quantity_kg,
        pickup_from,
        pickup_until,
        cancelled: 0,
        status: 'OPEN',
        remaining_kg: quantity_kg,
        claims: [],
      };
    })();

    res.status(201).json(createdDonation);
  });

  // 7. POST /api/donations/:id/cancel - Donor cancels their donation
  app.post('/api/donations/:id/cancel', requireActor('donor'), (req, res) => {
    const donation = getDonationWithZone(req.params.id);
    if (!donation) {
      return res.status(404).json({ error: 'Donation not found' });
    }
    if (donation.donor_id !== req.actor.id) {
      return res.status(403).json({ error: 'Cannot cancel a donation belonging to another donor' });
    }

    const now = getClock();
    const claims = getAllClaims();

    let updatedDonation;
    db.transaction(() => {
      const currentDonation = getDonationWithZone(req.params.id);
      if (!currentDonation) {
        const err = new Error('Donation not found');
        err.status = 404;
        throw err;
      }
      const allClaims = getAllClaims();
      const check = canCancelDonation(currentDonation, allClaims, now);
      if (!check.ok) {
        const err = new Error(check.reason);
        err.status = 409;
        throw err;
      }

      db.prepare('UPDATE donations SET cancelled = 1 WHERE id = ?').run(currentDonation.id);
      currentDonation.cancelled = 1;
      updatedDonation = {
        ...currentDonation,
        status: 'CANCELLED',
      };
    })();

    res.json(updatedDonation);
  });

  // 8. GET /api/donations/open - Volunteer sees OPEN donations in their zones
  app.get('/api/donations/open', requireActor('volunteer'), (req, res) => {
    const now = getClock();
    const volunteerZones = req.actor.zones;

    const allDonations = db.prepare(`
      SELECT d.*, dn.zone, dn.name AS donor_name
      FROM donations d
      JOIN donors dn ON d.donor_id = dn.id
      WHERE d.cancelled = 0
    `).all();

    const allClaims = getAllClaims();

    const openInZones = allDonations
      .filter((d) => volunteerZones.includes(d.zone))
      .map((d) => {
        const dClaims = allClaims.filter((c) => c.donation_id === d.id);
        const status = deriveStatus(d, dClaims, now);
        const remaining = remainingKg(d, dClaims);
        return {
          ...d,
          status,
          remaining_kg: remaining,
        };
      })
      .filter((d) => d.status === 'OPEN');

    res.json(openInZones);
  });

  // 9. POST /api/donations/:id/claims - Volunteer reserves kg with planned pickup time
  // Concurrency guarantee: better-sqlite3 runs transactions synchronously with an exclusive write lock.
  // Validation and reservation happen atomically inside the transaction, preventing over-booking.
  app.post('/api/donations/:id/claims', requireActor('volunteer'), (req, res) => {
    const { kg, planned_at } = req.body || {};

    if (typeof kg !== 'number' || !Number.isInteger(kg) || kg < 1) {
      return res.status(400).json({ error: 'kg must be a positive whole integer' });
    }
    if (!isValidTime(planned_at)) {
      return res.status(400).json({ error: 'planned_at must be a valid YYYY-MM-DDTHH:MM' });
    }

    const donation = getDonationWithZone(req.params.id);
    if (!donation) {
      return res.status(404).json({ error: 'Donation not found' });
    }

    const now = getClock();
    let createdClaim;

    db.transaction(() => {
      // Re-fetch inside transaction for atomicity
      const allClaims = getAllClaims();
      const errors = validateClaim({
        donation,
        volunteer: req.actor,
        claims: allClaims,
        kg,
        plannedAt: planned_at,
        now,
      });

      if (errors.length > 0) {
        const err = new Error('Rule violations');
        err.status = 422;
        err.errors = errors;
        throw err;
      }

      const id = nextId(db, 'claims');
      db.prepare(`
        INSERT INTO claims (id, donation_id, volunteer_id, kg, planned_at, status)
        VALUES (?, ?, ?, ?, ?, 'ACTIVE')
      `).run(id, donation.id, req.actor.id, kg, planned_at);

      createdClaim = {
        id,
        donation_id: donation.id,
        volunteer_id: req.actor.id,
        kg,
        planned_at,
        status: 'ACTIVE',
      };
    })();

    res.status(201).json(createdClaim);
  });

  // 10. GET /api/claims - Volunteer sees their own claims with collect/cancel eligibility
  app.get('/api/claims', requireActor('volunteer'), (req, res) => {
    const now = getClock();
    const volunteerId = req.actor.id;

    const claims = db.prepare(`
      SELECT c.*, d.description AS donation_description, d.pickup_from, d.pickup_until, d.zone, dn.name AS donor_name
      FROM claims c
      JOIN (
        SELECT d.*, dn.zone
        FROM donations d
        JOIN donors dn ON d.donor_id = dn.id
      ) d ON c.donation_id = d.id
      JOIN donors dn ON d.donor_id = dn.id
      WHERE c.volunteer_id = ?
      ORDER BY c.id DESC
    `).all(volunteerId);

    const results = claims.map((c) => ({
      ...c,
      can_collect: canCollect(c, c, now).ok,
      can_cancel: canCancelClaim(c, now).ok,
    }));

    res.json(results);
  });

  // 11. POST /api/claims/:id/collect - Volunteer marks claim COLLECTED
  app.post('/api/claims/:id/collect', requireActor('volunteer'), (req, res) => {
    const claim = db.prepare('SELECT * FROM claims WHERE id = ?').get(req.params.id);
    if (!claim) {
      return res.status(404).json({ error: 'Claim not found' });
    }
    if (claim.volunteer_id !== req.actor.id) {
      return res.status(403).json({ error: 'Cannot collect a claim belonging to another volunteer' });
    }

    const donation = getDonationWithZone(claim.donation_id);
    const now = getClock();

    let updatedClaim;
    db.transaction(() => {
      const currentClaim = db.prepare('SELECT * FROM claims WHERE id = ?').get(req.params.id);
      if (!currentClaim) {
        const err = new Error('Claim not found');
        err.status = 404;
        throw err;
      }
      const check = canCollect(currentClaim, donation, now);
      if (!check.ok) {
        const err = new Error(check.reason);
        err.status = 409;
        throw err;
      }

      db.prepare("UPDATE claims SET status = 'COLLECTED' WHERE id = ?").run(currentClaim.id);
      updatedClaim = { ...currentClaim, status: 'COLLECTED' };
    })();

    res.json(updatedClaim);
  });

  // 12. POST /api/claims/:id/cancel - Volunteer cancels claim
  app.post('/api/claims/:id/cancel', requireActor('volunteer'), (req, res) => {
    const claim = db.prepare('SELECT * FROM claims WHERE id = ?').get(req.params.id);
    if (!claim) {
      return res.status(404).json({ error: 'Claim not found' });
    }
    if (claim.volunteer_id !== req.actor.id) {
      return res.status(403).json({ error: 'Cannot cancel a claim belonging to another volunteer' });
    }

    const now = getClock();
    let updatedClaim;
    db.transaction(() => {
      const currentClaim = db.prepare('SELECT * FROM claims WHERE id = ?').get(req.params.id);
      if (!currentClaim) {
        const err = new Error('Claim not found');
        err.status = 404;
        throw err;
      }
      const check = canCancelClaim(currentClaim, now);
      if (!check.ok) {
        const err = new Error(check.reason);
        err.status = 409;
        throw err;
      }

      db.prepare("UPDATE claims SET status = 'CANCELLED' WHERE id = ?").run(currentClaim.id);
      updatedClaim = { ...currentClaim, status: 'CANCELLED' };
    })();

    res.json(updatedClaim);
  });

  // Central Error Handler (JSON response, no stack traces leaked)
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (err.errors) {
      return res.status(status).json({ errors: err.errors });
    }
    res.status(status).json({ error: err.message || 'Internal server error' });
  });

  return app;
}

const defaultApp = createApp();
defaultApp.createApp = createApp;

module.exports = defaultApp;
