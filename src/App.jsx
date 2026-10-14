
import React from 'react';

import { useEffect, useState } from "react";
import { ArrowUpRight, ArrowDownToLine, Zap, ShieldCheck, WifiOff, Clock3, ChevronRight, RefreshCw, WalletCards, Sparkles, CircleHelp } from "lucide-react";
import { BrowserProvider, formatEther } from "ethers";
import Navbar from "./components/Navbar";
import DepositModal from "./components/DepositModal";
import OfflinePayModal from "./components/OfflinePayModal";
import ScannerModal from "./components/ScannerModal";
import TransactionList from "./components/TransactionList";
import { createDemoWallet, createDemoMerchantWallet } from "./utils/eip712Signer";
import { getAllVouchers } from "./utils/indexedDB";
import { startSyncEngine, subscribeSync, syncPendingVouchers } from "./utils/syncEngine";
import { VAULT_ADDRESS, CHAIN_ID } from "./utils/constants";
import "./index.css";

export default function App() {
  const [online, setOnline] = useState(navigator.onLine), [simulatedOffline, setSimulatedOffline] = useState(false);
  const [role, setRole] = useState("buyer"), [tab, setTab] = useState("home"), [modal, setModal] = useState(null), [transactions, setTransactions] = useState([]);
  const [syncState, setSyncState] = useState(null), [toast, setToast] = useState(""), [refreshing, setRefreshing] = useState(false);
  const [wallets, setWallets] = useState(null), [connectedWallet, setConnectedWallet] = useState(null);
  const [walletAddress, setWalletAddress] = useState(null), [walletBalance, setWalletBalance] = useState("0.0000");

  async function refreshWalletState() {
    if (!window.ethereum) {
      setConnectedWallet(null);
      setWalletAddress(null);
      setWalletBalance("0.0000");
      return;
    }

    try {
      const provider = new BrowserProvider(window.ethereum);
      const accounts = await provider.send("eth_accounts", []);
      if (!accounts.length) {
        setConnectedWallet(null);
        setWalletAddress(null);
        setWalletBalance("0.0000");
        return;
      }
      const signer = await provider.getSigner();
      const network = await provider.getNetwork();
      if (Number(network.chainId) !== CHAIN_ID) {
        setToast("Switch your wallet to Monad Testnet (Chain ID 10143) to continue.");
      }
      const nextAddress = await signer.getAddress();
      const balance = await provider.getBalance(nextAddress);
      const wallet = signer;
      wallet.getAddress = signer.getAddress.bind(signer);
      wallet.signTypedData = signer.signTypedData.bind(signer);
      setConnectedWallet(wallet);
      setWalletAddress(nextAddress);
      setWalletBalance(formatEther(balance));
    } catch (error) {
      setConnectedWallet(null);
      setWalletAddress(null);
      setWalletBalance("0.0000");
    }
  }

  async function connectWallet() {
    if (!window.ethereum) {
      setToast("MetaMask or a compatible wallet is required.");
      return;
    }

    try {
      const provider = new BrowserProvider(window.ethereum);
      const [account] = await provider.send("eth_requestAccounts", []);
      if (!account) throw new Error("No wallet account was selected.");
      const network = await provider.getNetwork();
      if (Number(network.chainId) !== CHAIN_ID) {
        throw new Error("Switch your wallet to Monad Testnet (Chain ID 10143) before using the vault.");
      }
      const signer = await provider.getSigner();
      const balance = await provider.getBalance(account);
      setConnectedWallet(signer);
      setWalletAddress(account);
      setWalletBalance(formatEther(balance));
      setToast("Wallet connected to Monad Testnet.");
    } catch (error) {
      setToast(error.message || "Could not connect wallet");
    }
  }

  useEffect(() => {
    let buyer, merchant;
    try {
      buyer = connectedWallet || createDemoWallet();
      merchant = createDemoMerchantWallet();
    } catch (e) { setToast("Demo signer unavailable. Refresh to retry."); }
    setWallets({ buyer, merchant });
  }, [connectedWallet]);

  useEffect(() => {
    refreshWalletState();
    const onlineHandler = () => setOnline(true), offlineHandler = () => setOnline(false);
    window.addEventListener("online", onlineHandler); window.addEventListener("offline", offlineHandler);
    if (window.ethereum) {
      const handleAccounts = () => refreshWalletState();
      const handleChain = () => refreshWalletState();
      window.ethereum.on?.("accountsChanged", handleAccounts);
      window.ethereum.on?.("chainChanged", handleChain);
    }
    const stop = startSyncEngine(); const unsub = subscribeSync(setSyncState);
    refreshLedger();
    return () => {
      window.removeEventListener("online", onlineHandler); window.removeEventListener("offline", offlineHandler);
      window.ethereum?.removeListener?.("accountsChanged", refreshWalletState);
      window.ethereum?.removeListener?.("chainChanged", refreshWalletState);
      stop(); unsub();
    };
  }, []);

  async function refreshLedger() { try { setTransactions(await getAllVouchers()) } catch { } }
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(""), 3600); return () => clearTimeout(t) } }, [toast]);
  const activeWallet = wallets?.[role];
  const balance = walletAddress ? walletBalance : "0.0000";
  const offline = !online || simulatedOffline;
  const pending = transactions.filter(t => t.status === "pending").length;
  const settled = transactions.filter(t => t.status === "settled").length;
  async function refresh() { setRefreshing(true); await refreshLedger(); if (!offline) { try { await syncPendingVouchers() } catch (e) { setToast(e.message) } } await refreshLedger(); setRefreshing(false) }
  function onQueued() { refreshLedger(); setModal(null); setToast("Voucher saved locally. Merchant settlement is still pending."); }
  function onAccepted() { refreshLedger(); setToast("Voucher verified offline and queued for sync."); }
  if (!wallets) return <div className="loading-screen"><div className="brand-mark"><Zap /></div><p>Preparing NoSignal…</p></div>;
  return <div className="app-shell">
    <Navbar online={online} simulatedOffline={simulatedOffline} onToggleOffline={() => setSimulatedOffline(v => !v)} role={role} setRole={v => { setRole(v); setTab("home") }} />
    <main className="main-content">
      <section className="welcome-row"><div><p className="eyebrow">{role === "buyer" ? "YOUR EVERYDAY WALLET" : "MERCHANT TERMINAL"}</p><h1>{role === "buyer" ? "Money moves. Signal optional." : "Take payments. Signal optional."}</h1><p className="welcome-sub">{offline ? "You're in offline simulation. Vouchers can be verified locally." : "Fast payments on Monad, built for the places networks forget."}</p></div><div className={`signal-card ${offline ? "signal-off" : "signal-on"}`}><span className="signal-orb" /><div><b>{offline ? "Offline ready" : "All systems go"}</b><small>{offline ? "Local voucher mode" : "Monad Testnet"}</small></div></div></section>
      {offline && <div className="offline-banner"><WifiOff size={17} /><div><b>You're in offline mode</b><span>Payments can be authorized locally. Final settlement requires reconnection.</span></div><button onClick={() => setSimulatedOffline(false)}>Reconnect</button></div>}
      <section className="balance-card"><div className="balance-top"><div className="balance-label"><WalletCards size={17} /><span>{role === "buyer" ? "Available vault balance" : "Merchant vault balance"}</span></div><span className="testnet-chip">TESTNET</span></div><div className="balance-value"><span>{balance}</span><small>MON</small></div><p className="balance-caption">{walletAddress ? `Connected: ${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : "Demo balance · not real money"}</p><div className="balance-actions">{role === "buyer" ? <><button className="light-button" onClick={() => setModal("deposit")}><ArrowDownToLine size={17} /> Top up vault</button><button className="glass-button" onClick={() => setModal("pay")}><ArrowUpRight size={17} /> Pay offline</button></> : <button className="light-button" onClick={() => setModal("scan")}><ArrowDownToLine size={17} /> Receive payment</button>} {walletAddress ? null : <button className="light-button" onClick={connectWallet}><WalletCards size={17} /> Connect wallet</button>}</div><div className="balance-decoration"><div /><div /><div /></div></section>
      <section className="stats-grid"><div className="stat-card"><span className="stat-icon purple"><Clock3 size={17} /></span><div><small>Pending vouchers</small><b>{pending}</b><span>Waiting to sync</span></div></div><div className="stat-card"><span className="stat-icon green"><ShieldCheck size={17} /></span><div><small>Settled payments</small><b>{settled}</b><span>Confirmed receipts</span></div></div><div className="stat-card"><span className="stat-icon amber"><Zap size={17} /></span><div><small>Network mode</small><b>{offline ? "Offline" : "Online"}</b><span>{offline ? "Local-first" : "Monad Testnet"}</span></div></div></section>
      <section className="activity-section"><div className="section-heading"><div><p className="eyebrow">YOUR ACTIVITY</p><h2>Payment activity</h2></div><button className="refresh-button" onClick={refresh} disabled={refreshing}><RefreshCw size={15} className={refreshing ? "spin" : ""} /> Refresh</button></div><div className="tabs"><button className={tab === "home" ? "active" : ""} onClick={() => setTab("home")}>All activity</button><button className={tab === "pending" ? "active" : ""} onClick={() => setTab("pending")}>Pending <span>{pending}</span></button><button className={tab === "settled" ? "active" : ""} onClick={() => setTab("settled")}>Settled</button></div><TransactionList transactions={transactions.filter(t => tab === "pending" ? t.status === "pending" : tab === "settled" ? t.status === "settled" : true)} /></section>
      <section className="trust-note"><div className="trust-icon"><CircleHelp size={18} /></div><div><b>Offline acceptance isn't final settlement</b><p>A QR signature confirms the payer's authorization only. Funds are confirmed after the voucher is accepted by the Monad vault contract.</p></div><ChevronRight size={16} /></section>
      <footer><span><span className="brand-dot">●</span> NoSignal</span><span>Built for the places signal can't reach.</span><span className="footer-network"><span /> Monad Testnet</span></footer>
    </main>
    {modal === "deposit" && <DepositModal onClose={() => setModal(null)} onDeposited={(amount, hash) => { setToast(`Deposit confirmed · ${hash.slice(0, 10)}…`); refreshLedger() }} />}
    {modal === "pay" && <OfflinePayModal onClose={() => setModal(null)} wallet={connectedWallet || wallets.buyer} merchantAddress={wallets.merchant.address} onQueued={onQueued} />}
    {modal === "scan" && <ScannerModal onClose={() => setModal(null)} merchantAddress={wallets.merchant.address} onAccepted={onAccepted} />}
    {toast && <div className="toast"><Sparkles size={16} />{toast}</div>}
    {syncState?.state === "error" && <div className="sync-warning">{syncState.message}</div>}
    {!VAULT_ADDRESS && <div className="config-note">Demo UI · configure <code>VITE_VAULT_ADDRESS</code> after deploying the contract.</div>}
  </div>;
}