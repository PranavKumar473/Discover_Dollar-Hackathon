const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp } = require('../src/app');

describe('SurplusLink API Integration & Concurrency Tests', () => {
  let server;
  let baseUrl;
  let db;

  before((t, done) => {
    // Open in-memory database with clean seed
    db = openDb(':memory:');
    const app = createApp(db);
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      done();
    });
  });

  after((t, done) => {
    server.close(done);
  });

  const request = async (path, options = {}) => {
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  };

  test('GET /api/people returns seeded donors and volunteers with zones', async () => {
    const { status, data } = await request('/api/people');
    assert.equal(status, 200);
    assert.equal(data.donors.length, 5);
    assert.equal(data.volunteers.length, 6);
    const v1 = data.volunteers.find((v) => v.id === 'V1');
    assert.deepEqual(v1.zones.sort(), ['EAST', 'NORTH']);
  });

  test('POST /api/donors registers a new restaurant / donor', async () => {
    const res = await request('/api/donors', {
      method: 'POST',
      body: JSON.stringify({ name: 'The Olive Bistro', zone: 'CENTRAL' }),
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.id, 'D6');
    assert.equal(res.data.name, 'The Olive Bistro');
    assert.equal(res.data.zone, 'CENTRAL');
  });

  test('POST /api/volunteers registers a new volunteer with capacity and zones', async () => {
    const res = await request('/api/volunteers', {
      method: 'POST',
      body: JSON.stringify({ name: 'Alex Driver', capacity_kg: 28, zones: ['CENTRAL', 'NORTH'] }),
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.id, 'V7');
    assert.equal(res.data.capacity_kg, 28);
    assert.deepEqual(res.data.zones.sort(), ['CENTRAL', 'NORTH']);
  });

  test('GET /api/donors/:id and GET /api/volunteers/:id look up individuals securely', async () => {
    const dRes = await request('/api/donors/D1');
    assert.equal(dRes.status, 200);
    assert.equal(dRes.data.id, 'D1');
    assert.equal(dRes.data.name, 'Spice Garden');

    const vRes = await request('/api/volunteers/V1');
    assert.equal(vRes.status, 200);
    assert.equal(vRes.data.id, 'V1');
    assert.deepEqual(vRes.data.zones.sort(), ['EAST', 'NORTH']);

    const notFound = await request('/api/donors/D999');
    assert.equal(notFound.status, 404);
  });

  test('GET /api/clock returns initial seed clock', async () => {
    const { status, data } = await request('/api/clock');
    assert.equal(status, 200);
    assert.equal(data.now, '2026-03-10T12:00');
  });

  test('POST /api/clock rejects moving backwards (422) and bad format (400)', async () => {
    const badFmt = await request('/api/clock', {
      method: 'POST',
      body: JSON.stringify({ now: 'invalid-time' }),
    });
    assert.equal(badFmt.status, 400);

    const backwards = await request('/api/clock', {
      method: 'POST',
      body: JSON.stringify({ now: '2026-03-10T11:59' }),
    });
    assert.equal(backwards.status, 422);

    // Same time is allowed
    const same = await request('/api/clock', {
      method: 'POST',
      body: JSON.stringify({ now: '2026-03-10T12:00' }),
    });
    assert.equal(same.status, 200);
  });

  test('Role authorization checks', async () => {
    // Missing actor header
    const noActor = await request('/api/donations');
    assert.equal(noActor.status, 400);

    // Wrong role (volunteer calling donor endpoint)
    const wrongRole = await request('/api/donations', {
      headers: { 'X-Actor-Id': 'V1' },
    });
    assert.equal(wrongRole.status, 403);

    // Invalid actor id
    const badActor = await request('/api/donations', {
      headers: { 'X-Actor-Id': 'UNKNOWN' },
    });
    assert.equal(badActor.status, 403);
  });

  test('Donor posts donation and verifies validation', async () => {
    // Invalid kg (must be whole positive integer)
    const badKg = await request('/api/donations', {
      method: 'POST',
      headers: { 'X-Actor-Id': 'D1' },
      body: JSON.stringify({
        description: 'Test soup',
        quantity_kg: 0,
        pickup_from: '2026-03-10T18:00',
        pickup_until: '2026-03-10T20:00',
      }),
    });
    assert.equal(badKg.status, 400);

    // Window validation (pickup_until before now) -> 422
    const pastWindow = await request('/api/donations', {
      method: 'POST',
      headers: { 'X-Actor-Id': 'D1' },
      body: JSON.stringify({
        description: 'Past food',
        quantity_kg: 10,
        pickup_from: '2026-03-10T10:00',
        pickup_until: '2026-03-10T11:00',
      }),
    });
    assert.equal(pastWindow.status, 422);
    assert.ok(pastWindow.data.errors.length > 0);

    // Valid post -> 201
    const valid = await request('/api/donations', {
      method: 'POST',
      headers: { 'X-Actor-Id': 'D1' },
      body: JSON.stringify({
        description: 'Fresh curry',
        quantity_kg: 15,
        pickup_from: '2026-03-10T18:00',
        pickup_until: '2026-03-10T20:00',
      }),
    });
    assert.equal(valid.status, 201);
    assert.equal(valid.data.id, 'DN6');
    assert.equal(valid.data.status, 'OPEN');
  });

  test('Volunteer claims food and verifies rule enforcement', async () => {
    // V3 (SOUTH only) attempts to claim DN1 (NORTH) -> rule 4 violation
    const wrongZone = await request('/api/donations/DN1/claims', {
      method: 'POST',
      headers: { 'X-Actor-Id': 'V3' },
      body: JSON.stringify({
        kg: 10,
        planned_at: '2026-03-10T18:30',
      }),
    });
    assert.equal(wrongZone.status, 422);
    const rule4 = wrongZone.data.errors.find((e) => e.rule === 4);
    assert.ok(rule4);

    // V1 claims 20kg of DN1 (NORTH) at 18:00 -> 201
    const validClaim = await request('/api/donations/DN1/claims', {
      method: 'POST',
      headers: { 'X-Actor-Id': 'V1' },
      body: JSON.stringify({
        kg: 20,
        planned_at: '2026-03-10T18:00',
      }),
    });
    assert.equal(validClaim.status, 201);
    assert.equal(validClaim.data.id, 'C1');

    // Rule 7: V1 attempts second claim within 60 minutes (18:30) on DN2 -> 422 rule 7
    const clashClaim = await request('/api/donations/DN2/claims', {
      method: 'POST',
      headers: { 'X-Actor-Id': 'V1' },
      body: JSON.stringify({
        kg: 5,
        planned_at: '2026-03-10T18:30',
      }),
    });
    assert.equal(clashClaim.status, 422);
    const rule7 = clashClaim.data.errors.find((e) => e.rule === 7);
    assert.ok(rule7);

    // 60 minutes later (19:00) is permitted -> 201
    const allowedSecond = await request('/api/donations/DN2/claims', {
      method: 'POST',
      headers: { 'X-Actor-Id': 'V1' },
      body: JSON.stringify({
        kg: 5,
        planned_at: '2026-03-10T19:00',
      }),
    });
    assert.equal(allowedSecond.status, 201);
  });

  test('Concurrency Test: Two simultaneous claims competing for last kilograms', async () => {
    // DN1 has 30kg total. V1 already claimed 20kg, leaving exactly 10kg.
    // Both V2 (cap 15) and V6 (cap 18) are in NORTH zone and have NO prior claims.
    // Both attempt to claim 10kg simultaneously at 19:30.
    // 10 + 10 = 20 > 10 remaining, so exactly ONE must succeed and the other must fail with Rule 3!
    const results = await Promise.all([
      request('/api/donations/DN1/claims', {
        method: 'POST',
        headers: { 'X-Actor-Id': 'V2' },
        body: JSON.stringify({ kg: 10, planned_at: '2026-03-10T19:30' }),
      }),
      request('/api/donations/DN1/claims', {
        method: 'POST',
        headers: { 'X-Actor-Id': 'V6' },
        body: JSON.stringify({ kg: 10, planned_at: '2026-03-10T19:30' }),
      }),
    ]);

    const successes = results.filter((r) => r.status === 201);
    const failures = results.filter((r) => r.status === 422);

    assert.equal(successes.length, 1, 'Exactly one concurrent claim must succeed');
    assert.equal(failures.length, 1, 'The competing concurrent claim must fail with 422');
    const rule3 = failures[0].data.errors.find((e) => e.rule === 3);
    assert.ok(rule3, 'Failure reason must be rule 3 (exceeds remaining kg)');
  });

  test('Collect and cancel lifecycle & timing constraints', async () => {
    // V3 claims DN3 (SOUTH, 14:00 - 16:00) 10kg at 15:00
    const claimRes = await request('/api/donations/DN3/claims', {
      method: 'POST',
      headers: { 'X-Actor-Id': 'V3' },
      body: JSON.stringify({ kg: 10, planned_at: '2026-03-10T15:00' }),
    });
    assert.equal(claimRes.status, 201);
    const claimId = claimRes.data.id;

    // Current clock is 12:00 -> outside collection window (14:00 - 16:00) -> 409
    const earlyCollect = await request(`/api/claims/${claimId}/collect`, {
      method: 'POST',
      headers: { 'X-Actor-Id': 'V3' },
    });
    assert.equal(earlyCollect.status, 409);

    // Cancel claim strictly before planned time (15:00) -> 200
    const cancelRes = await request(`/api/claims/${claimId}/cancel`, {
      method: 'POST',
      headers: { 'X-Actor-Id': 'V3' },
    });
    assert.equal(cancelRes.status, 200);
    assert.equal(cancelRes.data.status, 'CANCELLED');

    // Cancelling already cancelled claim -> 409
    const cancelAgain = await request(`/api/claims/${claimId}/cancel`, {
      method: 'POST',
      headers: { 'X-Actor-Id': 'V3' },
    });
    assert.equal(cancelAgain.status, 409);
  });

  test('Clock advance turns expired active claims to MISSED and preserves dashboard identity', async () => {
    // V4 claims DN3 (pickup_until 16:00)
    const claimRes = await request('/api/donations/DN3/claims', {
      method: 'POST',
      headers: { 'X-Actor-Id': 'V4' },
      body: JSON.stringify({ kg: 15, planned_at: '2026-03-10T15:30' }),
    });
    assert.equal(claimRes.status, 201);

    // Advance clock past DN3 window: 16:05
    const clockAdv = await request('/api/clock', {
      method: 'POST',
      body: JSON.stringify({ now: '2026-03-10T16:05' }),
    });
    assert.equal(clockAdv.status, 200);
    assert.ok(clockAdv.data.missed >= 1);

    // Check dashboard
    const { status, data } = await request('/api/dashboard');
    assert.equal(status, 200);
    assert.equal(data.identityHolds, true, 'Dashboard identity Listed = sum must always hold');
    assert.ok(data.totals.missed > 0);
    assert.ok(data.totals.wasted > 0);
  });

  test('Dashboard identity Listed = sum holds after EVERY operation in a multi-step sequence', async () => {
    const assertIdentity = async (stepName) => {
      const { status, data } = await request('/api/dashboard');
      assert.equal(status, 200);
      assert.equal(
        data.identityHolds,
        true,
        `Identity violated at step: ${stepName} (Listed: ${data.totals.listed}, Accounted: ${data.accounted})`
      );
    };

    // Step 1: Initial state
    await assertIdentity('Initial state');

    // Step 2: Donor D2 posts donation
    const postRes = await request('/api/donations', {
      method: 'POST',
      headers: { 'X-Actor-Id': 'D2' },
      body: JSON.stringify({
        description: 'Dal Khichdi',
        quantity_kg: 20,
        pickup_from: '2026-03-10T18:00',
        pickup_until: '2026-03-10T21:00',
      }),
    });
    assert.equal(postRes.status, 201);
    const donationId = postRes.data.id;
    await assertIdentity('After posting donation');

    // Step 3: Volunteer V1 claims 10kg
    const claimRes1 = await request(`/api/donations/${donationId}/claims`, {
      method: 'POST',
      headers: { 'X-Actor-Id': 'V1' },
      body: JSON.stringify({ kg: 10, planned_at: '2026-03-10T20:00' }),
    });
    assert.equal(claimRes1.status, 201);
    await assertIdentity('After claim 1 (V1 10kg)');

    // Step 4: Volunteer V2 claims 5kg
    const claimRes2 = await request(`/api/donations/${donationId}/claims`, {
      method: 'POST',
      headers: { 'X-Actor-Id': 'V2' },
      body: JSON.stringify({ kg: 5, planned_at: '2026-03-10T18:30' }),
    });
    assert.equal(claimRes2.status, 201);
    await assertIdentity('After claim 2 (V2 5kg)');

    // Step 5: Advance clock into pickup window (18:30)
    await request('/api/clock', {
      method: 'POST',
      body: JSON.stringify({ now: '2026-03-10T18:30' }),
    });
    await assertIdentity('After clock move to 18:30');

    // Step 6: Volunteer V2 marks claim 2 COLLECTED (now is 18:30, within window)
    const collectRes = await request(`/api/claims/${claimRes2.data.id}/collect`, {
      method: 'POST',
      headers: { 'X-Actor-Id': 'V2' },
    });
    assert.equal(collectRes.status, 200);
    await assertIdentity('After collect claim 2');

    // Step 7: Volunteer V1 cancels claim 1 (now is 18:30, planned is 20:00, strictly before)
    const cancelClaimRes = await request(`/api/claims/${claimRes1.data.id}/cancel`, {
      method: 'POST',
      headers: { 'X-Actor-Id': 'V1' },
    });
    assert.equal(cancelClaimRes.status, 200);
    await assertIdentity('After cancel claim 1');

    // Step 8: Donor D2 posts another donation and cancels it
    const postTemp = await request('/api/donations', {
      method: 'POST',
      headers: { 'X-Actor-Id': 'D2' },
      body: JSON.stringify({
        description: 'Pulao',
        quantity_kg: 10,
        pickup_from: '2026-03-10T19:00',
        pickup_until: '2026-03-10T20:00',
      }),
    });
    assert.equal(postTemp.status, 201);
    await assertIdentity('After posting second donation');

    const cancelDonRes = await request(`/api/donations/${postTemp.data.id}/cancel`, {
      method: 'POST',
      headers: { 'X-Actor-Id': 'D2' },
    });
    assert.equal(cancelDonRes.status, 200);
    await assertIdentity('After cancelling unreserved donation');

    // Step 9: Advance clock past 21:00 (to 21:15) so the first donation expires
    await request('/api/clock', {
      method: 'POST',
      body: JSON.stringify({ now: '2026-03-10T21:15' }),
    });
    await assertIdentity('After clock move past pickup window (expiration)');
  });
});
