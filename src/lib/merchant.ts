import { getAddress } from "viem";
import qs from "qs";
import { ApiClient, RequestOptions } from "./apiClient";
import { extractRequestTokenMetadata } from "./utils";
import {
  MerchantConfigs,
  PaymentParams,
  PaymentResponse,
  PaymentDetails,
  GetChannelQuery,
  AuthResponse,
  Auth,
} from "./types";
import { ValidationError } from "./errors";
import { SiweMessage } from "siwe";

export class Merchant {
  private readonly apiClient: ApiClient;
  private readonly config: MerchantConfigs;
  private refreshingToken: boolean = false;
  auth?: Auth;

  constructor(config: MerchantConfigs) {
    if (!config.merchantAddress) {
      throw new ValidationError("merchantAddress is required");
    }

    try {
      getAddress(config.merchantAddress);
    } catch {
      throw new ValidationError("Invalid merchantAddress format");
    }

    this.config = config;
    this.apiClient = new ApiClient({
      timeout: config.timeout,
    });
  }

  async createPayment(params: PaymentParams): Promise<PaymentResponse> {
    this.validatePaymentParams(params);

    await this.prepareSession();

    const token = await extractRequestTokenMetadata(params);
    const payload = {
      chainId: params.chain.id,
      targetAddress: this.config.merchantAddress,
      amount: (parseFloat(params.amount) * 10 ** token.decimals).toString(),
      tokenAddress: token.address,
      webhookUrl: this.config.webhookUrl,
      redirectUrl: this.config.redirectUrl,
      metadata: params.metadata,
    };

    console.log(`[zkpay/sdk] Creating payment channel with payload:`, payload);

    const options: RequestOptions = {};
    if (this.auth && this.auth.expiredAt > Date.now()) {
      options.headers = { authorization: this.auth.token };
    }

    try {
      return await this.apiClient.post<PaymentResponse>(
        "/v1/channels",
        payload,
        options
      );
    } catch (error) {
      console.error(`[zkpay/sdk] Failed to create payment:`, error);
      throw error;
    }
  }

  async queryPayments(query: GetChannelQuery = {}): Promise<PaymentDetails[]> {
    if (!this.config.signer) {
      throw new ValidationError("Signer is required to perform this action");
    }

    await this.prepareSession();

    try {
      const queryString = qs.stringify(query, {
        arrayFormat: "indices",
        encode: false,
      });
      return await this.apiClient.get<PaymentDetails[]>(
        `/v1/channels?${queryString}`,
        {
          headers: { authorization: this.auth!.token },
        }
      );
    } catch (error) {
      console.error(
        `[zkpay/sdk] Failed to query ${JSON.stringify(query)}:`,
        error
      );
      throw error;
    }
  }

  async getPayment(id: string): Promise<PaymentDetails> {
    if (!id) {
      throw new ValidationError("Payment ID is required");
    }

    try {
      return await this.apiClient.get<PaymentDetails>(`/v1/channels/${id}`);
    } catch (error) {
      console.error(`[zkpay/sdk] Failed to fetch payment ${id}:`, error);
      throw error;
    }
  }

  private async prepareSession(): Promise<void> {
    if (!this.config.signer) {
      return;
    }

    if (this.auth && this.auth.expiredAt > Date.now()) {
      return;
    }

    // Prevent concurrent refresh attempts
    if (this.refreshingToken) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return this.prepareSession(); // Retry after short delay
    }

    this.refreshingToken = true;
    try {
      const signer = this.config.signer;
      let domain = "https://zkpay.cc";
      if (typeof window !== "undefined") {
        domain = window.location.origin;
      }

      const address = await signer.getAddress();

      const message = new SiweMessage({
        version: "1",
        chainId: 1,
        domain: domain.replace(/^https?:\/\//, ""),
        uri: domain,
        address,
        nonce: Math.random().toString(36).substring(2, 15),
        issuedAt: new Date().toISOString(),
      });

      const signature = await signer.signMessage(message.prepareMessage());
      const { token, expiresIn } = await this.apiClient.post<AuthResponse>(
        "/v1/auth",
        { message: message.prepareMessage(), signature }
      );

      const bufferSeconds = 10;
      this.auth = {
        token,
        expiredAt: Date.now() + (expiresIn - bufferSeconds) * 1000,
      };
    } catch (error) {
      this.refreshingToken = false; // Explicitly reset before throwing
      console.error(`[zkpay/sdk] Failed to init session:`, error);
      throw new Error("Authentication failed");
    }
    this.refreshingToken = false; // Normal completion path
  }

  private validatePaymentParams(params: PaymentParams) {
    if (!params.chain) {
      throw new ValidationError("chain is required");
    }
    if (!params.amount) {
      throw new ValidationError("amount is required");
    }

    const rawAmount = parseFloat(params.amount);
    if (isNaN(rawAmount)) {
      throw new ValidationError(`Invalid amount: ${params.amount}`);
    }
    if (rawAmount <= 0) {
      throw new ValidationError("Amount must be greater than 0");
    }
  }
}
