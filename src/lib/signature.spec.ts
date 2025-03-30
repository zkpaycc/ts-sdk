import { _resetCacheForTesting, verifySignature } from "./signature";
import { verifyMessage } from "viem";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock viem with proper ordering
jest.mock("viem", () => {
  const originalViem = jest.requireActual("viem");
  return {
    ...originalViem,
    verifyMessage: jest.fn().mockImplementation(originalViem.verifyMessage),
  };
});

// Get the mocked verifyMessage after jest.mock
const mockVerifyMessage = jest.mocked(verifyMessage);

describe("verifySignature", () => {
  const mockOperator = "0xd10A6AE6eBa017FAb5b29fA7f895a61Da64A8f00";
  const mockPayload = { amount: "100", currency: "USDT" };
  const validSignature =
    "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

  beforeEach(() => {
    jest.clearAllMocks();
    _resetCacheForTesting();

    mockVerifyMessage.mockResolvedValue(true);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ operator: mockOperator }),
    });
  });

  it("returns true for valid signature", async () => {
    const result = await verifySignature(mockPayload, validSignature);
    expect(result).toBe(true);
    expect(mockVerifyMessage).toHaveBeenCalledWith({
      address: mockOperator,
      message: JSON.stringify(mockPayload, Object.keys(mockPayload).sort()),
      signature: validSignature,
    });
  });

  it("caches the operator address and only fetch once", async () => {
    // First call - should fetch from API
    const result1 = await verifySignature(mockPayload, validSignature);
    expect(result1).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Second call - should use cache
    const result2 = await verifySignature(mockPayload, validSignature);
    expect(result2).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1); // Still only 1 call

    // Verify mockVerifyMessage was called twice (once per verifySignature call)
    expect(mockVerifyMessage).toHaveBeenCalledTimes(2);
  });

  it("returns false when API returns invalid operator address", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ operator: "invalid-address" }),
    });

    const result = await verifySignature(mockPayload, validSignature);
    expect(result).toBe(false);
  });

  it("uses cached address when API fails", async () => {
    // First successful call to populate cache
    await verifySignature(mockPayload, validSignature);

    // Second call with API failure
    mockFetch.mockRejectedValue(new Error("API down"));
    const result = await verifySignature(mockPayload, validSignature);
    expect(result).toBe(true); // Should use cached address
  });

  it("returns false when verifyMessage throws error", async () => {
    mockVerifyMessage.mockRejectedValueOnce(new Error("Verification failed"));
    const result = await verifySignature(mockPayload, validSignature);
    expect(result).toBe(false);
  });
});
