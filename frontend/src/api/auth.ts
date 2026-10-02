import type { LoginRequest, SessionInfo } from '@boq/shared';
import { api, setCsrfToken } from './client';

const remember = (info: SessionInfo) => {
  setCsrfToken(info.csrfToken);
  return info;
};

export const fetchSession = async () => remember(await api<SessionInfo>('GET', '/api/auth/me'));
export const login = async (creds: LoginRequest) =>
  remember(await api<SessionInfo>('POST', '/api/auth/login', creds));
export async function logout(): Promise<void> {
  await api('POST', '/api/auth/logout');
  setCsrfToken(null);
}
