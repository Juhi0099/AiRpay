import { useEffect, useRef, useState } from "react";
import { X, Camera, CheckCircle2, AlertTriangle } from "lucide-react";
import { Html5QrcodeScanner } from "html5-qrcode";
import { verifyVoucherLocally } from "../utils/eip712Signer";
import { saveVoucher } from "../utils/indexedDB";
export default function ScannerModal({ onClose, merchantAddress, onAccepted }) {
  const [result,setResult]=useState(null),[manual,setManual]=useState(""),[error,setError]=useState("");
  const scannerRef=useRef(null);
  async function handlePayload(raw){
    if(result)return;
    try {
      const parsed=JSON.parse(raw);
      if(parsed.v!==1)throw new Error("Unsupported voucher format.");
      if(merchantAddress && parsed.merchant.toLowerCase()!==merchantAddress.toLowerCase())throw new Error("Voucher is for a different merchant.");
      const verified=verifyVoucherLocally(parsed);
      if(!verified.valid)throw new Error(verified.reason);
      const record=await saveVoucher({...parsed,id:`${parsed.payer}-${parsed.nonce}`,role:"merchant",status:"pending",verifiedOffline:true});
      const accepted={...record,verification:verified,receiptId:`NS-${String(parsed.nonce).slice(-6)}`};
      setResult(accepted);onAccepted?.(accepted);
    } catch(e){setError(e.message||"Invalid QR payload");}
  }
  useEffect(()=>{
    if(result)return;
    try {
      const scanner=new Html5QrcodeScanner("nosignal-qr-reader",{fps:8,qrbox:{width:230,height:230},rememberLastUsedCamera:true},false);
      scannerRef.current=scanner;scanner.render(text=>{handlePayload(text)},()=>{});
      return ()=>{scanner.clear().catch(()=>{});scannerRef.current=null};
    } catch(e){setError("Camera unavailable. Paste the voucher payload below.");}
  },[result]);
  return <div className="modal-backdrop" onClick={onClose}><section className="modal scanner-modal" onClick={e=>e.stopPropagation()}>
    <button className="modal-close" onClick={onClose}><X size={18}/></button><div className="modal-icon"><Camera/></div><h2>Receive offline payment</h2><p className="muted">Scan the buyer's signed QR voucher. Signature validation runs on this device.</p>
    {result?<div className="receipt"><div className="receipt-check"><CheckCircle2 size={34}/></div><h3>ACCEPTED OFFLINE</h3><p className="muted">Signature valid · settlement pending</p><div className="receipt-amount">{(Number(result.amount)/1e18).toFixed(5)} <small>MON</small></div><div className="receipt-row"><span>Receipt</span><b>{result.receiptId}</b></div><div className="receipt-row"><span>Status</span><b className="pending-label">Pending sync</b></div><button className="primary-button full" onClick={onClose}>Done</button><p className="tiny muted">This receipt is not a guarantee of funds or final settlement.</p></div>:
    <><div id="nosignal-qr-reader" className="qr-reader"/><div className="divider-label">OR PASTE PAYLOAD</div><textarea value={manual} onChange={e=>setManual(e.target.value)} placeholder="Paste signed voucher JSON…" rows="3"/>{error&&<p className="error-text">{error}</p>}<button className="primary-button full" onClick={()=>handlePayload(manual)} disabled={!manual.trim()}>Verify voucher</button></>}
  </section></div>;
}