const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const seed = require('../seed.json');
const {
  isValidTime, minutesBetween, remainingKg, deriveStatus, validateDonation,
  validateClaim, canCancelDonation, canCollect, canCancelClaim, dashboard,
} = require('../src/rules');

const NOW = '2026-03-10T12:00';
const donation = (over = {}) => ({
  id: 'DN1', donor_id: 'D1', zone: 'NORTH', quantity_kg: 30,
  pickup_from: '2026-03-10T18:00', pickup_until: '2026-03-10T20:00', cancelled: 0, ...over,
});
const volunteer = (over = {}) => ({ id: 'V1', capacity_kg: 20, zones: ['NORTH', 'EAST'], ...over });
const claim = (over = {}) => ({
  id: 'C1', donation_id: 'DN1', volunteer_id: 'V1', kg: 5,
  planned_at: '2026-03-10T18:00', status: 'ACTIVE', ...over,
});
const failedRules = (over = {}) => validateClaim({
  donation: donation(), volunteer: volunteer(), claims: [],
  kg: 10, plannedAt: '2026-03-10T18:30', now: NOW, ...over,
}).map((e) => e.rule);

describe('time helpers', () => {
  test('accepts exact YYYY-MM-DDTHH:MM only', () => {
    assert.equal(isValidTime('2026-03-10T18:00'), true);
    assert.equal(isValidTime('2024-02-29T00:00'), true);
    for (const bad of ['2026-02-30T10:00', '2026-03-10T24:00', '2026-03-10T10:60',
      '2026-03-10T10:00:00', '2026-03-10 10:00', '2026-3-10T10:00', '', null, 123]) {
      assert.equal(isValidTime(bad), false, String(bad));
    }
  });

  test('minutesBetween works across midnight', () => {
    assert.equal(minutesBetween('2026-03-10T23:30', '2026-03-11T00:30'), 60);
  });
});

describe('remainingKg and deriveStatus', () => {
  test('remaining ignores CANCELLED but counts MISSED, COLLECTED and ACTIVE', () => {
    const claims = [
      claim({ kg: 5, status: 'CANCELLED' }), claim({ kg: 4, status: 'MISSED' }),
      claim({ kg: 3, status: 'COLLECTED' }), claim({ kg: 2 }),
      claim({ kg: 9, donation_id: 'DN2' }),
    ];
    assert.equal(remainingKg(donation(), claims), 30 - 4 - 3 - 2);
  });

  test('status precedence: CANCELLED > EXPIRED > FULLY_CLAIMED > OPEN', () => {
    const full = [claim({ kg: 30 })];
    assert.equal(deriveStatus(donation({ cancelled: 1 }), full, '2026-03-10T21:00'), 'CANCELLED');
    assert.equal(deriveStatus(donation(), full, '2026-03-10T20:01'), 'EXPIRED');
    assert.equal(deriveStatus(donation(), full, NOW), 'FULLY_CLAIMED');
    assert.equal(deriveStatus(donation(), [], NOW), 'OPEN');
  });

  test('not EXPIRED at exactly pickup_until', () => {
    assert.equal(deriveStatus(donation(), [], '2026-03-10T20:00'), 'OPEN');
  });
});

describe('validateDonation', () => {
  test('pickup_until == now is allowed', () => {
    assert.deepEqual(validateDonation({ pickup_from: '2026-03-10T11:00', pickup_until: NOW }, NOW), []);
  });

  test('equal window is refused', () => {
    const errors = validateDonation({ pickup_from: '2026-03-10T18:00', pickup_until: '2026-03-10T18:00' }, NOW);
    assert.deepEqual(errors.map((e) => e.rule), ['WINDOW']);
  });

  test('reports both reversed window and past end', () => {
    const errors = validateDonation({ pickup_from: '2026-03-10T11:30', pickup_until: '2026-03-10T11:00' }, NOW);
    assert.deepEqual(errors.map((e) => e.rule), ['WINDOW', 'PAST']);
  });
});

describe('validateClaim boundaries', () => {
  test('a valid claim has no errors', () => assert.deepEqual(failedRules(), []));

  test('rule 1: cancelled or expired donation', () => {
    assert.deepEqual(failedRules({ donation: donation({ cancelled: 1 }) }), [1]);
  });

  test('rule 2: kg == capacity allowed, capacity + 1 refused', () => {
    assert.deepEqual(failedRules({ kg: 20 }), []);
    assert.deepEqual(failedRules({ kg: 21 }), [2]);
  });

  test('rule 3: kg == remaining allowed, remaining + 1 refused', () => {
    const claims = [claim({ volunteer_id: 'V2', kg: 22 })];
    assert.deepEqual(failedRules({ claims, kg: 8 }), []);
    assert.deepEqual(failedRules({ claims, kg: 9 }), [3]);
  });

  test('rule 4: zone must be one of the volunteer zones', () => {
    assert.deepEqual(failedRules({ volunteer: volunteer({ zones: ['SOUTH'] }) }), [4]);
  });

  test('rule 5: T == pickup_from and T == pickup_until allowed, outside refused', () => {
    assert.deepEqual(failedRules({ plannedAt: '2026-03-10T18:00' }), []);
    assert.deepEqual(failedRules({ plannedAt: '2026-03-10T20:00' }), []);
    assert.deepEqual(failedRules({ plannedAt: '2026-03-10T17:59' }), [5]);
    assert.deepEqual(failedRules({ plannedAt: '2026-03-10T20:01' }), [5]);
  });

  test('rule 6: T == now allowed, T before now refused', () => {
    assert.deepEqual(failedRules({ now: '2026-03-10T18:30' }), []);
    assert.deepEqual(failedRules({ now: '2026-03-10T18:31' }), [6]);
  });

  test('rule 7: exactly 60 minutes allowed, 59 refused, on any donation', () => {
    const other = (planned_at) => [claim({ donation_id: 'DN2', planned_at })];
    assert.deepEqual(failedRules({ claims: other('2026-03-10T19:30') }), []);
    assert.deepEqual(failedRules({ claims: other('2026-03-10T19:29') }), [7]);
    assert.deepEqual(failedRules({ claims: other('2026-03-10T17:31') }), [7]);
  });

  test('rule 7 counts COLLECTED, ignores CANCELLED, MISSED and other volunteers', () => {
    const at = '2026-03-10T18:30';
    assert.deepEqual(failedRules({ claims: [claim({ planned_at: at, status: 'COLLECTED' })] }), [7]);
    assert.deepEqual(failedRules({ claims: [claim({ planned_at: at, status: 'CANCELLED' })] }), []);
    assert.deepEqual(failedRules({ claims: [claim({ planned_at: at, status: 'MISSED' })] }), []);
    assert.deepEqual(failedRules({ claims: [claim({ planned_at: at, volunteer_id: 'V2' })] }), []);
  });

  test('rules are independent: expired donation reports every failing rule', () => {
    const rules = failedRules({
      volunteer: volunteer({ zones: ['SOUTH'] }),
      kg: 31,
      plannedAt: '2026-03-10T19:00',
      now: '2026-03-10T20:30',
    });
    assert.deepEqual(rules, [1, 2, 3, 4, 6]);
  });
});

describe('claim and donation actions', () => {
  test('canCancelDonation: OPEN with only CANCELLED claims is allowed', () => {
    assert.equal(canCancelDonation(donation(), [], NOW).ok, true);
    assert.equal(canCancelDonation(donation(), [claim({ status: 'CANCELLED' })], NOW).ok, true);
  });

  test('canCancelDonation: refused with ACTIVE/COLLECTED claims or when not OPEN', () => {
    assert.equal(canCancelDonation(donation(), [claim()], NOW).ok, false);
    assert.equal(canCancelDonation(donation(), [claim({ status: 'COLLECTED' })], '2026-03-10T18:30').ok, false);
    assert.equal(canCancelDonation(donation(), [], '2026-03-10T20:01').ok, false);
    assert.equal(canCancelDonation(donation({ cancelled: 1 }), [], NOW).ok, false);
  });

  test('canCollect: allowed at exactly pickup_from and pickup_until only', () => {
    assert.equal(canCollect(claim(), donation(), '2026-03-10T18:00').ok, true);
    assert.equal(canCollect(claim(), donation(), '2026-03-10T20:00').ok, true);
    assert.equal(canCollect(claim(), donation(), '2026-03-10T17:59').ok, false);
    assert.equal(canCollect(claim(), donation(), '2026-03-10T20:01').ok, false);
    assert.equal(canCollect(claim({ status: 'COLLECTED' }), donation(), '2026-03-10T18:30').ok, false);
  });

  test('canCancelClaim: strictly before T only', () => {
    assert.equal(canCancelClaim(claim(), '2026-03-10T17:59').ok, true);
    assert.equal(canCancelClaim(claim(), '2026-03-10T18:00').ok, false);
    assert.equal(canCancelClaim(claim({ status: 'MISSED' }), NOW).ok, false);
  });
});

describe('dashboard', () => {
  const zoneOf = new Map(seed.donors.map((d) => [d.id, d.zone]));
  const seedDonations = seed.donations.map((d) => ({ ...d, cancelled: 0, zone: zoneOf.get(d.donor_id) }));
  const people = [seed.donors, seed.volunteers];

  test('seed starts at Listed 117, all still open', () => {
    const { totals, identityHolds } = dashboard(seedDonations, [], ...people, seed.clock);
    assert.equal(totals.listed, 117);
    assert.equal(totals.stillOpen, 117);
    assert.equal(identityHolds, true);
  });

  test('DN3 after 16:00: missed kg stays held, the rest is wasted', () => {
    const claims = [
      claim({ id: 'C1', donation_id: 'DN3', volunteer_id: 'V3', kg: 10, status: 'MISSED' }),
      claim({ id: 'C2', donation_id: 'DN1', volunteer_id: 'V1', kg: 20, status: 'COLLECTED' }),
    ];
    const { totals, identityHolds, byDonor, byVolunteer } = dashboard(seedDonations, claims, ...people, '2026-03-10T16:01');
    assert.equal(totals.missed, 10);
    assert.equal(totals.wasted, 15);
    assert.equal(totals.collected, 20);
    assert.equal(identityHolds, true);
    assert.equal(byDonor.find((d) => d.id === 'D1').collectedKg, 20);
    assert.equal(byVolunteer.find((v) => v.id === 'V3').missedClaims, 1);
  });

  test('a cancelled donation is excluded from every figure', () => {
    const donations = seedDonations.map((d) => (d.id === 'DN2' ? { ...d, cancelled: 1 } : d));
    const claims = [claim({ donation_id: 'DN2', kg: 4, status: 'CANCELLED' })];
    const { totals, identityHolds } = dashboard(donations, claims, ...people, seed.clock);
    assert.equal(totals.listed, 107);
    assert.equal(totals.stillOpen, 107);
    assert.equal(identityHolds, true);
  });
});

describe('seed data facts', () => {
  const zoneOf = new Map(seed.donors.map((d) => [d.id, d.zone]));
  const byId = (id) => {
    const d = seed.donations.find((x) => x.id === id);
    return { ...d, cancelled: 0, zone: zoneOf.get(d.donor_id) };
  };

  test('DN1 and DN5 exceed every single capacity in their zones', () => {
    for (const id of ['DN1', 'DN5']) {
      const d = byId(id);
      for (const v of seed.volunteers.filter((x) => x.zones.includes(d.zone))) {
        assert.ok(d.quantity_kg > v.capacity_kg, `${id} vs ${v.id}`);
      }
    }
  });

  test('one volunteer taking both NORTH 18:00 donations needs 60 minutes between pickups', () => {
    const v1 = seed.volunteers.find((v) => v.id === 'V1');
    const first = [claim({ donation_id: 'DN1', kg: 10, planned_at: '2026-03-10T18:00' })];
    const attempt = (plannedAt) => validateClaim({
      donation: byId('DN2'), volunteer: v1, claims: first, kg: 5, plannedAt, now: seed.clock,
    }).map((e) => e.rule);
    assert.deepEqual(attempt('2026-03-10T18:30'), [7]);
    assert.deepEqual(attempt('2026-03-10T19:00'), []);
  });
});
