import { Address, Chain, createPublicClient, erc20Abi, http } from "viem";

const TOKEN_LIST_URL = "https://gateway.ipfs.io/ipns/tokens.uniswap.org";
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours cache

export type Token = {
  chainId: number;
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
};

type TokenList = {
  name: string;
  timestamp: string;
  version: {
    major: number;
    minor: number;
    patch: number;
  };
  tokens: Token[];
};

let cachedTokenList: TokenList | null = null;
let lastFetchTime = 0;

export const getTokenList = async (): Promise<TokenList> => {
  const now = Date.now();

  // Return cached list if still valid
  if (cachedTokenList && now - lastFetchTime < CACHE_TTL_MS) {
    return cachedTokenList;
  }

  try {
    const response = await fetch(TOKEN_LIST_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch token list: ${response.statusText}`);
    }

    const data = await response.json();
    lastFetchTime = now;
    cachedTokenList = data;
    return data;
  } catch (error) {
    console.error("Token list fetch error:", error);
    // Return cached list even if expired if available
    if (cachedTokenList) {
      console.warn("Using expired token list cache due to fetch error");
      return cachedTokenList;
    }
    throw new Error("Failed to fetch token list and no cache available");
  }
};

export const getTokenByAddress = async (
  chain: Chain,
  address: Address
): Promise<Token> => {
  const tokenList = await getTokenList();
  const token = tokenList.tokens.find(
    (t) =>
      t.chainId === chain.id &&
      t.address.toLowerCase() === address.toLowerCase()
  );

  if (token) {
    return token;
  }

  const client = createPublicClient({
    chain,
    transport: http(),
  });

  const [symbol, decimals, name] = await Promise.all([
    client.readContract({
      address,
      abi: erc20Abi,
      functionName: "symbol",
    }),
    client.readContract({
      address,
      abi: erc20Abi,
      functionName: "decimals",
    }),
    client.readContract({
      address,
      abi: erc20Abi,
      functionName: "name",
    }),
  ]);

  return {
    chainId: chain.id,
    address,
    name: typeof name === "string" ? name : "Unknown Token",
    symbol: typeof symbol === "string" ? symbol : "UNKNOWN",
    decimals: typeof decimals === "number" ? decimals : 18,
  };
};

export const getTokenBySymbol = async (
  chainId: number,
  symbol: string
): Promise<Token | undefined> => {
  const tokenList = await getTokenList();
  return tokenList.tokens.find(
    (t) => t.chainId === chainId && t.symbol === symbol
  );
};
