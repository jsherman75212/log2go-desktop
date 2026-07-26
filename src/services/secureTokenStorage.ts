export type SecureTokenStorage = {
  getToken(key: string): Promise<string | null>;
  setToken(key: string, token: string): Promise<void>;
  deleteToken(key: string): Promise<void>;
};

export const createSecureTokenStoragePlaceholder = (): SecureTokenStorage => ({
  async getToken() {
    throw new Error('Secure token storage is not implemented yet.');
  },
  async setToken() {
    throw new Error('Secure token storage is not implemented yet.');
  },
  async deleteToken() {
    throw new Error('Secure token storage is not implemented yet.');
  },
});
