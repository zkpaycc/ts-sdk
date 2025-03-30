import { getAddress } from "viem";
import { ApiClient, RequestOptions } from "./apiClient";
import { extractRequestTokenMetadata } from "./utils";
import {
  MerchantConfigs,
  PaymentParams,
  PaymentResponse,
  PaymentDetails,
  GetChannelQuery,
} from "./types";
import { ValidationError } from "./errors";

export class Merchant {
  private readonly apiClient: ApiClient;
  private readonly config: MerchantConfigs;

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

    const { payload, signature } = await this.prepareRequest(params);

    console.log(
      `[zkpay/sdk] Creating payment channel with payload:`,
      payload,
      signature
    );

    const options: RequestOptions = {};
    if (signature) {
      options.headers = { signature };
    }

    try {
      return await this.apiClient.post<PaymentResponse>(
        "/v1/public/channels",
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

    const base64Query = Buffer.from(
      JSON.stringify({ query, expiredAt: Date.now() + 20_000 })
    ).toString("base64");
    const signature = await this.config.signer.signMessage(base64Query);

    try {
      return await this.apiClient.get<PaymentDetails[]>(
        `/v1/public/channels?query=${base64Query}`,
        {
          headers: { signature },
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
      return await this.apiClient.get<PaymentDetails>(
        `/v1/public/channels/${id}`
      );
    } catch (error) {
      console.error(`[zkpay/sdk] Failed to fetch payment ${id}:`, error);
      throw error;
    }
  }

  private async prepareRequest(params: PaymentParams): Promise<{
    payload: object;
    signature?: string;
  }> {
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

    if (!this.config.signer) return { payload };

    const rawPayload = { payload, expiredAt: Date.now() + 20_000 };
    const base64Payload = Buffer.from(JSON.stringify(rawPayload)).toString(
      "base64"
    );
    const signature = await this.config.signer.signMessage(base64Payload);
    return { payload: { payload: base64Payload }, signature };
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
