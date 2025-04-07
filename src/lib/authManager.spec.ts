import { AuthManager } from "./authManager";
import { ApiClient } from "./apiClient";
import { Signer } from "ethers";
import { MockProxy, mock } from "jest-mock-extended";

jest.mock("./apiClient");
jest.mock("crypto-js", () => ({
  AES: {
    encrypt: jest.fn((data, key) => `${data}::::${key}`),
    decrypt: jest.fn((encrypted, key) => {
      const [data, usedKey] = encrypted.split("::::");
      if (usedKey !== key || !data) {
        return { toString: () => "" }; // Simulate decryption failure
      }
      return { toString: () => data };
    }),
  },
  SHA256: jest.fn((input) => `hashed-${input}`),
  enc: { Utf8: Symbol("Utf8") },
}));

describe("AuthManager", () => {
  let authManager: AuthManager;
  let mockApiClient: jest.Mocked<ApiClient>;
  let mockSigner: MockProxy<Signer>;
  const mockAuthResponse = {
    token: "jwt-token",
    expiresIn: 3600,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockApiClient = mock<ApiClient>();
    mockSigner = mock<Signer>();
    mockSigner.getAddress.mockResolvedValue(
      "0xc375317f8403Cb633de95a0226210e3A1bAcb93a"
    );
    mockSigner.signMessage.mockResolvedValue("mock-signature");
    mockApiClient.post.mockResolvedValue(mockAuthResponse);

    // Mock localStorage
    const localStorageMock = new Map<string, string>();
    Object.defineProperty(global, "localStorage", {
      value: {
        getItem: jest.fn((key) => localStorageMock.get(key) || null),
        setItem: jest.fn((key, value) => localStorageMock.set(key, value)),
        removeItem: jest.fn((key) => localStorageMock.delete(key)),
      },
      writable: true,
    });
    Object.defineProperty(global, "window", {
      value: { location: { origin: "https://testapp.com" } },
      writable: true,
    });

    authManager = await AuthManager.create(mockApiClient);
  });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2025-03-28T03:03:03.333Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("create", () => {
    it("should initialize without signer", async () => {
      authManager = await AuthManager.create(mockApiClient);
      expect(authManager.getAuthToken()).toBeUndefined();
      expect(localStorage.getItem).not.toHaveBeenCalled();
    });

    it("should initialize with signer and attempt to load persisted auth", async () => {
      authManager = await AuthManager.create(mockApiClient, mockSigner);
      expect(authManager.getAuthToken()).toBeUndefined(); // No persisted auth yet
      expect(localStorage.getItem).toHaveBeenCalledWith("zkpay_auth");
    });
  });

  describe("ensureAuthenticated", () => {
    it("should do nothing if no signer is provided", async () => {
      await authManager.ensureAuthenticated();
      expect(mockApiClient.post).not.toHaveBeenCalled();
      expect(authManager.getAuthToken()).toBeUndefined();
    });

    it("should obtain new token if no auth exists with signer", async () => {
      authManager = await AuthManager.create(mockApiClient, mockSigner);
      await authManager.ensureAuthenticated();
      expect(mockApiClient.post).toHaveBeenCalledWith(
        "/v1/auth",
        expect.any(Object)
      );
      expect(authManager.getAuthToken()).toBe("jwt-token");
      expect(localStorage.setItem).toHaveBeenCalledWith(
        "zkpay_auth",
        expect.any(String)
      );
    });

    it("should reuse valid persisted token", async () => {
      const authData = { token: "valid-token", expiredAt: Date.now() + 1000 };
      const secretKey = "hashed-0xc375317f8403Cb633de95a0226210e3A1bAcb93a";
      const encrypted = `${JSON.stringify(authData)}::::${secretKey}`;
      localStorage.setItem("zkpay_auth", encrypted);
      authManager = await AuthManager.create(mockApiClient, mockSigner);

      await authManager.ensureAuthenticated();
      expect(mockApiClient.post).not.toHaveBeenCalled();
      expect(authManager.getAuthToken()).toBe("valid-token");
    });

    it("should refresh expired persisted token", async () => {
      const authData = { token: "expired-token", expiredAt: Date.now() - 1000 };
      const secretKey = "hashed-0xc375317f8403Cb633de95a0226210e3A1bAcb93a";
      const encrypted = `${JSON.stringify(authData)}::::${secretKey}`;
      localStorage.setItem("zkpay_auth", encrypted);
      authManager = await AuthManager.create(mockApiClient, mockSigner);

      await authManager.ensureAuthenticated();
      expect(mockApiClient.post).toHaveBeenCalledWith(
        "/v1/auth",
        expect.any(Object)
      );
      expect(authManager.getAuthToken()).toBe("jwt-token");
      expect(localStorage.setItem).toHaveBeenCalledWith(
        "zkpay_auth",
        expect.any(String)
      );
    });

    it("should handle concurrent refresh attempts", async () => {
      authManager = await AuthManager.create(mockApiClient, mockSigner);
      const promise1 = authManager.ensureAuthenticated();
      const promise2 = authManager.ensureAuthenticated();
      await Promise.all([promise1, promise2]);
      expect(mockApiClient.post).toHaveBeenCalledTimes(1);
      expect(authManager.getAuthToken()).toBe("jwt-token");
    });

    it("should throw on API authentication failure", async () => {
      mockApiClient.post.mockRejectedValue(new Error("API error"));
      authManager = await AuthManager.create(mockApiClient, mockSigner);
      await expect(authManager.ensureAuthenticated()).rejects.toThrow(
        "Authentication failed"
      );
      expect(authManager.getAuthToken()).toBeUndefined();
    });

    it("should throw on signer failure", async () => {
      mockSigner.signMessage.mockRejectedValue(new Error("Signing rejected"));
      authManager = await AuthManager.create(mockApiClient, mockSigner);
      await expect(authManager.ensureAuthenticated()).rejects.toThrow(
        "Authentication failed"
      );
      expect(authManager.getAuthToken()).toBeUndefined();
    });

    it("should clear invalid persisted auth and refresh", async () => {
      localStorage.setItem("zkpay_auth", "invalid-data");
      authManager = await AuthManager.create(mockApiClient, mockSigner);
      await authManager.ensureAuthenticated();
      expect(localStorage.removeItem).toHaveBeenCalledWith("zkpay_auth");
      expect(mockApiClient.post).toHaveBeenCalledWith(
        "/v1/auth",
        expect.any(Object)
      );
      expect(authManager.getAuthToken()).toBe("jwt-token");
    });

    it("should not persist or load auth outside browser", async () => {
      Object.defineProperty(global, "window", { value: undefined });
      authManager = await AuthManager.create(mockApiClient, mockSigner);
      await authManager.ensureAuthenticated();
      expect(localStorage.setItem).not.toHaveBeenCalled();
      expect(localStorage.getItem).not.toHaveBeenCalled();
      expect(authManager.getAuthToken()).toBe("jwt-token");
    });
  });

  describe("getAuthToken", () => {
    it("should return undefined if no auth exists", () => {
      expect(authManager.getAuthToken()).toBeUndefined();
    });

    it("should return token after successful authentication", async () => {
      authManager = await AuthManager.create(mockApiClient, mockSigner);
      await authManager.ensureAuthenticated();
      expect(authManager.getAuthToken()).toBe("jwt-token");
    });

    it("should return valid persisted token", async () => {
      const authData = {
        token: "persisted-token",
        expiredAt: Date.now() + 1000,
      };
      const secretKey = "hashed-0xc375317f8403Cb633de95a0226210e3A1bAcb93a";
      const encrypted = `${JSON.stringify(authData)}::::${secretKey}`;
      localStorage.setItem("zkpay_auth", encrypted);
      authManager = await AuthManager.create(mockApiClient, mockSigner);
      expect(authManager.getAuthToken()).toBe("persisted-token");
    });
  });
});
