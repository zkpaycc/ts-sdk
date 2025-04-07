import { formatUnits, getAddress } from "viem";
import qs from "qs";
import { ApiClient, RequestOptions } from "./apiClient";
import { AuthManager } from "./authManager";
import {
  extractChannelTokenMetadata,
  extractRequestTokenMetadata,
} from "./utils";
import {
  MerchantConfigs,
  PaymentParams,
  PaymentResponse,
  PaymentDetails,
  GetChannelQuery,
  PaymentsResponse,
} from "./types";
import { ValidationError } from "./errors";

export class Merchant {
  private readonly apiClient: ApiClient;
  private readonly config: MerchantConfigs;
  private authManager: AuthManager | undefined;

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

    const authManager = await this.getAuthManager();
    await authManager.ensureAuthenticated();

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

    const options: RequestOptions = {};
    const authToken = authManager.getAuthToken();
    if (authToken) {
      options.headers = { authorization: authToken };
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

  async queryPayments(query: GetChannelQuery = {}): Promise<PaymentsResponse> {
    if (!this.config.signer) {
      throw new ValidationError("Signer is required to perform this action");
    }

    const authManager = await this.getAuthManager();
    await authManager.ensureAuthenticated();

    const queryString = qs.stringify(query, {
      arrayFormat: "indices",
      encode: false,
    });
    try {
      const result = await this.apiClient.get<PaymentsResponse>(
        `/v1/channels?${queryString}`,
        {
          headers: { authorization: authManager.getAuthToken()! },
        }
      );

      // TODO: could be expensive.
      for (const item of result.items) {
        await this.normalize(item);
      }

      return result;
    } catch (error) {
      console.error(`[zkpay/sdk] Failed to query payments:`, error);
      throw error;
    }
  }

  async getPayment(id: string): Promise<PaymentDetails> {
    if (!id) {
      throw new ValidationError("Payment ID is required");
    }

    try {
      const result = await this.apiClient.get<PaymentDetails>(
        `/v1/channels/${id}`
      );
      return await this.normalize(result);
    } catch (error) {
      console.error(`[zkpay/sdk] Failed to fetch payment ${id}:`, error);
      throw error;
    }
  }

  private async getAuthManager(): Promise<AuthManager> {
    if (!this.authManager) {
      this.authManager = await AuthManager.create(
        this.apiClient,
        this.config.signer
      );
    }
    return this.authManager;
  }

  private validatePaymentParams(params: PaymentParams): void {
    if (!params.chain?.id) {
      throw new ValidationError("chain.id is required");
    }
    if (!params.amount) {
      throw new ValidationError("amount is required");
    }

    const rawAmount = parseFloat(params.amount);
    if (isNaN(rawAmount) || rawAmount <= 0) {
      throw new ValidationError(`Invalid amount: ${params.amount}`);
    }
  }

  private async normalize(payment: PaymentDetails): Promise<PaymentDetails> {
    const token = await extractChannelTokenMetadata(payment);
    if (!token) return payment;

    payment.humanReadableAmount = formatUnits(
      BigInt(payment.amount),
      token.decimals
    );
    payment.currency = token.symbol;
    return payment;
  }
}
