export const CHAIN_ID = Number(import.meta.env.VITE_MONAD_CHAIN_ID || 10143);
export const MONAD_RPC = import.meta.env.VITE_MONAD_RPC_URL || "https://testnet-rpc.monad.xyz";
export const DOMAIN_NAME = "NoSignalVault";
export const DOMAIN_VERSION = "1.0.0";
export const VAULT_ADDRESS = import.meta.env.VITE_VAULT_ADDRESS || "";
export const EXPLORER = "https://testnet.monadexplorer.com";
export const VOUCHER_TYPES = {
  Voucher: [
    { name: "payer", type: "address" },
    { name: "merchant", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" }
  ]
};
// ABI fragment intentionally kept in sync with VaultEscrow.sol.
export const VAULT_ABI = [
  "function deposit() payable",
  "function balances(address) view returns (uint256)",
  "function reservedBalance(address) view returns (uint256)",
  "function voucherReservedBalance(address) view returns (uint256)",
  "function voucherReservation(address,uint256) view returns (uint256)",
  "function voucherReservationExpiry(address,uint256) view returns (uint256)",
  "function reserveFunds(uint256 amount)",
  "function releaseReservation(uint256 amount)",
  "function reserveVoucher(uint256 nonce,uint256 amount,uint256 expiry)",
  "function cancelVoucherReservation(uint256 nonce)",
  "function releaseExpiredVoucherReservation(address payer,uint256 nonce)",
  "function nonceUsed(address,uint256) view returns (bool)",
  "function batchSettle((address payer,address merchant,uint256 amount,uint256 nonce,uint256 expiry,bytes signature)[] vouchers)",
  "function withdraw(uint256 amount,address payable to)",
  "event ReservationCreated(address indexed account,uint256 amount)",
  "event ReservationReleased(address indexed account,uint256 amount)",
  "event VoucherReservationCreated(address indexed account,uint256 indexed nonce,uint256 amount,uint256 expiry)",
  "event VoucherReservationReleased(address indexed account,uint256 indexed nonce,uint256 amount)",
  "event VoucherRejected(address indexed payer,address indexed merchant,uint256 amount,uint256 nonce,uint8 reason)",
  "event VoucherSettled(address indexed payer,address indexed merchant,uint256 amount,uint256 nonce,bytes32 indexed voucherHash)"
];