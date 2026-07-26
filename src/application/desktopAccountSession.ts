import { setBackendSettings, type LoggingFlowState } from './loggingFlow';
import type { AccountProfile, LoginTokenResponse } from '../services/backendClient';

export type DesktopAccountSessionServices = {
  login(
    baseUrl: string,
    username: string,
    password: string,
    deviceId?: string,
  ): Promise<LoginTokenResponse>;
  getAccountProfile(baseUrl: string, token: string): Promise<AccountProfile>;
};

export type DesktopAccountSessionResult = {
  state: LoggingFlowState;
  accountProfile?: AccountProfile;
  message: string;
};

export async function logInDesktopAccount(
  state: LoggingFlowState,
  services: DesktopAccountSessionServices & { deviceId?: string },
): Promise<DesktopAccountSessionResult> {
  const backendBaseUrl = state.backendBaseUrl.trim();
  const username = state.username.trim();

  if (!backendBaseUrl || !username || !state.password) {
    return {
      state,
      message: 'Backend URL, username, and password are required to log in.',
    };
  }

  const tokenResponse = await services.login(
    backendBaseUrl,
    username,
    state.password,
    services.deviceId,
  );
  const nextState = setBackendSettings(state, {
    backendBaseUrl,
    username,
    password: state.password,
    accessToken: tokenResponse.access_token,
  });
  const accountProfile = await services.getAccountProfile(backendBaseUrl, tokenResponse.access_token);

  return {
    state: nextState,
    accountProfile,
    message: `Logged in as ${accountProfile.callsign || accountProfile.username}.`,
  };
}

export function logOutDesktopAccount(state: LoggingFlowState): LoggingFlowState {
  return {
    ...setBackendSettings(state, { password: '' }),
    accessToken: undefined,
  };
}
