import test from 'node:test';
import assert from 'node:assert/strict';
import { logWebContact } from './webLogging';
import { createInitialLoggingFlowState, type LoggingFlowState, type LogContactInput } from './loggingFlow';

// Helper to create a minimal state with optional backend config
function initState(overrides: Partial<LoggingFlowState> = {}): LoggingFlowState {
  const base = createInitialLoggingFlowState();
  return { ...base, ...overrides };
}

const sampleInput: LogContactInput = {
  callsign: 'W1AW',
  loggingMode: 'nets',
};



test('logWebContact without backend URL or token saves locally only', async () => {
  const state = initState({ backendBaseUrl: '', accessToken: '' });
  const result = await logWebContact(state, sampleInput);
  assert.equal(result.message.includes('saved in local browser state only'), true);
  assert.equal(result.state.syncState, 'queued');
});

test('logWebContact successful backend save marks contact synced', async () => {
  const mockCreate = async (_url: string, _token: string, _contact: any) => ({ success: true, response_code: '200 OK' });
  const state = initState({ backendBaseUrl: 'https://api.example.test/', accessToken: 'tok' });
  const result = await logWebContact(state, sampleInput, { createContact: mockCreate });
  assert.equal(result.message.includes('Saved W1AW to Log2Go backend'), true);
  assert.equal(result.state.syncState, 'synced');
});

test('logWebContact backend failure marks contact failed', async () => {
  const mockCreate = async () => { throw new Error('boom'); };
  const state = initState({ backendBaseUrl: 'https://api.example.test/', accessToken: 'tok' });
  const result = await logWebContact(state, sampleInput, { createContact: mockCreate });
  assert.ok(result.message.includes('not saved to backend'));
  assert.equal(result.state.syncState, 'failed');
});
