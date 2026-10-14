import { Wifi, WifiOff, ShieldCheck, Radio } from "lucide-react";
export default function Navbar({ online, simulatedOffline, onToggleOffline, role, setRole }) {
  const offline = !online || simulatedOffline;
  return <header className="topbar">
    <a className="brand" href="#" aria-label="NoSignal home"><span className="brand-mark"><Radio size={19}/></span><span>NoSignal<span className="brand-dot">.</span></span></a>
    <div className="top-actions">
      <span className={`network-pill ${offline ? "offline" : "online"}`}>{offline ? <WifiOff size={14}/> : <Wifi size={14}/>} {offline ? "AIRPLANE MODE" : "ONLINE"}</span>
      <button className="icon-button" title="Toggle simulated offline mode" onClick={onToggleOffline}><ShieldCheck size={17}/></button>
      <div className="role-switch"><button className={role==="buyer"?"selected":""} onClick={()=>setRole("buyer")}>Buyer</button><button className={role==="merchant"?"selected":""} onClick={()=>setRole("merchant")}>Merchant</button></div>
    </div>
  </header>;
}