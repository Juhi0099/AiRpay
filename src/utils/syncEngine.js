import { BrowserProvider, Contract, JsonRpcProvider, Wallet } from "ethers";
import { MONAD_RPC, VAULT_ADDRESS, VAULT_ABI, CHAIN_ID } from "./constants";
import { getUnsyncedVouchers, markVoucherSettled, markVoucherPending } from "./indexedDB";

let running = false;
let listeners = new Set();
export function subscribeSync(listener) { listeners.add(listener); return () => listeners.delete(listener); }
function publish(state) { listeners.forEach(fn => { try { fn(state); } catch {} }); }

export async function syncPendingVouchers() {
  if (running) return { submitted: 0 };
  if (!navigator.onLine) return { submitted: 0, offline: true };
  const vouchers = await getUnsyncedVouchers();
  if (!vouchers.length) return { submitted: 0 };
  if (!VAULT_ADDRESS) { publish({ state: "needs-config", message: "Set VITE_VAULT_ADDRESS to enable settlement." }); return { submitted: 0, needsConfig: true }; }
  const privateKey = import.meta.env.VITE_RELAYER_PRIVATE_KEY;
  let signer;
  try {
    if (window.ethereum) {
      const provider = new BrowserProvider(window.ethereum);
      const network = await provider.getNetwork();
      if (Number(network.chainId) !== CHAIN_ID) throw new Error("Wallet is not connected to Monad Testnet.");
      signer = await provider.getSigner();
    } else if (privateKey) signer = new Wallet(privateKey, new JsonRpcProvider(MONAD_RPC));
    else throw new Error("Connect a Monad-compatible wallet to settle pending vouchers.");
    running = true; publish({ state: "syncing", count: vouchers.length });
    const contract = new Contract(VAULT_ADDRESS, VAULT_ABI, signer);
    const grouped = [];
    for (let i = 0; i < vouchers.length; i += 50) grouped.push(vouchers.slice(i, i + 50));
    let submitted = 0;
    let rejected = 0;
    const contractAddress = (await contract.getAddress()).toLowerCase();
    for (const group of grouped) {
      const txVouchers = group.map(({ payer, merchant, amount, nonce, expiry, signature }) => ({ payer, merchant, amount, nonce, expiry, signature }));
      try {
        const tx = await contract.batchSettle(txVouchers);
        publish({ state: "confirming", txHash: tx.hash, count: group.length });
        const receipt = await tx.wait();
        if (!receipt || receipt.status !== 1) throw new Error("Settlement transaction reverted.");
        const outcomes = new Map();
        for (const log of receipt.logs) {
          if (log.address.toLowerCase() !== contractAddress) continue;
          const parsed = contract.interface.parseLog(log);
          if (!parsed || (parsed.name !== "VoucherSettled" && parsed.name !== "VoucherRejected")) continue;
          const key = `${parsed.args.payer.toLowerCase()}-${parsed.args.nonce}`;
          if (parsed.name === "VoucherSettled" || outcomes.get(key)?.status !== "settled") {
            outcomes.set(key, parsed.name === "VoucherSettled"
              ? {
                  status: "settled",
                  voucherHash: parsed.args.voucherHash,
                  amount: parsed.args.amount.toString(),
                  payer: parsed.args.payer,
                  merchant: parsed.args.merchant,
                  nonce: parsed.args.nonce.toString(),
                }
              : { status: `rejected (reason ${parsed.args.reason})` });
          }
        }
        const processed = new Set();
        for (const voucher of group) {
          const id = voucher.id || `${voucher.payer}-${voucher.nonce}`;
          const key = `${voucher.payer.toLowerCase()}-${voucher.nonce}`;
          if (processed.has(key)) continue;
          processed.add(key);
          const outcome = outcomes.get(key);
          if (outcome?.status === "settled") {
            await markVoucherSettled(id, tx.hash, {
              ...outcome,
              blockNumber: receipt.blockNumber,
              blockHash: receipt.blockHash,
              transactionIndex: receipt.index,
              gasUsed: receipt.gasUsed.toString(),
            });
            submitted += 1;
          } else {
            const error = outcome?.status || "No settlement outcome event was emitted.";
            await markVoucherPending(id, error);
            rejected += 1;
          }
        }
      } catch (error) {
        for (const voucher of group) {
          await markVoucherPending(voucher.id || `${voucher.payer}-${voucher.nonce}`, error.message || error);
        }
        publish({ state: "error", message: error.message || "Settlement failed" });
      }
    }
    publish({ state: "complete", submitted, rejected }); return { submitted, rejected };
  } finally { running = false; }
}
export function startSyncEngine() {
  const onOnline = () => { syncPendingVouchers().catch(error => publish({ state: "error", message: error.message })); };
  window.addEventListener("online", onOnline);
  if (navigator.onLine) onOnline();
  return () => window.removeEventListener("online", onOnline);
}