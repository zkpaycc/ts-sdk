import { extractRequestTokenMetadata } from "./utils";
import { ValidationError } from "./errors";
import { getTokenByAddress, getTokenBySymbol } from "./token/token";
import { mainnet } from "viem/chains";
import { PaymentParams } from "./types";
import { Address } from "viem";

jest.mock("./token/token", () => ({
  getTokenBySymbol: jest.fn(),
  getTokenByAddress: jest.fn(),
}));

describe("extractRequestTokenMetadata", () => {
  const mockChain = {
    ...mainnet,
    nativeCurrency: {
      decimals: 18,
      symbol: "ETH",
      name: "Ether",
    },
  };

  const mockToken = {
    decimals: 6,
    address: "0xdAC17F958D2ee523a2206206994597C13D831ec7" as Address,
  };

  let params: PaymentParams;

  beforeEach(() => {
    jest.clearAllMocks();

    params = {
      chain: mockChain,
      currency: "USDT",
      amount: "1000000",
    };
    (getTokenBySymbol as jest.Mock).mockResolvedValue(mockToken);
    (getTokenByAddress as jest.Mock).mockResolvedValue(mockToken);
  });

  describe("currency is provided", () => {
    describe("currency matches native token symbol", () => {
      beforeEach(() => {
        params.currency = "ETH";
      });

      it("returns native token metadata", async () => {
        const result = await extractRequestTokenMetadata(params);

        expect(result).toEqual(mockChain.nativeCurrency);
        expect(getTokenBySymbol).not.toHaveBeenCalled();
      });
    });

    it("returns token metadata for valid currency", async () => {
      const result = await extractRequestTokenMetadata(params);

      expect(result).toEqual(mockToken);
      expect(getTokenBySymbol).toHaveBeenCalledWith(mockChain.id, "USDT");
    });

    it("throws ValidationError for unsupported currency", async () => {
      (getTokenBySymbol as jest.Mock).mockResolvedValue(null);

      await expect(extractRequestTokenMetadata(params)).rejects.toThrow(
        ValidationError
      );
    });
  });

  describe("tokenAddress is provided", () => {
    beforeEach(() => {
      params.currency = undefined;
      params.tokenAddress = mockToken.address;
    });

    it("returns token metadata for valid address", async () => {
      const result = await extractRequestTokenMetadata(params);

      expect(result).toEqual(mockToken);
      expect(getTokenByAddress).toHaveBeenCalledWith(
        mockChain,
        mockToken.address
      );
    });

    it("throws ValidationError when token lookup fails", async () => {
      const mockError = new Error("Token not found");
      (getTokenByAddress as jest.Mock).mockRejectedValue(mockError);

      await expect(extractRequestTokenMetadata(params)).rejects.toThrow(
        ValidationError
      );
    });
  });

  describe("neither currency nor tokenAddress is provided", () => {
    beforeEach(() => {
      params.currency = undefined;
      params.tokenAddress = undefined;
    });

    it("returns native currency metadata", async () => {
      const result = await extractRequestTokenMetadata(params);

      expect(result).toEqual(mockChain.nativeCurrency);
    });
  });

  describe("both currency and tokenAddress are provided", () => {
    beforeEach(() => {
      params.currency = "USDT";
      params.tokenAddress = mockToken.address;
    });

    it("throws ValidationError", async () => {
      await expect(extractRequestTokenMetadata(params)).rejects.toThrow(
        ValidationError
      );
    });
  });
});
