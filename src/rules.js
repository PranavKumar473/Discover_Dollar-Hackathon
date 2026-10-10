// Pure business rules. No database, no Express and no real clock: every function
// receives "now" from the caller, so tests can pin any simulated moment.

const TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const HOLDS_TIME = ['ACTIVE', 'COLLECTED'];

function isValidTime(value) {
  if (typeof value !== 'string') return false;
  const match = TIME_RE.exec(value);
  if (!match) return false;
  const [y, mo, d, h, mi] = match.slice(1).map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi));
  // Date.UTC silently rolls over (Feb 30 -> Mar 2, 24:00 -> next day),
  // so a round trip is what rejects impossible calendar values.
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d
    && t.getUTCHours() === h && t.getUTCMinutes() === mi;
}

// Parsed as UTC so minute differences never include a daylight-saving jump.
function toMinutes(time) {
  return Date.parse(`${time}:00Z`) / 60000;
}

function minutesBetween(a, b) {
  return Math.abs(toMinutes(a) - toMinutes(b));
}

// MISSED claims still hold their kg; that is what keeps the dashboard identity exact.
function remainingKg(donation, claims) {
  const held = claims
    .filter((c) => c.donation_id === donation.id && c.status !== 'CANCELLED')
    .reduce((sum, c) => sum + c.kg, 0);
  return donation.quantity_kg - held;
}

function deriveStatus(donation, claims, now) {
  if (donation.cancelled) return 'CANCELLED';
  if (now > donation.pickup_until) return 'EXPIRED';
  if (remainingKg(donation, claims) === 0) return 'FULLY_CLAIMED';
  return 'OPEN';
}

function validateDonation({ pickup_from, pickup_until }, now) {
  const errors = [];
  if (!(pickup_from < pickup_until)) {
    errors.push({ rule: 'WINDOW', message: 'pickup_from must be before pickup_until' });
  }
  if (pickup_until < now) {
    errors.push({ rule: 'PAST', message: `pickup_until must not be before now (${now})` });
  }
  return errors;
}

// Every rule is checked independently so the volunteer sees all reasons at once.
// `donation.zone` is the donor's zone; `claims` may contain claims on any donation.
function validateClaim({ donation, volunteer, claims, kg, plannedAt, now }) {
  const errors = [];
  const status = deriveStatus(donation, claims, now);
  const remaining = remainingKg(donation, claims);

  if (status === 'CANCELLED' || status === 'EXPIRED') {
    errors.push({ rule: 1, message: `Donation is ${status}` });
  }
  if (kg > volunteer.capacity_kg) {
    errors.push({ rule: 2, message: `${kg} kg exceeds your capacity of ${volunteer.capacity_kg} kg` });
  }
  if (kg > remaining) {
    errors.push({ rule: 3, message: `${kg} kg exceeds the remaining ${remaining} kg` });
  }
  if (!volunteer.zones.includes(donation.zone)) {
    errors.push({ rule: 4, message: `Zone ${donation.zone} is not one of your zones (${volunteer.zones.join(', ')})` });
  }
  if (plannedAt < donation.pickup_from || plannedAt > donation.pickup_until) {
    errors.push({ rule: 5, message: `Planned time must be between ${donation.pickup_from} and ${donation.pickup_until}` });
  }
  if (plannedAt < now) {
    errors.push({ rule: 6, message: `Planned time must not be before now (${now})` });
  }
  const clashes = claims.filter((c) => c.volunteer_id === volunteer.id
    && HOLDS_TIME.includes(c.status)
    && minutesBetween(c.planned_at, plannedAt) < 60);
  if (clashes.length > 0) {
    const list = clashes.map((c) => `${c.id} at ${c.planned_at}`).join(', ');
    errors.push({ rule: 7, message: `Planned time must be at least 60 minutes from your other claims: ${list}` });
  }
  return errors;
}

function canCancelDonation(donation, claims, now) {
  const status = deriveStatus(donation, claims, now);
  if (status !== 'OPEN') {
    return { ok: false, reason: `Only OPEN donations can be cancelled (status is ${status})` };
  }
  const held = claims.some((c) => c.donation_id === donation.id && HOLDS_TIME.includes(c.status));
  if (held) return { ok: false, reason: 'Donation has ACTIVE or COLLECTED claims' };
  return { ok: true };
}

function canCollect(claim, donation, now) {
  if (claim.status !== 'ACTIVE') return { ok: false, reason: `Claim is ${claim.status}` };
  if (now < donation.pickup_from || now > donation.pickup_until) {
    return { ok: false, reason: `Collect only between ${donation.pickup_from} and ${donation.pickup_until}` };
  }
  return { ok: true };
}

function canCancelClaim(claim, now) {
  if (claim.status !== 'ACTIVE') return { ok: false, reason: `Claim is ${claim.status}` };
  if (!(now < claim.planned_at)) {
    return { ok: false, reason: `Cancel only before the planned time ${claim.planned_at}` };
  }
  return { ok: true };
}

function dashboard(donations, claims, donors, volunteers, now) {
  const live = donations.filter((d) => !d.cancelled);
  const donorOf = new Map(live.map((d) => [d.id, d.donor_id]));
  const liveClaims = claims.filter((c) => donorOf.has(c.donation_id));
  const kgWith = (list, status) => list.filter((c) => c.status === status).reduce((s, c) => s + c.kg, 0);

  let listed = 0;
  let wasted = 0;
  let stillOpen = 0;
  for (const d of live) {
    listed += d.quantity_kg;
    const remaining = remainingKg(d, claims);
    if (deriveStatus(d, claims, now) === 'EXPIRED') wasted += remaining;
    else stillOpen += remaining;
  }

  const totals = {
    listed,
    collected: kgWith(liveClaims, 'COLLECTED'),
    missed: kgWith(liveClaims, 'MISSED'),
    wasted,
    inProgress: kgWith(liveClaims, 'ACTIVE'),
    stillOpen,
  };
  const accounted = totals.collected + totals.missed + totals.wasted + totals.inProgress + totals.stillOpen;

  const byDonor = donors.map((donor) => ({
    id: donor.id,
    name: donor.name,
    collectedKg: kgWith(liveClaims.filter((c) => donorOf.get(c.donation_id) === donor.id), 'COLLECTED'),
  }));
  const byVolunteer = volunteers.map((v) => {
    const own = liveClaims.filter((c) => c.volunteer_id === v.id);
    return {
      id: v.id,
      name: v.name,
      collectedKg: kgWith(own, 'COLLECTED'),
      missedClaims: own.filter((c) => c.status === 'MISSED').length,
    };
  });

  return { totals, accounted, identityHolds: accounted === listed, byDonor, byVolunteer };
}

module.exports = {
  isValidTime,
  minutesBetween,
  remainingKg,
  deriveStatus,
  validateDonation,
  validateClaim,
  canCancelDonation,
  canCollect,
  canCancelClaim,
  dashboard,
};
