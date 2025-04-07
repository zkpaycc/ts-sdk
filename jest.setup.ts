import { webcrypto } from "crypto";

// Polyfill window for isBrowser() and location.origin
global.window = {
  location: { origin: "https://testapp.com" },
} as any;

// Ensure crypto is available (Node.js provides webcrypto)
global.crypto = webcrypto as any;
