import test from 'node:test';
import assert from 'node:assert/strict';

import { createInitialLoggingFlowState } from './loggingFlow';

test('desktop logging flow defaults to the public Log2Go API host for account login', () => {
  const state = createInitialLoggingFlowState();

  assert.equal(state.backendBaseUrl, 'https://api.log2goapp.net');
});
