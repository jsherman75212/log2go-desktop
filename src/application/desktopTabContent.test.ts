import test from 'node:test';
import assert from 'node:assert/strict';
import {
  desktopSettingsSections,
  generalLogFieldGroups,
} from './desktopTabContent';

test('web settings skeleton exposes account/profile/service sections without local password storage claims', () => {
  assert.deepEqual(
    desktopSettingsSections().map((section) => section.title),
    ['Station Profiles', 'Log2Go Backend Account', 'Online Services', 'Web Storage'],
  );

  const allText = [
    ...desktopSettingsSections().flatMap((section) => [section.title, section.description, ...section.items]),
  ].join(' ');

  assert.match(allText, /encrypted by the Log2Go backend/i);
  assert.doesNotMatch(allText, /OS-backed secret storage/i);
  assert.doesNotMatch(allText, /password field/i);
});

test('general log skeleton defines desktop QSO entry groups and recent-contact table columns', () => {
  const groups = generalLogFieldGroups();

  assert.deepEqual(
    groups.map((group) => group.title),
    ['Contact', 'Signal & Band', 'Location', 'Notes'],
  );

  assert.deepEqual(groups[0].fields, ['Callsign', 'Name']);
  assert.deepEqual(groups[1].fields, ['Frequency MHz', 'Band', 'Mode', 'RST Sent', 'RST Received']);
  assert.deepEqual(groups[2].fields, ['Grid', 'State', 'County', 'QTH']);
});
