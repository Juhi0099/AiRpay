import { useState } from "react";
import { X, ArrowDownToLine, LoaderCircle } from "lucide-react";
import { BrowserProvider, Contract, parseEther } from "ethers";
import { VAULT_ADDRESS, VAULT_ABI, CHAIN_ID } from "../utils/constants";
export default function DepositModal({ onClose, onDeposited }) {
  const [amount,setAmount]=useState("0.05"),[busy,setBusy]=useState(false),[error,setError]=useState("");
  async function deposit(e) {
    e.preventDefault(); setError("");
    if (!window.ethereum) { setError("A compatible wallet is required for this demo deposit."); return; }
    if (!VAULT_ADDRESS) { setError("Vault contract is not configured. Set VITE_VAULT_ADDRESS."); return; }
    try {
      setBusy(true); const provider=new BrowserProvider(window.ethereum); const net=await provider.getNetwork();
      if(Number(net.chainId)!==CHAIN_ID) throw new Error("Switch your wallet to Monad Testnet (Chain ID 10143).");
      const signer=await provider.getSigner(); const vault=new Contract(VAULT_ADDRESS,VAULT_ABI,signer);
      const tx=await vault.deposit({value:parseEther(amount)}); await tx.wait(); onDeposited?.(amount,tx.hash); onClose();
    } catch(err) { setError(err.shortMessage||err.message||"Deposit failed"); } finally {setBusy(false);}
  }
  return <div className="modal-backdrop" onClick={onClose}><section className="modal" onClick={e=>e.stopPropagation()}>
    <button className="modal-close" onClick={onClose}><X size={18}/></button><div className="modal-icon"><ArrowDownToLine/></div>
    <h2>Top up your vault</h2><p className="muted">Add testnet MON to your NoSignal vault. Testnet funds have no real-world value.</p>
    <form onSubmit={deposit}><label>Amount <span>MON</span></label><input type="number" min="0.001" max="100" step="0.001" value={amount} onChange={e=>setAmount(e.target.value)} required/>
      <div className="quick-amounts">{["0.01","0.05","0.1"].map(v=><button type="button" key={v} onClick={()=>setAmount(v)}>{v} MON</button>)}</div>
      {error&&<p className="error-text">{error}</p>}<button className="primary-button full" disabled={busy}>{busy?<><LoaderCircle className="spin" size={16}/> Confirming…</>:"Deposit to vault"}</button>
    </form>
  </section></div>;
}