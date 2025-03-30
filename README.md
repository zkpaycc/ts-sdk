# zkpay Merchant SDK

## Overview

The **Merchant SDK** is a lightweight TypeScript library designed for seamless integration with the zkpay payment gateway. It provides an intuitive API for merchants to initiate and manage payment transactions efficiently.

## Features

- Initiate payment requests with configurable parameters
- Associate payments with a signer for enhanced traceability
- Interact with the payment vault to compute payment address and manage fund on your own
- Validate webhook signatures

## Installation

```sh
npm install @zkpay/sdk
```

or

```sh
yarn add @zkpay/sdk
```

## Usage

### Initialization

```typescript
import { Merchant, chains } from "@zkpay/sdk";

// const signer = new ethers.Wallet(privateKey, provider);
const merchant = new Merchant({
  merchantAddress: "0xYourMerchantAddress",
  redirectUrl: "https://yourdomain.com/webhook",
  webhookUrl: "https://yourdomain.com/order/ZKPAY-ID-PLACEHOLDER/success",
  signer: signer, // Optional: Enables payment association and querying
});
```

### Creating a Payment

```typescript
const payment = await merchant.createPayment({
  chain: chains.sepolia,
  currency: "ETH",
  amount: "0.01",
  metadata: {
    referenceId: "ORDER#1233456",
  },
});

console.log("Payment URL:", payment.url);
```

#### Payment Association with Signer

If a signer is specified during `Merchant` initialization, the payment will be linked to the signer, facilitating later retrieval.

### Querying Payments

Retrieve previously created payments associated with the signer:

```typescript
const payments = await merchant.queryPayments();

console.log("Retrieved Payments:", payments);
```

### Retrieving Payment Details

```typescript
const paymentDetails = await merchant.getPayment(payment.id);
console.log("Payment Status:", paymentDetails.status);
```

### Vault Operations

#### Computing Vault Address

```typescript
// This function is publicly accessible; any party willing to cover the gas fees may invoke it.
const wallet = new ethers.Wallet(privateKey, provider);
const vault = new Vault(wallet);

const address = await vault.computeAddress(
  "6oyWE4vmosa6kmdP2aGvcnckH8KKQbqatxf5enrhfF8tY1K" // payment.id
);
```

#### Sweeping Funds from Vault

```typescript
const tx = await vault.sweep({
  id: "6oyWE4vmosa6kmdP2aGvcnckH8KKQbqatxf5enrhfF8tY1K", // payment.id
  tokens: ["0xdAC17F958D2ee523a2206206994597C13D831ec7"], // ERC-20 tokens to transfer; leave empty to process only the native token
});
```

### Webhook Signature Verification

```typescript
const result = await verifySignature(payload, signature);
```

## Contribution

Contributions are welcome. Please submit issues or pull requests to enhance the SDK.

## License

This project is licensed under the MIT License.
