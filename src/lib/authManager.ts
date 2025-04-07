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

      await this.persistAuth();
    } catch (error) {
      console.error(`[zkpay/sdk] Failed to refresh auth token:`, error);
      throw new Error("Authentication failed");
    }
  }

  private async loadPersistedAuth(): Promise<void> {
    if (!isBrowser() || !this.signer) return;

    try {
      const encryptedData = localStorage.getItem(STORAGE_KEY);
      if (encryptedData) {
        const [ivHex, encryptedHex] = encryptedData.split(":");
        const iv = Uint8Array.from(Buffer.from(ivHex, "hex"));
        const encrypted = Uint8Array.from(Buffer.from(encryptedHex, "hex"));
        const key = await this.deriveSecretKey();
        const decrypted = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv },
          key,
          encrypted
        );
        const auth = JSON.parse(new TextDecoder().decode(decrypted)) as Auth;
        if (auth.expiredAt > Date.now()) {
          this.auth = auth;
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
      const key = await this.deriveSecretKey();
      const iv = crypto.getRandomValues(new Uint8Array(12)); // 12-byte IV for AES-GCM
      const encoder = new TextEncoder();
      const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        encoder.encode(JSON.stringify(this.auth))
      );
      const ivHex = Buffer.from(iv).toString("hex");
      const encryptedHex = Buffer.from(encrypted).toString("hex");
      localStorage.setItem(STORAGE_KEY, `${ivHex}:${encryptedHex}`);
    } catch (error) {
      console.warn(`[zkpay/sdk] Failed to persist auth:`, error);
    }
  }

  private async deriveSecretKey(): Promise<CryptoKey> {
    if (!this.signer) throw new Error("Signer required for key derivation");
    const address = await this.signer.getAddress();
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(address),
      { name: "PBKDF2" },
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: encoder.encode("zkpay-salt"),
        iterations: 100000,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  private prepareSiweMessage(address: string): string {
    const uri = isBrowser() ? window.location.origin : "https://zkpay.cc";
    const domain = uri.replace(/^https?:\/\//, "");
    const nonce = Math.random().toString(36).substring(2, 15); // not secure but since server is stateless, let's keep it simple
    const issuedAt = new Date().toISOString();

    return `${domain} wants you to sign in with your Ethereum account:\n${address}\n\n\nURI: ${uri}\nVersion: 1\nChain ID: 1\nNonce: ${nonce}\nIssued At: ${issuedAt}`;
  }
}
