import { verifyMessage, isAddress, Address } from "viem";
import { BASE_API_URL } from "./constants";

// Cache for operator address
let cachedOperatorAddress: Address | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours cache

export const verifySignature = async (
  payload: object,
  signature: string
): Promise<boolean> => {
  try {
    // Get operator address (with caching)
    const operatorAddress = await getOperatorAddress();
    if (!operatorAddress) return false;

    // Verify signature
    const message = JSON.stringify(payload);
    return await verifyMessage({
      address: operatorAddress,
      message,
      signature: signature as `0x${string}`,
    });
  } catch (error) {
    console.error("Signature verification failed:", error);
    return false;
  }
};

export const _resetCacheForTesting = () => {
  cachedOperatorAddress = null;
  lastFetchTime = 0;
};

const getOperatorAddress = async (): Promise<Address | null> => {
  const now = Date.now();

  // Return cached address if still valid
  if (cachedOperatorAddress && now - lastFetchTime < CACHE_TTL_MS) {
    return cachedOperatorAddress;
  }

  try {
    const response = await fetch(BASE_API_URL);
    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }

    const data = await response.json();
    if (!data.operator || !isAddress(data.operator)) {
      throw new Error("Invalid operator address in API response");
    }

    // Update cache
    cachedOperatorAddress = data.operator;
    lastFetchTime = now;
    return cachedOperatorAddress;
  } catch (error) {
    console.error("Failed to fetch operator address:", error);
    return cachedOperatorAddress; // Fallback to cached address if available
  }
};
