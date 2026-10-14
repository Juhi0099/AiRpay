# NoSignal — Monad offline-first payment PWA

A hackathon prototype for offline voucher authorization and later batch settlement on Monad Testnet.

## Important security and demo notes

- This is a hackathon prototype, **not production-ready financial infrastructure**. Offline signature acceptance is not proof of funds or final settlement.
- The browser demo signer persists a private key in `sessionStorage` so that refreshes during a demo work. Do not use this for real money. Replace it with a reviewed wallet/passkey signing provider and a server-side/managed relayer.
- This sample uses native testnet MON in the vault, not USDC. It displays MON and marks balances as testnet-only; it does not imply a USD conversion.
- A connected payer reserves each voucher amount onchain by nonce before it is signed. Settlement consumes only that voucher's own reservation; unreserved vouchers can use only the remaining unreserved balance. Reservations cannot be withdrawn, reassigned to another voucher, or released while the voucher is live; expired reservations can be released by anyone.
- Offline double-spend cannot be prevented by an offline merchant without trusted hardware/secure counters, shared connectivity, or accepting credit risk. The contract prevents a voucher nonce from settling twice onchain.
- The QR uses one static voucher payload that expires quickly. `qrcode.react` renders it; animated chunked QR and NFC transport are extension points, not implemented here.
- Auto-sync submits vouchers only when a wallet is available in the browser or `VITE_RELAYER_PRIVATE_KEY` is configured. Never expose a relayer private key in a deployed frontend. Use a backend relayer in production.
- Settled activity includes the emitted voucher hash, block information, transaction hash, and a link to the Monad Testnet Explorer.
- The `verifyVoucherLocally` helper uses the same EIP-712 domain as the contract. Configure the deployed contract address before issuing vouchers.

## Requirements

- Node.js 20+
- Foundry (for contract build/deploy)
- Monad Testnet wallet with testnet MON for deployment and testing

## Run the frontend

```bash
npm install
cp .env.example .env
# set VITE_VAULT_ADDRESS after deployment
npm run dev
```

The UI can be explored without a contract address, but funded voucher creation requires a connected Monad wallet and deployed vault address so the amount can be reserved before signing. Demo-only local vouchers skip this reservation and are not guaranteed to settle. Browser camera access requires localhost or HTTPS.

## Build the contract

```bash
forge install OpenZeppelin/openzeppelin-contracts
forge build
```

Run the focused contract accounting tests with `npm run test:contract`; compile and regenerate the deployment artifact with `npm run compile:contract`.

Deploy `VaultEscrow` to Monad Testnet with Foundry using RPC `https://testnet-rpc.monad.xyz` and chain ID `10143`. Fund the vault with testnet MON by calling `deposit()` from payer accounts.

## Environment variables

See `.env.example`. A `VITE_` variable is public to every browser user. **Do not put secrets in `VITE_*` variables in a production deployment.** The relayer key option exists only for local demos and should be replaced by a backend service.

## Suggested next steps before a live demo

1. Deploy and verify the contract; configure `VITE_VAULT_ADDRESS`.
2. Use two separate browser profiles for buyer and merchant. This UI creates separate demo identities within one profile, so a real offline transfer flow is best tested with separate devices/profiles.
3. Top up the buyer vault, generate a voucher for the merchant address, scan it on the merchant device, and reconnect.
4. Add relayer-side handling for per-voucher settlement and expired reservation cleanup.
5. Add a backend relayer, receipt indexing, rate limits, key custody, and a reviewed ERC-20 USDC vault before any real-value deployment.
