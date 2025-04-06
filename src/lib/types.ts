import { Chain, Address } from "viem";
import { Transaction } from "@zkpay/core";
import { Signer } from "ethers";

export interface MerchantConfigs {
  merchantAddress: Address;
  redirectUrl?: string;
  webhookUrl?: string;
  timeout?: number;
  signer?: Signer;
}

export interface PaymentParams {
  chain: Chain;
  currency?: string;
  tokenAddress?: Address;
  amount: string;
  metadata?: Record<string, unknown>;
}

export interface Auth {
  token: string;
  expiredAt: number;
}

export interface GetChannelQuery {
  targetAddress?: Address;
  page?: number;
  limit?: number;
}

export interface PaymentResponse {
  id: string;
  url: string;
}

export interface AuthResponse {
  token: string;
  expiresIn: number;
}

export interface PaymentDetails {
  id: string;
  chainId: number;
  targetAddress: Address;
  tokenAddress?: Address;
  amount: string;
  humanReadableAmount: string;
  status: string;
  redirectUrl: string;
  transactions: Transaction[];
  [key: string]: unknown;
}

export interface PaymentsResponse {
  items: PaymentDetails[];
  meta: {
    totalItems: number;
    itemCount: number;
    itemsPerPage: number;
    totalPages: number;
    currentPage: number;
  };
}

export interface ApiErrorResponse {
  message?: string;
  [key: string]: unknown;
}
