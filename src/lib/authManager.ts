import CryptoJS from "crypto-js";
import { ApiClient } from "./apiClient";
import { Auth, AuthResponse } from "./types";
import { Signer } from "ethers";

const STORAGE_KEY = "zkpay_auth";
const isBrowser = () =>
  typeof window !== "undefined" && typeof localStorage !== "undefined";

export class AuthManager {
  private readonly apiClient: ApiClient;
  private readonly signer?: Signer;
  private auth?: Auth;
  private refreshingToken: Promise<void> | null = null;

  private constructor(apiClient: ApiClient, signer?: Signer) {
    this.signer = signer;
    this.apiClient = apiClient;
  }

  static async create(
    apiClient: ApiClient,
    signer?: Signer
  ): Promise<AuthManager> {
    const manager = new AuthManager(apiClient, signer);
    await manager.loadPersistedAuth();
    return manager;
  }

  async ensureAuthenticated(): Promise<void> {
    if (!this.signer) return;

    if (this.auth && this.auth.expiredAt > Date.now()) return;

    if (this.refreshingToken) return this.refreshingToken;

    this.refreshingToken = this.refreshAuthToken();
    try {
      await this.refreshingToken;
    } finally {
      this.refreshingToken = null;
    }
  }

  getAuthToken(): string | undefined {
    return this.auth?.token;
  }

  private async refreshAuthToken(): Promise<void> {
    if (!this.signer) throw new Error("Signer is required for authentication");

    try {
      const address = await this.signer.getAddress();
      const message = this.prepareSiweMessage(address);
      const signature = await this.signer.signMessage(message);

      const { token, expiresIn } = await this.apiClient.post<AuthResponse>(
        "/v1/auth",
        { message, signature }
      );

      const bufferSeconds = 60;
      this.auth = {
        token,
        expiredAt: Date.now() + (expiresIn - bufferSeconds) * 1000,
      };

      this.persistAuth();
    } catch (error) {
      console.error(`[zkpay/sdk] Failed to refresh auth token:`, error);
      throw new Error("Authentication failed");
    }
  }

  private async loadPersistedAuth(): Promise<void> {
    if (!isBrowser() || !this.signer) return;

    try {
      const encrypted = localStorage.getItem(STORAGE_KEY);
      if (encrypted) {
        const secretKey = await this.deriveSecretKey();
        const decrypted = CryptoJS.AES.decrypt(encrypted, secretKey).toString(
          CryptoJS.enc.Utf8
        );
        if (decrypted) {
          const auth = JSON.parse(decrypted) as Auth;
          if (auth.expiredAt > Date.now()) {
            this.auth = auth;
          }
        }

        // If the auth is not valid, remove it from localStorage
        if (!this.auth || this.auth.expiredAt <= Date.now()) {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    } catch (error) {
      console.warn(`[zkpay/sdk] Failed to load persisted auth:`, error);
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  private async persistAuth(): Promise<void> {
    if (!isBrowser() || !this.auth || !this.signer) return;

    try {
      const secretKey = await this.deriveSecretKey();
      const encrypted = CryptoJS.AES.encrypt(
        JSON.stringify(this.auth),
        secretKey
      ).toString();
      localStorage.setItem(STORAGE_KEY, encrypted);
    } catch (error) {
      console.warn(`[zkpay/sdk] Failed to persist auth:`, error);
    }
  }

  private async deriveSecretKey(): Promise<string> {
    if (!this.signer) throw new Error("Signer required for key derivation");
    const address = await this.signer.getAddress();
    return CryptoJS.SHA256(address).toString();
  }

  private prepareSiweMessage(address: string): string {
    const uri = isBrowser() ? window.location.origin : "https://zkpay.cc";
    const domain = uri.replace(/^https?:\/\//, "");
    const nonce = Math.random().toString(36).substring(2, 15);
    const issuedAt = new Date().toISOString();

    return `${domain} wants you to sign in with your Ethereum account:\n${address}\n\n\nURI: ${uri}\nVersion: 1\nChain ID: 1\nNonce: ${nonce}\nIssued At: ${issuedAt}`;
  }
}
