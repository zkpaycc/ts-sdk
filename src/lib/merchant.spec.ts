import { Merchant } from "./merchant";
import { ApiClient } from "./apiClient";
import { Address, getAddress } from "viem";
import { ValidationError } from "./errors";
import { GetChannelQuery, PaymentParams } from "./types";
import { Signer } from "ethers";
import { MockProxy, mock } from "jest-mock-extended";
import { sepolia } from "viem/chains";
import { AuthManager } from "./authManager";

jest.mock("./apiClient");
jest.mock("./authManager");
jest.mock("./utils", () => ({
  extractRequestTokenMetadata: jest.fn(),
  extractChannelTokenMetadata: jest.fn(),
}));

describe("Merchant", () => {
  let merchant: Merchant;
  let mockApiClient: jest.Mocked<ApiClient>;
  let mockAuthManager: jest.Mocked<AuthManager>;
  const mockConfig = {
    merchantAddress: "0xd10A6AE6eBa017FAb5b29fA7f895a61Da64A8f00" as Address,
    timeout: 3000,
  };

  const validParams: PaymentParams = {
    chain: sepolia,
    amount: "100",
  };
  const mockSuccessResponse = {
    id: "pay_123",
    url: "https://payment.link/123",
  };
  const mockPaymentDetails = {
    id: "pay_123",
    chainId: sepolia.id,
    status: "completed",
    amount: "1000000",
    transactions: [
      {
        amount: "1000000",
        token: {
          address: undefined,
        },
      },
    ],
  };
  const mockQueryPaymentsResponse = {
    items: [mockPaymentDetails],
    meta: {
      totalItems: 1,
      itemCount: 1,
      itemsPerPage: 20,
      totalPages: 1,
      currentPage: 1,
    },
  };
  let mockSigner: MockProxy<Signer>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockApiClient = mock<ApiClient>();
    mockAuthManager = mock<AuthManager>();
    mockAuthManager.ensureAuthenticated.mockResolvedValue();
    mockAuthManager.getAuthToken.mockReturnValue(undefined); // Default no token

    // Manually instantiate Merchant with mocked dependencies
    merchant = new Merchant(mockConfig);
    (merchant as any).apiClient = mockApiClient;
    (merchant as any).authManager = mockAuthManager;

    // Default mock implementations
    mockApiClient.post.mockResolvedValue(mockSuccessResponse);
    mockApiClient.get.mockResolvedValue(mockPaymentDetails);
    require("./utils").extractRequestTokenMetadata.mockImplementation(
      (params: PaymentParams) => {
        if (params.currency === "USDT") {
          return {
            decimals: 6,
            address: "0xdefault" as `0x${string}`,
          };
        }
        return { decimals: 18 };
      }
    );
    require("./utils").extractChannelTokenMetadata.mockImplementation(
      (channel: { chainId: number; tokenAddress?: Address }) => {
        if (channel.tokenAddress) {
          return { decimals: 6, address: channel.tokenAddress };
        }
        return { decimals: 18 };
      }
    );
    mockSigner = mock<Signer>();
    mockSigner.signMessage.mockResolvedValue("mock-signature");
    mockSigner.getAddress.mockResolvedValue(
      "0xc375317f8403Cb633de95a0226210e3A1bAcb93a"
    );
  });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2025-03-28T03:03:03.333Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("constructor", () => {
    it("should throw ValidationError if merchantAddress is missing", () => {
      expect(() => new Merchant({} as any)).toThrow(ValidationError);
    });

    it("should throw ValidationError for invalid merchantAddress format", () => {
      expect(
        () => new Merchant({ merchantAddress: "0xinvalid" } as any)
      ).toThrow(ValidationError);
    });

    it("should initialize with valid config", () => {
      expect(() => new Merchant(mockConfig)).not.toThrow();
      expect(getAddress(mockConfig.merchantAddress)).toBe(
        mockConfig.merchantAddress
      );
    });
  });

  describe("createPayment", () => {
    describe("valid parameters", () => {
      it("should call apiClient.post with correct payload without auth", async () => {
        await merchant.createPayment(validParams);
        expect(mockAuthManager.ensureAuthenticated).toHaveBeenCalled();
        expect(mockApiClient.post).toHaveBeenCalledWith(
          "/v1/channels",
          expect.objectContaining({
            chainId: validParams.chain.id,
            targetAddress: mockConfig.merchantAddress,
            amount: "100000000000000000000",
          }),
          {}
        );
      });

      it("should include auth token in headers if present", async () => {
        mockAuthManager.getAuthToken.mockReturnValue("jwt-token");
        await merchant.createPayment(validParams);
        expect(mockApiClient.post).toHaveBeenCalledWith(
          "/v1/channels",
          expect.any(Object),
          { headers: { authorization: "jwt-token" } }
        );
      });

      it("should return payment response on success", async () => {
        const result = await merchant.createPayment(validParams);
        expect(result).toEqual(mockSuccessResponse);
      });
    });

    describe("different token decimals", () => {
      beforeEach(() => {
        validParams.currency = "USDT";
      });

      it("should convert amount to token decimals", async () => {
        await merchant.createPayment({ ...validParams, amount: "1.5" });
        expect(mockApiClient.post).toHaveBeenCalledWith(
          "/v1/channels",
          expect.objectContaining({
            chainId: validParams.chain.id,
            targetAddress: mockConfig.merchantAddress,
            amount: "1500000",
          }),
          {}
        );
      });
    });

    describe("with metadata", () => {
      it("should include optional metadata in payload", async () => {
        const metadata = { orderId: "123" };
        await merchant.createPayment({ ...validParams, metadata });
        expect(mockApiClient.post).toHaveBeenCalledWith(
          "/v1/channels",
          expect.objectContaining({ metadata }),
          {}
        );
      });
    });

    describe("invalid parameters", () => {
      it("should throw ValidationError if amount is missing", async () => {
        await expect(
          merchant.createPayment({ ...validParams, amount: undefined as any })
        ).rejects.toThrow(ValidationError);
      });

      it("should throw ValidationError if amount is not numeric", async () => {
        await expect(
          merchant.createPayment({ ...validParams, amount: "not-a-number" })
        ).rejects.toThrow(ValidationError);
      });
    });
  });

  describe("getPayment", () => {
    describe("valid payment ID", () => {
      it("should return payment details on success", async () => {
        const result = await merchant.getPayment("pay_123");
        expect(result).toEqual(mockPaymentDetails);
        expect(result.humanReadableAmount).toEqual("0.000000000001");
        expect(result.transactions[0].humanReadableAmount).toEqual(
          "0.000000000001"
        );
      });
    });

    describe("invalid payment ID", () => {
      it("should throw ValidationError if payment ID is empty", async () => {
        await expect(merchant.getPayment("")).rejects.toThrow(ValidationError);
      });
    });

    describe("when API fails", () => {
      const mockError = new Error("Not found");

      beforeEach(() => {
        mockApiClient.get.mockRejectedValue(mockError);
      });

      it("should propagate API errors", async () => {
        await expect(merchant.getPayment("pay_123")).rejects.toThrow(mockError);
      });
    });
  });

  describe("queryPayments", () => {
    const query: GetChannelQuery = {
      targetAddress: "0x2b8E0c111c4D661b1A1F7614016f969df80Bc945",
    };

    beforeEach(() => {
      merchant = new Merchant({ ...mockConfig, signer: mockSigner });
      (merchant as any).apiClient = mockApiClient;
      (merchant as any).authManager = mockAuthManager;
      mockApiClient.get.mockResolvedValue(mockQueryPaymentsResponse);
    });

    it("should throw ValidationError if signer is not provided", async () => {
      merchant = new Merchant(mockConfig);
      (merchant as any).apiClient = mockApiClient;
      (merchant as any).authManager = mockAuthManager;
      await expect(merchant.queryPayments(query)).rejects.toThrow(
        ValidationError
      );
    });

    it("should call ensureAuthenticated", async () => {
      await merchant.queryPayments(query);

      expect(mockAuthManager.ensureAuthenticated).toHaveBeenCalled();
    });

    it("should call apiClient.get with auth token", async () => {
      mockAuthManager.getAuthToken.mockReturnValue("jwt-token");
      await merchant.queryPayments(query);
      expect(mockAuthManager.ensureAuthenticated).toHaveBeenCalled();
      expect(mockApiClient.get).toHaveBeenCalledWith(
        "/v1/channels?targetAddress=0x2b8E0c111c4D661b1A1F7614016f969df80Bc945",
        { headers: { authorization: "jwt-token" } }
      );
    });

    it("should return payment details list on success", async () => {
      mockAuthManager.getAuthToken.mockReturnValue("jwt-token");
      const result = await merchant.queryPayments(query);
      expect(result).toEqual(mockQueryPaymentsResponse);
      expect(result.items[0].humanReadableAmount).toEqual("0.000000000001");
      expect(result.items[0].transactions[0].humanReadableAmount).toEqual(
        "0.000000000001"
      );
    });
  });
});
