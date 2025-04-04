import { Merchant } from "./merchant";
import { ApiClient } from "./apiClient";
import { Address, getAddress } from "viem";
import { ValidationError } from "./errors";
import { GetChannelQuery, PaymentParams } from "./types";
import { Signer } from "ethers";
import { MockProxy, mock } from "jest-mock-extended";
import { sepolia } from "viem/chains";

jest.mock("./apiClient");
jest.mock("./utils", () => ({
  extractRequestTokenMetadata: jest.fn(),
}));

describe("Merchant", () => {
  let merchant: Merchant;
  let mockApiClient: jest.Mocked<ApiClient>;
  const mockConfig = {
    merchantAddress: "0xd10A6AE6eBa017FAb5b29fA7f895a61Da64A8f00" as Address,
    timeout: 3000,
  };

  const validParams: PaymentParams = {
    chain: sepolia,
    amount: "100",
  };
  const mockAuthResponse = {
    token: "new-jwt-token",
    expiresIn: 3600,
  };
  const mockSuccessResponse = {
    id: "pay_123",
    url: "https://payment.link/123",
  };
  const mockPaymentDetails = {
    id: "pay_123",
    status: "completed",
    amount: "1000000",
  };
  const mockPaymentDetailsList = [mockPaymentDetails];
  let mockSigner: MockProxy<Signer>;

  beforeEach(() => {
    jest.clearAllMocks();
    merchant = new Merchant(mockConfig);
    mockApiClient = (merchant as any).apiClient as jest.Mocked<ApiClient>;

    // Default mock implementations
    mockApiClient.post.mockImplementation(async (path) => {
      if (path === "/v1/auth") return mockAuthResponse;
      return mockSuccessResponse;
    });
    mockApiClient.get.mockResolvedValue(mockPaymentDetails);
    require("./utils").extractRequestTokenMetadata.mockImplementation(
      (params: PaymentParams) => {
        if (params.currency == "USDT") {
          return {
            decimals: 6,
            address: "0xdefault" as `0x${string}`,
          };
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
    jest.useRealTimers(); // Restore real timers
  });

  describe("constructor", () => {
    it("should throw ValidationError if merchantAddress is missing", () => {
      expect(() => new Merchant({} as any)).toThrow(ValidationError);
    });

    it("should throw ValidationError for invalid merchantAddress format", () => {
      expect(() => new Merchant({ merchantAddress: "0xinvalid" })).toThrow(
        ValidationError
      );
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
      it("should call apiClient.post with correct payload", async () => {
        await merchant.createPayment(validParams);
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

      it("should return payment response on success", async () => {
        const result = await merchant.createPayment(validParams);
        expect(result).toEqual(mockSuccessResponse);
      });
    });

    describe("createPayment with signer", () => {
      beforeEach(() => {
        merchant = new Merchant({
          ...mockConfig,
          signer: mockSigner,
        });
        mockApiClient = (merchant as any).apiClient as jest.Mocked<ApiClient>;
        mockApiClient.post.mockImplementation(async (path) => {
          if (path === "/v1/auth") return mockAuthResponse;
          return mockSuccessResponse;
        });
      });

      describe("auth token does not exist", () => {
        it("should get new auth token before fetching channels", async () => {
          await merchant.createPayment(validParams);

          expect(mockSigner.signMessage).toHaveBeenCalled();
          expect(mockApiClient.post).toHaveBeenCalledWith(
            "/v1/channels",
            expect.objectContaining({
              chainId: validParams.chain.id,
              targetAddress: mockConfig.merchantAddress,
              amount: "100000000000000000000",
            }),
            {
              headers: {
                authorization: "new-jwt-token",
              },
            }
          );
        });
      });

      describe("auth token expired", () => {
        beforeEach(() => {
          merchant.auth = {
            token: "expired-token",
            expiredAt: Date.now() - 1000, // Simulate expired token
          };
        });

        it("should get new auth token and attach to the request", async () => {
          await merchant.createPayment(validParams);

          expect(mockSigner.signMessage).toHaveBeenCalled();
          expect(mockApiClient.post).toHaveBeenCalledWith(
            "/v1/channels",
            expect.objectContaining({
              chainId: validParams.chain.id,
              targetAddress: mockConfig.merchantAddress,
              amount: "100000000000000000000",
            }),
            {
              headers: {
                authorization: "new-jwt-token",
              },
            }
          );
        });
      });

      describe("auth token is valid", () => {
        beforeEach(() => {
          merchant.auth = {
            token: "old-valid-token",
            expiredAt: Date.now() + 1000, // Simulate valid token
          };
        });

        it("reuses token for the request", async () => {
          await merchant.createPayment(validParams);

          expect(mockSigner.signMessage).not.toHaveBeenCalled();
          expect(mockApiClient.post).toHaveBeenCalledWith(
            "/v1/channels",
            expect.objectContaining({
              chainId: validParams.chain.id,
              targetAddress: mockConfig.merchantAddress,
              amount: "100000000000000000000",
            }),
            {
              headers: {
                authorization: "old-valid-token",
              },
            }
          );
        });
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
          expect.any(String),
          expect.objectContaining({ metadata }),
          {}
        );
      });
    });

    describe("invalid parameters", () => {
      it("should throw ValidationError if amount is missing", async () => {
        await expect(
          merchant.createPayment({
            ...validParams,
            amount: undefined as any,
          })
        ).rejects.toThrow(ValidationError);
      });

      it("should throw ValidationError if amount is not numeric", async () => {
        await expect(
          merchant.createPayment({
            ...validParams,
            amount: "not-a-number",
          })
        ).rejects.toThrow(ValidationError);
      });
    });
  });

  describe("getPayment", () => {
    describe("valid payment ID", () => {
      it("should call apiClient.get with correct endpoint", async () => {
        const paymentId = "pay_123";
        await merchant.getPayment(paymentId);
        expect(mockApiClient.get).toHaveBeenCalledWith(
          `/v1/channels/${paymentId}`
        );
      });

      it("should return payment details on success", async () => {
        const result = await merchant.getPayment("pay_123");
        expect(result).toEqual(mockPaymentDetails);
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
      merchant = new Merchant({
        ...mockConfig,
        signer: mockSigner,
      });
      mockApiClient = (merchant as any).apiClient as jest.Mocked<ApiClient>;
      mockApiClient.get.mockResolvedValue(mockPaymentDetailsList);
      mockApiClient.post.mockImplementation(async (path) => {
        if (path === "/v1/auth") return mockAuthResponse;
        return mockSuccessResponse;
      });
    });

    it("should throw ValidationError if signer is not provided", async () => {
      merchant = new Merchant(mockConfig);
      await expect(merchant.queryPayments(query)).rejects.toThrow(
        ValidationError
      );
    });

    describe("auth token does not exist", () => {
      it("should get new auth token before fetching channels", async () => {
        await merchant.queryPayments(query);

        expect(mockApiClient.get).toHaveBeenCalledWith(
          "/v1/channels?targetAddress=0x2b8E0c111c4D661b1A1F7614016f969df80Bc945",
          {
            headers: { authorization: mockAuthResponse.token },
          }
        );
      });
    });

    describe("auth token expired", () => {
      beforeEach(() => {
        merchant.auth = {
          token: "expired-token",
          expiredAt: Date.now() - 1000, // Simulate expired token
        };
      });

      it("should get new auth token before fetching channels", async () => {
        await merchant.queryPayments(query);

        expect(mockApiClient.get).toHaveBeenCalledWith(
          "/v1/channels?targetAddress=0x2b8E0c111c4D661b1A1F7614016f969df80Bc945",
          {
            headers: { authorization: mockAuthResponse.token },
          }
        );
      });
    });

    describe("auth token is valid", () => {
      beforeEach(() => {
        merchant.auth = {
          token: "old-valid-token",
          expiredAt: Date.now() + 1000, // Simulate valid token
        };
      });

      it("reuses token to fetch channels", async () => {
        await merchant.queryPayments(query);

        expect(mockSigner.signMessage).not.toHaveBeenCalled();
        expect(mockApiClient.get).toHaveBeenCalledWith(
          "/v1/channels?targetAddress=0x2b8E0c111c4D661b1A1F7614016f969df80Bc945",
          {
            headers: { authorization: "old-valid-token" },
          }
        );
      });
    });

    it("should return payment details list on success", async () => {
      const result = await merchant.queryPayments(query);
      expect(result).toEqual(mockPaymentDetailsList);
    });
  });
});
