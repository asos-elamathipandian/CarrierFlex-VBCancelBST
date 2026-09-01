'use strict';

/**
 * carrier-profile.js
 *
 * Returns EDI / SFTP profile data for a given carrier code.
 * Adapted from QAsupportKit-Azure/src/carrier-profile.js.
 * Add new carrier entries here as onboarding progresses.
 */

function getCarrierProfile(carrierInput = 'DT') {
  const key = String(carrierInput || '').trim().toLowerCase();

  if (['dt', 'davies turner', 'daviestn'].includes(key)) {
    return {
      input:    'DT',
      sender:   'DAVIESTN',
      receiver: 'E2ASOS',
      filePrefix: 'DAVIESTN',
      vbkreqSenderId: 'DAVIESTN',
      carrierId: '3',
    };
  }

  if (['maersk', 'maeu'].includes(key)) {
    return {
      input:    'Maersk',
      sender:   'MAEU',
      receiver: 'E2ASOS',
      filePrefix: 'MAEU',
      vbkreqSenderId: 'MAEU',
      carrierId: '12',
    };
  }

  if (['advanced', 'adv'].includes(key)) {
    return {
      input:    'Advanced',
      sender:   'ADV',
      receiver: 'E2ASOS',
      filePrefix: 'ADV',
      vbkreqSenderId: 'ADV',
      carrierId: '5',
    };
  }

  if (['chr', 'usa'].includes(key)) {
    return {
      input:    'CHR',
      sender:   'RBTWTEST',
      receiver: 'E2ASOS',
      filePrefix: 'RBTWTEST',
      vbkreqSenderId: 'RBTWTEST',
      carrierId: '10',
    };
  }

  if (['evcargo', 'allport', 'evcargo/allport'].includes(key)) {
    return {
      input:    'EVCargo',
      sender:   'EVCARGOQA',
      receiver: 'E2ASOS',
      filePrefix: 'EVCARGOQA',
      vbkreqSenderId: 'EVCARGOQA',
      carrierId: '2',
    };
  }

  throw new Error(
    `Unknown carrier: "${carrierInput}". ` +
    `Add an entry to carrier-profile.js or set CARRIER_CODE to one of: DT, Maersk, Advanced, CHR, EVCargo`
  );
}

module.exports = { getCarrierProfile };
