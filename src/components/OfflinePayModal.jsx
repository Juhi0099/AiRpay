import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { X, Clock3, Copy, CheckCircle2 } from "lucide-react";
import { Contract } from "ethers";
import { createVoucher } from "../utils/eip712Signer";
import { saveVoucher } from "../utils/indexedDB";
import { CHAIN_ID, VAULT_ABI, VAULT_ADDRESS } from "../utils/constants";
export default function OfflinePayModal({ onClose, wallet, merchantAddress, onQueued }) {
  const [amount, setAmount] = useState("0.002");
  const [voucher, setVoucher] = useState(null);
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(120);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!voucher) return;
    const timer = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [voucher]);

  async function generate(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (!merchantAddress) throw new Error("Merchant receiving address is missing.");
      const parsedAmount = Number(amount);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) throw new Error("Enter a valid MON amount.");
      const amountWei = BigInt(Math.round(parsedAmount * 1e18));
      const nonce = BigInt(Date.now());
      const expiry = Math.floor(Date.now() / 1000) + 120;
      if (wallet?.provider) {
        if (!VAULT_ADDRESS) throw new Error("Configure the deployed vault address before reserving funds.");
        const network = await wallet.provider.getNetwork();
        if (Number(network.chainId) !== CHAIN_ID) throw new Error("Switch your wallet to Monad Testnet before creating a reserved voucher.");
        const vault = new Contract(VAULT_ADDRESS, VAULT_ABI, wallet);
        const reservationTx = await vault.reserveVoucher(nonce, amountWei, expiry);
        const reservationReceipt = await reservationTx.wait();
        if (!reservationReceipt || reservationReceipt.status !== 1) {
          throw new Error("Voucher reservation failed. No voucher was created.");
        }
      }
      const signed = await createVoucher({
        wallet,
        merchant: merchantAddress,
        amountWei,
        nonce,
        expiry,
        contractAddress: VAULT_ADDRESS
      });
      const record = await saveVoucher({ ...signed, id: `${signed.payer}-${signed.nonce}`, role: "buyer", status: "pending" });
      setVoucher(record);
      setSeconds(Math.max(0, expiry - Math.floor(Date.now() / 1000)));
      onQueued?.(record);
    } catch (err) {
      setError(err.message || "Could not create voucher");
    } finally {
      setBusy(false);
    }
  }

  const payload = voucher
    ? JSON.stringify({
        v: 1,
        payer: voucher.payer,
        merchant: voucher.merchant,
        amount: voucher.amount,
        nonce: voucher.nonce,
        expiry: voucher.expiry,
        signature: voucher.signature,
      })
    : "";

  return <div className="modal-backdrop" onClick={onClose}><section className="modal pay-modal" onClick={(e) => e.stopPropagation()}>
    <button className="modal-close" onClick={onClose}><X size={18}/></button><div className="modal-icon"><Clock3/></div>
    <h2>Pay without signal</h2><p className="muted">Create a short-lived signed voucher. The merchant must sync it before payment is final.</p>
    {!voucher ? <form onSubmit={generate}><label>Payment amount <span>MON · testnet</span></label><input type="number" min="0.000000001" max="10" step="0.001" value={amount} onChange={(e) => setAmount(e.target.value)} required/>{error && <p className="error-text">{error}</p>}<button className="primary-button full" disabled={busy}>{busy ? "Reserving and signing…" : "Create offline voucher"}</button></form> :
    <div className="voucher-content"><div className="qr-frame"><QRCodeSVG value={payload} size={224} level="M" includeMargin /></div><div className="timer-line"><Clock3 size={15}/> Expires in <b>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</b></div>{seconds === 0 && <p className="error-text">Voucher expired. Close and create a new one.</p>}<p className="success-text"><CheckCircle2 size={15}/> Signed locally · waiting for merchant</p><button className="secondary-button full" onClick={() => navigator.clipboard?.writeText(payload)}><Copy size={15}/> Copy voucher payload</button><p className="tiny muted">QR payload contains a signature, not your private key. Keep the screen visible while the merchant scans.</p></div>}
  </section></div>;
}