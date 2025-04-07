import { AuthManager } from "./authManager";
import { ApiClient } from "./apiClient";
import { Signer } from "ethers";
import { MockProxy, mock } from "jest-mock-extended";

jest.mock("./apiClient");

describe("AuthManager", () => {
  let mockApiClient: jest.Mocked<ApiClient>;
  let mockSigner: MockProxy<Signer>;
  let localStorageMock: Map<string, string>;
  const mockAuthResponse = {
    token: "jwt-token",
    expiresIn: 3600,
  };

  const generateEncryptedAuth = async (
    auth: { token: string; expiredAt: number },
    signer: Signer
  ): Promise<string> => {
    // Create a temporary AuthManager instance
    const tempManager = await AuthManager.create(mockApiClient, signer);
    // Set the auth property directly (since constructor is private, we use reflection or direct assignment)
    (tempManager as any).auth = auth;
    // Call persistAuth and capture the localStorage setItem call
    await (tempManager as any).persistAuth();
    return localStorageMock.get("zkpay_auth") || "";
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

    // Fresh localStorage for each test
    localStorageMock = new Map<string, string>();
    Object.defineProperty(global, "localStorage", {
      value: {
        getItem: jest.fn((key) => localStorageMock.get(key) || null),
        setItem: jest.fn((key, value) => localStorageMock.set(key, value)),
        removeItem: jest.fn((key) => localStorageMock.delete(key)),
      },
      writable: true,
    });
  });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2025-03-28T03:03:03.333Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
    localStorageMock.clear(); // Ensure clean state
  });

  describe("create", () => {
    it("should initialize without signer", async () => {
      const authManager = await AuthManager.create(mockApiClient);
      expect(authManager.getAuthToken()).toBeUndefined();
      expect(localStorage.getItem).not.toHaveBeenCalled();
    });

    it("should initialize with signer and attempt to load persisted auth", async () => {
      const authManager = await AuthManager.create(mockApiClient, mockSigner);
      expect(authManager.getAuthToken()).toBeUndefined();
      expect(localStorage.getItem).toHaveBeenCalledWith("zkpay_auth");
    });
  });

  describe("ensureAuthenticated", () => {
    it("should do nothing if no signer is provided", async () => {
      const authManager = await AuthManager.create(mockApiClient);
      await authManager.ensureAuthenticated();
      expect(mockApiClient.post).not.toHaveBeenCalled();
      expect(authManager.getAuthToken()).toBeUndefined();
    });

    it("should obtain new token if no auth exists with signer", async () => {
      const authManager = await AuthManager.create(mockApiClient, mockSigner);
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
      const encrypted = await generateEncryptedAuth(authData, mockSigner);
      localStorage.setItem("zkpay_auth", encrypted);
      const authManager = await AuthManager.create(mockApiClient, mockSigner);

      await authManager.ensureAuthenticated();
      expect(mockApiClient.post).not.toHaveBeenCalled();
      expect(authManager.getAuthToken()).toBe("valid-token");
    });

    it("should refresh expired persisted token", async () => {
      const authData = { token: "expired-token", expiredAt: Date.now() - 1000 };
      const encrypted = await generateEncryptedAuth(authData, mockSigner);
      localStorage.setItem("zkpay_auth", encrypted);
      const authManager = await AuthManager.create(mockApiClient, mockSigner);

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
      const authManager = await AuthManager.create(mockApiClient, mockSigner);
      const promise1 = authManager.ensureAuthenticated();
      const promise2 = authManager.ensureAuthenticated();
      await Promise.all([promise1, promise2]);
      expect(mockApiClient.post).toHaveBeenCalledTimes(1);
      expect(authManager.getAuthToken()).toBe("jwt-token");
    });

    it("should throw on API authentication failure", async () => {
      mockApiClient.post.mockRejectedValue(new Error("API error"));
      const authManager = await AuthManager.create(mockApiClient, mockSigner);
      await expect(authManager.ensureAuthenticated()).rejects.toThrow(
        "Authentication failed"
      );
      expect(authManager.getAuthToken()).toBeUndefined();
    });

    it("should throw on signer failure", async () => {
      mockSigner.signMessage.mockRejectedValue(new Error("Signing rejected"));
      const authManager = await AuthManager.create(mockApiClient, mockSigner);
      await expect(authManager.ensureAuthenticated()).rejects.toThrow(
        "Authentication failed"
      );
      expect(authManager.getAuthToken()).toBeUndefined();
    });

    it("should clear invalid persisted auth and refresh", async () => {
      localStorage.setItem("zkpay_auth", "invalid-data");
      const authManager = await AuthManager.create(mockApiClient, mockSigner);
      await authManager.ensureAuthenticated();
      expect(localStorage.removeItem).toHaveBeenCalledWith("zkpay_auth");
      expect(mockApiClient.post).toHaveBeenCalledWith(
        "/v1/auth",
        expect.any(Object)
      );
      expect(authManager.getAuthToken()).toBe("jwt-token");
    });

    it("should not persist or load auth outside browser", async () => {
      // Temporarily override global.window for this test only
      const originalWindow = global.window;
      global.window = undefined as any;

      const authManager = await AuthManager.create(mockApiClient, mockSigner);
      await authManager.ensureAuthenticated();
      expect(localStorage.setItem).not.toHaveBeenCalled();
      expect(localStorage.getItem).not.toHaveBeenCalled();
      expect(authManager.getAuthToken()).toBe("jwt-token");

      // Restore window for subsequent tests
      global.window = originalWindow;
    });
  });

  describe("getAuthToken", () => {
    it("should return undefined if no auth exists", async () => {
      const authManager = await AuthManager.create(mockApiClient);
      expect(authManager.getAuthToken()).toBeUndefined();
    });

    it("should return token after successful authentication", async () => {
      const authManager = await AuthManager.create(mockApiClient, mockSigner);
      await authManager.ensureAuthenticated();
      expect(authManager.getAuthToken()).toBe("jwt-token");
    });

    it("should return valid persisted token", async () => {
      const authData = {
        token: "persisted-token",
        expiredAt: Date.now() + 1000,
      };
      const encrypted = await generateEncryptedAuth(authData, mockSigner);
      localStorage.setItem("zkpay_auth", encrypted);

      const authManager = await AuthManager.create(mockApiClient, mockSigner);
      expect(authManager.getAuthToken()).toBe("persisted-token");
    });
  });
});
