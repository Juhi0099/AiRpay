import { ArrowDownLeft, ArrowUpRight, Clock3, CheckCircle2, AlertCircle } from "lucide-react";
export default function TransactionList({ transactions=[] }) {
  if(!transactions.length)return <div className="empty-state"><div className="empty-icon"><Clock3/></div><b>No transactions yet</b><p>Your payments and offline vouchers will show up here.</p></div>;
  return <div className="transaction-list">{[...transactions].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).map((tx,i)=>{
    const settled=tx.status==="settled",failed=tx.status==="failed",incoming=tx.role==="merchant";
    return <div className="transaction-row" key={tx.id||i}><div className={`tx-icon ${incoming?"incoming":""}`}>{incoming?<ArrowDownLeft size={17}/>:<ArrowUpRight size={17}/>}</div><div className="tx-main"><b>{incoming?"Offline payment received":"Offline payment voucher"}</b><span>{new Date(tx.createdAt||Date.now()).toLocaleString()}</span></div><div className="tx-right"><b>{incoming?"+":"−"}{(Number(tx.amount||0)/1e18).toFixed(4)} MON</b><span className={settled?"status-settled":failed?"status-failed":"status-pending"}>{settled?<CheckCircle2 size={12}/>:failed?<AlertCircle size={12}/>:<Clock3 size={12}/>} {settled?"Settled":failed?"Failed":"Pending sync"}</span></div></div>
  })}</div>;
}