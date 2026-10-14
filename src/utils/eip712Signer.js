import { Wallet, verifyTypedData, getAddress } from "ethers";
import { DOMAIN_NAME, DOMAIN_VERSION, CHAIN_ID, VAULT_ADDRESS, VOUCHER_TYPES } from "./constants";

export function domainFor(contractAddress = VAULT_ADDRESS) {
  if (!contractAddress) throw new Error("Configure VITE_VAULT_ADDRESS before signing production vouchers.");
  return { name: DOMAIN_NAME, version: DOMAIN_VERSION, chainId: CHAIN_ID, verifyingContract: getAddress(contractAddress) };
}

/** Signs locally; this function does not make any RPC requests. Keep private keys out of production browser storage. */
export async function createVoucher({ wallet, merchant, amountWei, nonce, expiry, contractAddress }) {
  if (!wallet || typeof wallet.signTypedData !== "function") throw new Error("A compatible local signer is required.");
  const value = {
    payer: getAddress(await wallet.getAddress()),
    merchant: getAddress(merchant),
    amount: BigInt(amountWei).toString(),
    nonce: BigInt(nonce).toString(),
    expiry: BigInt(expiry).toString()
  };
  if (value.payer === value.merchant || BigInt(value.amount) <= 0n) throw new Error("Invalid voucher participants or amount.");
  const signature = await wallet.signTypedData(domainFor(contractAddress), VOUCHER_TYPES, value);
  return { ...value, signature, createdAt: Date.now(), status: "pending" };
}

export function verifyVoucherLocally(voucher, { contractAddress = VAULT_ADDRESS, now = Math.floor(Date.now()/1000) } = {}) {
  try {
    if (!voucher?.signature || BigInt(voucher.expiry) < BigInt(now) || BigInt(voucher.amount) <= 0n) return { valid: false, reason: "Expired or malformed voucher" };
    const domain = domainFor(contractAddress);
    const value = { payer: getAddress(voucher.payer), merchant: getAddress(voucher.merchant), amount: BigInt(voucher.amount), nonce: BigInt(voucher.nonce), expiry: BigInt(voucher.expiry) };
    const recovered = verifyTypedData(domain, VOUCHER_TYPES, value, voucher.signature);
    return recovered.toLowerCase() === value.payer.toLowerCase()
      ? { valid: true, payer: recovered, amount: value.amount.toString(), nonce: value.nonce.toString(), expiry: value.expiry.toString() }
      : { valid: false, reason: "Signature does not match payer" };
  } catch (error) { return { valid: false, reason: error.message || "Invalid voucher" }; }
}

/** Demo-only identity. In production replace with passkey-backed signer / secure wallet SDK. */
export function createDemoWallet() {
  return Wallet.createRandom();
}

export function createDemoMerchantWallet() {
  return Wallet.createRandom();
}
