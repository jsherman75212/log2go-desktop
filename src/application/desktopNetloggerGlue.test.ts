import test from 'node:test';
import assert from 'node:assert/strict';

const glue = require('./desktopNetloggerGlue.ts');
const loggingFlow = require('./loggingFlow.ts');
const netloggerClient = require('../services/netloggerClient.ts');

const client = netloggerClient.default ?? netloggerClient;

test('desktop glue converts an active net into the selected-net shape', () => {
  const selected = glue.toSelectedNet({
    serverName: 'NETLOGGER3',
    netName: '3905 40m SSB Late Net',
    altNetName: '',
    frequency: '7.195',
    logger: 'N5ABC-LOGGER - v3.1.7W',
    netControl: 'W5NCS',
    date: '2026-07-06 04:00:00',
    mode: 'SSB',
    band: '40m',
    subscriberCount: 42,
  });

  assert.deepEqual(selected, {
    serverName: 'NETLOGGER3',
    netName: '3905 40m SSB Late Net',
    frequency: '7.195',
    mode: 'SSB',
    band: '40m',
    netControl: 'W5NCS',
    logger: 'N5ABC-LOGGER - v3.1.7W',
  });
});

test('desktop glue maps a roster check-in into a local contact draft', () => {
  const selectedNet = {
    serverName: 'NETLOGGER3',
    netName: '3905 40m SSB Late Net',
    frequency: '7.195',
    mode: 'SSB',
    band: '40m',
    netControl: 'W5NCS',
    logger: 'N5ABC-LOGGER - v3.1.7W',
  };

  const draft = glue.draftFromCheckin({
    serialNo: 12,
    callsign: 'ke5zqv',
    state: 'TX',
    remarks: 'Mobile today',
    qslInfo: 'QRZ/LoTW',
    cityCountry: 'Runaway Bay',
    firstName: 'William',
    preferredName: 'Jody',
    status: '(rel)',
    county: 'Wise',
    grid: 'EM13be',
    street: '',
    zip: '',
    memberId: '1234',
    country: 'United States',
    dxcc: '291',
  }, selectedNet);

  assert.equal(draft.callsign, 'ke5zqv');
  assert.equal(draft.name, 'Jody');
  assert.equal(draft.frequency, '7.195');
  assert.equal(draft.band, '40m');
  assert.equal(draft.mode, 'SSB');
  assert.equal(draft.grid, 'EM13be');
  assert.equal(draft.remarks, 'Mobile today | QRZ/LoTW');
});

test('desktop glue assigns operating-status classes used by the roster table', () => {
  assert.equal(glue.statusClass('(nc)'), 'status-nc');
  assert.equal(glue.statusClass('(log)'), 'status-logger');
  assert.equal(glue.statusClass('(rel)'), 'status-relay');
  assert.equal(glue.statusClass('(c/o)'), 'status-checked-out');
  assert.equal(glue.statusClass('(n/h)'), 'status-not-heard');
  assert.equal(glue.statusClass('(n)'), 'status-needed');
  assert.equal(glue.statusClass('(nxt)'), 'status-needed-next');
  assert.equal(glue.statusClass('(w)'), 'status-netlogger-worked');
  assert.equal(glue.statusClass('(u)'), 'status-unavailable');
  assert.equal(glue.statusClass('(n/r)'), 'status-not-responding');
  assert.equal(glue.statusClass('(vip)'), 'status-vip');
  assert.equal(glue.statusClass('(op)'), 'status-operator');
  assert.equal(glue.statusClass('', true), 'status-current-operating');
  assert.equal(glue.statusClass(''), '');
});

test('desktop glue creates stable roster row keys for selection state', () => {
  assert.equal(glue.rosterRowKey({ serialNo: 12, callsign: ' ke5zqv ' }), '12:KE5ZQV');
});

test('desktop glue sorts roster serial numbers numerically, not lexicographically', () => {
  const rows = [
    { serialNo: 1, callsign: 'K1AAA' },
    { serialNo: 10, callsign: 'K10AAA' },
    { serialNo: 2, callsign: 'K2AAA' },
  ].map((row) => ({
    state: '',
    remarks: '',
    qslInfo: '',
    cityCountry: '',
    firstName: '',
    preferredName: '',
    status: '',
    county: '',
    grid: '',
    street: '',
    zip: '',
    memberId: '',
    country: '',
    dxcc: '',
    ...row,
  }));

  assert.deepEqual(
    glue.sortRosterCheckins(rows, { key: 'serialNo', dir: 'asc' }).map((row: { serialNo: number }) => row.serialNo),
    [1, 2, 10],
  );
  assert.deepEqual(
    glue.sortRosterCheckins(rows, { key: 'serialNo', dir: 'desc' }).map((row: { serialNo: number }) => row.serialNo),
    [10, 2, 1],
  );
});

test('desktop glue defines roster density options and CSS class names', () => {
  assert.deepEqual(
    glue.rosterDensityOptions.map((option: { label: string }) => option.label),
    ['Normal', 'Compact', 'Extra compact'],
  );
  assert.equal(glue.rosterDensityClass('normal'), 'roster-density-normal');
  assert.equal(glue.rosterDensityClass('compact'), 'roster-density-compact');
  assert.equal(glue.rosterDensityClass('extra-compact'), 'roster-density-extra-compact');
});

test('desktop glue marks roster check-ins already logged on the selected net', () => {
  const selectedNet = {
    serverName: 'NETLOGGER3',
    netName: '3905 40m SSB Late Net',
    frequency: '7.195',
    mode: 'SSB',
    band: '40m',
    netControl: 'W5NCS',
    logger: 'N5ABC-LOGGER - v3.1.7W',
  };
  const otherNet = { ...selectedNet, netName: 'Different Net' };
  const checkin = {
    serialNo: 12,
    callsign: 'ke5zqv',
    state: 'TX',
    remarks: '',
    qslInfo: '',
    cityCountry: 'Runaway Bay',
    firstName: 'William',
    preferredName: 'Jody',
    status: '',
    county: 'Wise',
    grid: 'EM13be',
    street: '',
    zip: '',
    memberId: '1234',
    country: 'United States',
    dxcc: '291',
  };
  const state = loggingFlow.logContact(loggingFlow.createInitialLoggingFlowState(), {
    callsign: ' KE5ZQV ',
    loggingMode: 'nets',
    mode: 'SSB',
    signalReport: { sent: '59', received: '59' },
    netLoggerContext: { netName: selectedNet.netName, netControlCallsign: selectedNet.netControl },
  });

  assert.equal(glue.normalizeRosterCallsign(' ke5zqv '), 'KE5ZQV');
  assert.equal(glue.isCheckinWorked(checkin, state.contacts, selectedNet), true);
  assert.equal(glue.workedFlag(checkin, state.contacts, selectedNet), 'W');
  assert.equal(glue.isCheckinWorked(checkin, state.contacts, otherNet), false);
  assert.equal(glue.workedFlag(checkin, state.contacts, otherNet), '');
});

test('local desktop logging creates a queued net contact with normalized fields', () => {
  const state = loggingFlow.createInitialLoggingFlowState({ now: () => '2026-07-06T04:00:00.000Z' });
  const next = loggingFlow.logContact(state, {
    callsign: ' ke5zqv ',
    contactedAt: '2026-07-06T04:05:00.000Z',
    loggingMode: 'nets',
    frequencyMhz: '7.195',
    band: '40m',
    mode: 'SSB',
    signalReport: { sent: '59', received: '57' },
    operatorName: 'Jody',
    location: 'Runaway Bay',
    grid: 'em13be',
    county: 'Wise',
    notes: 'Desktop test contact',
    netLoggerContext: {
      netName: '3905 40m SSB Late Net',
      netControlCallsign: 'W5NCS',
    },
  });

  assert.equal(next.contacts.length, 1);
  assert.equal(next.syncState, 'queued');
  assert.equal(next.session.currentContactNumber, 2);

  const contact = next.contacts[0];
  assert.equal(contact.callsign, 'KE5ZQV');
  assert.equal(contact.frequencyMhz, 7.195);
  assert.equal(contact.band, '40m');
  assert.equal(contact.grid, 'EM13BE');
  assert.equal(contact.signalReport.sent, '59');
  assert.equal(contact.signalReport.received, '57');
  assert.equal(contact.netLoggerContext.netName, '3905 40m SSB Late Net');
  assert.equal(contact.syncStatus, 'queued');
});

test('NetLogger active-nets XML parser flattens server-grouped nets for desktop display', () => {
  const xml = `<?xml version="1.0"?>
<NetLoggerXML>
  <Header>
    <CreationDateUTC>2026-07-06 04:00:00</CreationDateUTC>
    <Copyright>NetLogger</Copyright>
    <APIVersion>1.3.1</APIVersion>
    <TimeZone>UTC</TimeZone>
  </Header>
  <ServerList>
    <ResponseCode>200 OK</ResponseCode>
    <Server>
      <ServerName>NETLOGGER3</ServerName>
      <ServerActiveNetCount>1</ServerActiveNetCount>
      <Net>
        <NetName>3905 40m SSB Late Net</NetName>
        <AltNetName></AltNetName>
        <Frequency>7.195</Frequency>
        <Logger>N5ABC-LOGGER - v3.1.7W</Logger>
        <NetControl>W5NCS</NetControl>
        <Date>2026-07-06 04:00:00</Date>
        <Mode>SSB</Mode>
        <Band>40m</Band>
        <SubscriberCount>42</SubscriberCount>
      </Net>
    </Server>
  </ServerList>
</NetLoggerXML>`;

  const response = client.parseActiveNetsXml(xml);
  const flat = client.flattenActiveNets(response);

  assert.equal(response.responseCode, '200 OK');
  assert.equal(response.servers.length, 1);
  assert.equal(flat.length, 1);
  assert.equal(flat[0].serverName, 'NETLOGGER3');
  assert.equal(flat[0].netName, '3905 40m SSB Late Net');
  assert.equal(flat[0].subscriberCount, 42);
});
