'use strict';

/**
 * Nudge v1.5 — Phase 4 Runtime · Venue Intelligence
 * REFERENCE §10 Venue + 硬规则 #9
 *
 * facility.exists 与 availability 严格分离；
 * SUBSTITUTE 决策只写 availability，绝不改写 exists。
 */

const repository = require('../db/repository');

function assessVenue(venue, scenarioId) {
  if (!venue) {
    return { exists: null, availability: null, substitute_advised: false, squat_exists: null };
  }
  const exists = {};
  (venue.facilities || []).forEach((f) => { exists[f.name] = f.exists; });
  const availability = {};
  (venue.availability || []).forEach((a) => { availability[a.name] = a.status; });

  const squatExists = exists.squat_rack === true;
  const squatAvail = availability.squat_rack;
  const substituteAdvised = scenarioId === 'venue_blocked' && squatExists && squatAvail === 'occupied';

  return { exists, availability, substitute_advised: !!substituteAdvised, squat_exists: squatExists };
}

// 只写 availability（§10），不触碰 facilities.exists
function recordAvailabilityObservation(venueId, facility, status, source) {
  return repository.insertVenueObservation({
    id: 'vo_' + venueId + '_' + facility + '_' + Date.now(),
    venue_id: venueId,
    facility,
    status,
    observed_at: new Date().toISOString(),
    source: source || 'user_report',
    confidence: 0.90
  });
}

module.exports = { assessVenue, recordAvailabilityObservation };
