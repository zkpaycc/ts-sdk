import * as chains from "viem/chains";
import { Address, Chain } from "viem";
import { PaymentParams } from "./types";
import { ValidationError } from "./errors";
import { getTokenByAddress, getTokenBySymbol } from "./token/token";

export const extractRequestTokenMetadata = async (
  params: PaymentParams
): Promise<{ decimals: number; address?: string }> => {
  const { currency, tokenAddress, chain } = params;

  if (currency && tokenAddress) {
    throw new ValidationError(`Only set either currency or tokenAddress`);
  } else if (currency) {
    if (currency === chain.nativeCurrency.symbol) {
      return chain.nativeCurrency;
    }

    const token = await getTokenBySymbol(chain.id, currency);

    if (!token) {
      throw new ValidationError(
        `Currency ${currency} is not supported on chain ${chain.name}. Please specify 'tokenAddress' instead.`
      );
    }
    return token;
  } else if (tokenAddress) {
    try {
      return await getTokenByAddress(chain, tokenAddress);
    } catch (error) {
      throw new ValidationError(
        `Failed to fetch token details for address ${tokenAddress}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return chain.nativeCurrency;
};

export const arrayBufferToHex = (buffer: ArrayBuffer): string => {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

export const hexToUint8Array = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
};

const isChain = (value: unknown): value is Chain => {
  return (
    value != null &&
    typeof value === "object" &&
    "id" in value &&
    typeof (value as Chain).id === "number" &&
    "name" in value &&
    typeof (value as Chain).name === "string" &&
    "nativeCurrency" in value &&
    "rpcUrls" in value
  );
};

export const chainMap = new Map<number, Chain>(
  Object.entries(chains)
    .filter(([, value]) => isChain(value))
    .map(([, value]) => [value.id, value])
);

export const extractChannelTokenMetadata = async (channel: {
  chainId: number;
  tokenAddress?: Address;
}): Promise<
  { decimals: number; symbol: string; address?: string } | undefined
> => {
  const chain = chainMap.get(channel.chainId);
  if (!chain) return undefined;

  if (channel.tokenAddress) {
    return await getTokenByAddress(chain, channel.tokenAddress);
  }

  return chain.nativeCurrency;
};
