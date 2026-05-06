import { useState, useEffect, useMemo } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { db } from "./firebase";
import {
  collection, doc, setDoc, deleteDoc, onSnapshot, addDoc, getDocs, Timestamp, query, orderBy
} from "firebase/firestore";

// ── Constantes ───────────────────────────────────────────────────────────────
const PASSWORD = "3252";
const IS_TIPO_GENERAL = 0.25;   // Impuesto Sociedades general
const IS_TIPO_REDUCIDO = 0.23;  // IS reducido (facturación < 1M€)

const DEFAULT_CONFIG = [
  { ticker: "VWCE", nombre: "RV Global", pesoObj: 0.60, color: "#4f7fff" },
  { ticker: "EUNA", nombre: "Bonos Globales EUR Hedged", pesoObj: 0.30, color: "#34d399" },
  { ticker: "EGLN", nombre: "Oro", pesoObj: 0.05, color: "#f5d300" },
  { ticker: "IB1T", nombre: "Bitcoin ETP", pesoObj: 0.05, color: "#ff9500" },
];

const DEFAULT_PRECIOS = { VWCE: 155.30, EUNA: 4.906, EGLN: 0, IB1T: 6.723 };

const fmt = (n, dec = 2) => (n ?? 0).toLocaleString("es-ES", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtEur = (n) => "€" + fmt(n);
const fmtPct = (n) => (n * 100).toFixed(1) + "%";
const todayStr = () => new Date().toISOString().split("T")[0];

// ── Login Screen ─────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [pwd, setPwd] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const handle = () => {
    if (pwd === PASSWORD) onLogin();
    else { setError("Contraseña incorrecta"); setPwd(""); }
  };
  return (
    <div style={{ minHeight:"100vh", background:"#060a14", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Syne', sans-serif", padding:20 }}>
      <style>{"@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');"}</style>
      <div style={{ background:"#0c1422", border:"1px solid #1e2d4a", borderRadius:24, padding:"40px 36px", width:"100%", maxWidth:380, textAlign:"center" }}>
        <div style={{ width:56, height:56, borderRadius:14, background:"linear-gradient(135deg, #4f7fff, #7c3aed)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, margin:"0 auto 20px" }}>◈</div>
        <h1 style={{ fontSize:22, fontWeight:800, letterSpacing:"-0.02em", marginBottom:4 }}>ETF Portfolio</h1>
        <p style={{ fontSize:12, color:"#4a5a7a", fontFamily:"'JetBrains Mono', monospace", marginBottom:32 }}>Gestión de cartera · SL</p>
        <div style={{ position:"relative", marginBottom:10 }}>
          <input
            type={show ? "text" : "password"}
            style={{ background:"#0d1525", border:`1.5px solid ${error ? "#ff3b5c" : "#1e2d4a"}`, borderRadius:10, color:"#e2e8f5", fontFamily:"'JetBrains Mono', monospace", fontSize:18, padding:"14px 48px 14px 18px", outline:"none", width:"100%", textAlign:"center", letterSpacing:"0.2em", boxSizing:"border-box" }}
            placeholder="••••"
            value={pwd}
            onChange={e => { setPwd(e.target.value); setError(""); }}
            onKeyDown={e => e.key === "Enter" && handle()}
            autoFocus
          />
          <button onClick={() => setShow(!show)} style={{ position:"absolute", right:14, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:"#4a5a7a", cursor:"pointer", fontSize:16 }}>
            {show ? "🙈" : "👁️"}
          </button>
        </div>
        {error && <p style={{ fontSize:12, color:"#ff3b5c", marginBottom:8 }}>{error}</p>}
        <button onClick={handle} style={{ background:"linear-gradient(135deg, #4f7fff, #7c3aed)", color:"white", border:"none", borderRadius:10, padding:"14px", width:"100%", fontSize:14, fontWeight:700, cursor:"pointer", fontFamily:"inherit", marginTop:4 }}>
          Acceder →
        </button>
      </div>
    </div>
  );
}

const COLORS = ["#4f7fff","#34d399","#f5d300","#ff9500","#a78bfa","#ff3b5c","#06b6d4","#f97316","#84cc16","#ec4899"];

// ── Main App ─────────────────────────────────────────────────────────────────
export default function ETFPortfolio() {
  const [authed, setAuthed] = useState(() => { try { return !!localStorage.getItem("etf_auth"); } catch(e) { return false; } });
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [precios, setPrecios] = useState(DEFAULT_PRECIOS);
  const [transacciones, setTransacciones] = useState([]);
  const [tab, setTab] = useState("dashboard");
  const [modal, setModal] = useState(null);
  const [formTx, setFormTx] = useState({ fecha: todayStr(), ticker:"VWCE", tipo:"Compra", participaciones:"", precio:"", comision:"" });
  const [formPrecio, setFormPrecio] = useState({ ...DEFAULT_PRECIOS });
  const [formETF, setFormETF] = useState({ ticker:"", nombre:"", pesoObj:"" });
  const [editingETF, setEditingETF] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [tipoIS, setTipoIS] = useState(IS_TIPO_GENERAL);
  const [ejercicioFiscal, setEjercicioFiscal] = useState(new Date().getFullYear().toString());

  const handleLogin = () => {
    try { localStorage.setItem("etf_auth", "1"); } catch(e) {}
    setAuthed(true);
  };
  const handleLogout = () => {
    try { localStorage.removeItem("etf_auth"); } catch(e) {}
    setAuthed(false);
  };

  // Firebase
  useEffect(() => {
    if (!authed) return;
    const unsubTx = onSnapshot(
      query(collection(db, "transacciones"), orderBy("fecha", "desc")),
      (snap) => { setTransacciones(snap.docs.map(d => ({ ...d.data(), id: d.id }))); setCargando(false); },
      () => setCargando(false)
    );
    const unsubPrecios = onSnapshot(doc(db, "config", "precios"), (snap) => {
      if (snap.exists()) setPrecios(snap.data());
    });
    const unsubConfig = onSnapshot(collection(db, "etfs"), async (snap) => {
      if (snap.empty) {
        // Primera vez: cargar los ETFs por defecto
        for (const etf of DEFAULT_CONFIG) {
          await setDoc(doc(db, "etfs", etf.ticker), etf);
        }
      } else {
        const etfs = snap.docs.map(d => d.data()).sort((a,b) => b.pesoObj - a.pesoObj);
        setConfig(etfs);
      }
    });
    return () => { unsubTx(); unsubPrecios(); unsubConfig(); };
  }, [authed]);

  // ── Cartera calculada ─────────────────────────────────────────────────────
  const cartera = useMemo(() => {
    const partics = {}, costes = {};
    config.forEach(c => { partics[c.ticker] = 0; costes[c.ticker] = 0; });
    transacciones.forEach(tx => {
      const delta = tx.tipo === "Compra" ? +tx.participaciones : -tx.participaciones;
      partics[tx.ticker] = (partics[tx.ticker] || 0) + delta;
      if (tx.tipo === "Compra") costes[tx.ticker] = (costes[tx.ticker] || 0) + +tx.participaciones * +tx.precio + +tx.comision;
    });
    const totalMdo = config.reduce((s, c) => s + partics[c.ticker] * (precios[c.ticker] || 0), 0);
    return config.map(c => {
      const partic = partics[c.ticker] || 0;
      const precio = precios[c.ticker] || 0;
      const valorMercado = partic * precio;
      const coste = costes[c.ticker] || 0;
      const pnl = valorMercado - coste;
      const pnlPct = coste > 0 ? pnl / coste : 0;
      const pesoActual = totalMdo > 0 ? valorMercado / totalMdo : 0;
      const desviacion = pesoActual - c.pesoObj;
      return { ...c, partic, precio, valorMercado, coste, pnl, pnlPct, pesoActual, desviacion };
    });
  }, [config, precios, transacciones]);

  const totalCartera = cartera.reduce((s, c) => s + c.valorMercado, 0);
  const totalCoste = cartera.reduce((s, c) => s + c.coste, 0);
  const totalPnL = totalCartera - totalCoste;
  const totalPnLPct = totalCoste > 0 ? totalPnL / totalCoste : 0;

  // ── Rebalanceo ────────────────────────────────────────────────────────────
  const rebalanceo = useMemo(() => cartera.map(c => {
    const valorObj = totalCartera * c.pesoObj;
    const diferencia = valorObj - c.valorMercado;
    const participaciones = c.precio > 0 ? Math.round(diferencia / c.precio) : 0;
    return { ...c, valorObj, diferencia, participaciones };
  }), [cartera, totalCartera]);

  // ── Fiscalidad IS (FIFO) ──────────────────────────────────────────────────
  const fiscalidad = useMemo(() => {
    const ventas = transacciones.filter(tx => tx.tipo === "Venta" && tx.fecha.startsWith(ejercicioFiscal));
    const comprasCola = {};
    [...transacciones].sort((a, b) => a.fecha.localeCompare(b.fecha))
      .filter(tx => tx.tipo === "Compra")
      .forEach(tx => {
        if (!comprasCola[tx.ticker]) comprasCola[tx.ticker] = [];
        comprasCola[tx.ticker].push({ ...tx, restantes: +tx.participaciones });
      });
    return ventas.map(venta => {
      const cola = comprasCola[venta.ticker] || [];
      let restVenta = +venta.participaciones;
      let costeTotal = 0;
      for (const c of cola) {
        if (restVenta <= 0) break;
        const usado = Math.min(c.restantes, restVenta);
        costeTotal += usado * +c.precio;
        c.restantes -= usado;
        restVenta -= usado;
      }
      const ingresos = +venta.participaciones * +venta.precio - +venta.comision;
      const ganancia = ingresos - costeTotal;
      return { ...venta, costeTotal, ingresos, ganancia };
    });
  }, [transacciones, ejercicioFiscal]);

  const totalComisiones = transacciones
    .filter(tx => tx.fecha.startsWith(ejercicioFiscal))
    .reduce((s, tx) => s + +tx.comision, 0);
  const totalGanancias = fiscalidad.reduce((s, v) => s + v.ganancia, 0);
  const baseImponible = totalGanancias - totalComisiones;
  const cuotaIS = baseImponible > 0 ? baseImponible * tipoIS : 0;

  // ── Transacciones ─────────────────────────────────────────────────────────
  const guardarTx = async () => {
    if (!formTx.participaciones || !formTx.precio) return;
    await addDoc(collection(db, "transacciones"), {
      ...formTx,
      participaciones: +formTx.participaciones,
      precio: +formTx.precio,
      comision: +formTx.comision || 0,
    });
    setModal(null);
  };

  const eliminarTx = async (id) => {
    await deleteDoc(doc(db, "transacciones", id));
  };

  const guardarPrecios = async () => {
    await setDoc(doc(db, "config", "precios"), formPrecio);
    setModal(null);
  };

  const guardarETF = async () => {
    const ticker = formETF.ticker.trim().toUpperCase();
    const nombre = formETF.nombre.trim();
    const pesoObj = parseFloat(formETF.pesoObj) / 100;
    if (!ticker || !nombre || isNaN(pesoObj) || pesoObj <= 0) return;
    const colorIdx = editingETF ? config.findIndex(c => c.ticker === editingETF) : config.length;
    const color = COLORS[colorIdx % COLORS.length];
    await setDoc(doc(db, "etfs", ticker), { ticker, nombre, pesoObj, color: editingETF ? (config.find(c=>c.ticker===editingETF)?.color || color) : color });
    setModal(null); setEditingETF(null); setFormETF({ ticker:"", nombre:"", pesoObj:"" });
  };

  const eliminarETF = async (ticker) => {
    await deleteDoc(doc(db, "etfs", ticker));
  };

  const abrirNuevoETF = () => {
    setEditingETF(null);
    setFormETF({ ticker:"", nombre:"", pesoObj:"" });
    setModal("etf");
  };

  const abrirEditarETF = (etf) => {
    setEditingETF(etf.ticker);
    setFormETF({ ticker: etf.ticker, nombre: etf.nombre, pesoObj: (etf.pesoObj * 100).toFixed(1) });
    setModal("etf");
  };

  const totalPesosObj = config.reduce((s, c) => s + c.pesoObj, 0);

  if (!authed) return <LoginScreen onLogin={handleLogin} />;

  if (cargando) return (
    <div style={{ minHeight:"100vh", background:"#060a14", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Syne', sans-serif" }}>
      <style>{"@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');"}</style>
      <div style={{ textAlign:"center", color:"#4a5a7a" }}>
        <div style={{ fontSize:40, marginBottom:12 }}>◈</div>
        <p>Cargando cartera...</p>
      </div>
    </div>
  );

  const tabs = [
    { id:"dashboard", label:"Dashboard", icon:"◉" },
    { id:"cartera", label:"Cartera", icon:"◈" },
    { id:"rebalanceo", label:"Rebalanceo", icon:"⟳" },
    { id:"transacciones", label:"Transacciones", icon:"↕" },
    { id:"etfs", label:"Mis ETFs", icon:"◇" },
    { id:"fiscalidad", label:"Fiscalidad IS", icon:"⊕" },
  ];

  const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
    * { box-sizing:border-box; margin:0; padding:0; }
    ::-webkit-scrollbar{width:5px} ::-webkit-scrollbar-track{background:#060a14} ::-webkit-scrollbar-thumb{background:#1a2540;border-radius:3px}
    .btn{cursor:pointer;border:none;border-radius:8px;font-family:inherit;font-weight:600;transition:all 0.18s;letter-spacing:0.02em}
    .btn:hover{transform:translateY(-1px);filter:brightness(1.12)}
    .input{background:#0d1525;border:1.5px solid #1e2d4a;border-radius:8px;color:#e2e8f5;font-family:'JetBrains Mono',monospace;font-size:13px;padding:9px 13px;outline:none;width:100%;transition:border-color 0.2s}
    .input:focus{border-color:#4f7fff}
    .input option{background:#0d1525}
    .card{background:#0c1422;border:1px solid #162035;border-radius:16px;padding:22px}
    .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,0.8);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;z-index:100;padding:20px}
    .modal{background:#0c1422;border:1px solid #1e2d4a;border-radius:20px;padding:28px;width:100%;max-width:480px;max-height:92vh;overflow-y:auto}
    .tab-btn{padding:9px 16px;border-radius:8px;font-size:12px;font-weight:600;border:1px solid transparent;background:transparent;color:#4a5a7a;cursor:pointer;transition:all 0.18s;display:flex;align-items:center;gap:6px;letter-spacing:0.02em;white-space:nowrap}
    .tab-btn.active{background:#111e35;border-color:#1e3060;color:#e2e8f5}
    .tab-btn:hover:not(.active){color:#8090b0}
    .tag{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;font-family:'JetBrains Mono',monospace}
    .row{display:grid;align-items:center;padding:13px 18px;border-radius:12px;background:#0d1525;border:1px solid #162035;transition:all 0.18s}
    .row:hover{border-color:#1e3060;background:#101a2e}
    .lbl{font-size:10px;font-weight:700;color:#2a3a5a;text-transform:uppercase;letter-spacing:0.08em}
    @media(max-width:700px){.gs{grid-template-columns:1fr 1fr !important}.hm{display:none !important}.top-wrap{flex-direction:column;align-items:stretch !important}}
  `;

  return (
    <div style={{ minHeight:"100vh", background:"#060a14", fontFamily:"'Syne', sans-serif", color:"#e2e8f5" }}>
      <style>{CSS}</style>

      {/* Header */}
      <div style={{ borderBottom:"1px solid #111e35", padding:"16px 24px", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:10, position:"sticky", top:0, background:"#060a14", zIndex:50 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ width:36, height:36, borderRadius:10, background:"linear-gradient(135deg, #4f7fff, #7c3aed)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:17 }}>◈</div>
          <div>
            <h1 style={{ fontSize:16, fontWeight:800, letterSpacing:"-0.02em" }}>ETF Portfolio <span style={{ color:"#4a5a7a", fontSize:12, fontWeight:500 }}>· SL</span></h1>
            <p style={{ fontSize:10, color:"#2a3a5a", fontFamily:"'JetBrains Mono', monospace" }}>Interactive Brokers · Sociedad Limitada</p>
          </div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }} className="top-wrap">
          <button className="btn" onClick={() => { setFormPrecio({ ...precios }); setModal("precios"); }} style={{ background:"#111e35", color:"#8090b0", padding:"8px 14px", fontSize:12, border:"1px solid #1e2d4a" }}>
            ↻ Precios
          </button>
          <button className="btn" onClick={() => { setFormTx({ fecha:todayStr(), ticker:"VWCE", tipo:"Compra", participaciones:"", precio:"", comision:"" }); setModal("tx"); }} style={{ background:"#4f7fff", color:"white", padding:"8px 14px", fontSize:12 }}>
            + Transacción
          </button>
          <button className="btn" onClick={handleLogout} style={{ background:"transparent", color:"#2a3a5a", padding:"8px 12px", fontSize:12, border:"1px solid #162035" }}>
            ✕
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ padding:"10px 24px", borderBottom:"1px solid #111e35", display:"flex", gap:4, flexWrap:"wrap", overflowX:"auto" }}>
        {tabs.map(t => (
          <button key={t.id} className={`tab-btn ${tab===t.id?"active":""}`} onClick={() => setTab(t.id)}>
            <span>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      <div style={{ maxWidth:1200, margin:"0 auto", padding:"24px 20px" }}>

        {/* ── DASHBOARD ── */}
        {tab === "dashboard" && (
          <div style={{ display:"flex", flexDirection:"column", gap:18 }}>
            <div className="gs" style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12 }}>
              {[
                { label:"Valor Total Cartera", value:fmtEur(totalCartera), sub:`Coste: ${fmtEur(totalCoste)}`, color:"#e2e8f5" },
                { label:"P&L No Realizado", value:(totalPnL>=0?"+":"")+fmtEur(totalPnL), sub:(totalPnL>=0?"+":"")+fmtPct(totalPnLPct), color:totalPnL>=0?"#34d399":"#ff3b5c" },
                { label:"Activos", value:config.length+" ETFs", sub:"Interactive Brokers", color:"#4f7fff" },
                { label:"Operaciones", value:transacciones.length, sub:`${transacciones.filter(t=>t.tipo==="Venta").length} ventas realizadas`, color:"#a78bfa" },
              ].map((k,i) => (
                <div key={i} className="card" style={{ position:"relative", overflow:"hidden" }}>
                  <div style={{ position:"absolute", top:0, left:0, right:0, height:2, background:k.color, opacity:0.5 }} />
                  <p className="lbl" style={{ marginBottom:8 }}>{k.label}</p>
                  <p style={{ fontSize:22, fontWeight:800, color:k.color, letterSpacing:"-0.02em", fontFamily:"'JetBrains Mono', monospace" }}>{k.value}</p>
                  <p style={{ fontSize:11, color:"#4a5a7a", marginTop:4, fontFamily:"'JetBrains Mono', monospace" }}>{k.sub}</p>
                </div>
              ))}
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"1fr 1.5fr", gap:16 }}>
              <div className="card">
                <h3 className="lbl" style={{ marginBottom:16 }}>Distribución Actual</h3>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={cartera.filter(c=>c.valorMercado>0)} dataKey="valorMercado" nameKey="ticker" cx="50%" cy="50%" innerRadius={50} outerRadius={78} strokeWidth={0}>
                      {cartera.map((c,i) => <Cell key={i} fill={c.color} />)}
                    </Pie>
                    <Tooltip formatter={v=>fmtEur(v)} contentStyle={{ background:"#0c1422", border:"1px solid #1e2d4a", borderRadius:10, fontFamily:"inherit", fontSize:12 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display:"flex", flexDirection:"column", gap:7, marginTop:10 }}>
                  {cartera.map(c => (
                    <div key={c.ticker} style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                        <div style={{ width:7, height:7, borderRadius:"50%", background:c.color }} />
                        <span style={{ fontSize:12, fontWeight:700 }}>{c.ticker}</span>
                        <span style={{ fontSize:11, color:"#4a5a7a" }}>{c.nombre}</span>
                      </div>
                      <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:12, color:c.color }}>{fmtPct(c.pesoActual)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card">
                <h3 className="lbl" style={{ marginBottom:16 }}>Objetivo vs Actual</h3>
                <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
                  {cartera.map(c => (
                    <div key={c.ticker}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                        <span style={{ fontSize:13, fontWeight:700 }}>{c.ticker} <span style={{ color:"#4a5a7a", fontWeight:400, fontSize:11 }}>{c.nombre}</span></span>
                        <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:12 }}>
                          <span style={{ color:c.color }}>{fmtPct(c.pesoActual)}</span>
                          <span style={{ color:"#2a3a5a" }}> / {fmtPct(c.pesoObj)}</span>
                        </span>
                      </div>
                      <div style={{ background:"#111e35", borderRadius:4, height:6, position:"relative", overflow:"hidden" }}>
                        <div style={{ width:`${Math.min(c.pesoActual*100,100)}%`, height:"100%", background:c.color, borderRadius:4 }} />
                        <div style={{ position:"absolute", top:0, left:`${c.pesoObj*100}%`, width:2, height:"100%", background:"#e2e8f5", opacity:0.3 }} />
                      </div>
                      <div style={{ fontSize:10, color:Math.abs(c.desviacion)>0.03?"#ff9500":"#34d399", marginTop:3, fontFamily:"'JetBrains Mono', monospace" }}>
                        {c.desviacion>=0?"+":""}{fmtPct(c.desviacion)} desviación {Math.abs(c.desviacion)>0.05?"⚠":"✓"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Posiciones */}
            <div className="card">
              <h3 className="lbl" style={{ marginBottom:14 }}>Posiciones</h3>
              <div style={{ display:"grid", gridTemplateColumns:"70px 1fr 90px 110px 90px 90px 90px", gap:10, padding:"5px 18px", marginBottom:6 }} className="hm">
                {["Ticker","Activo","Partic.","Valor","Coste","P&L €","P&L %"].map(h=><span key={h} className="lbl">{h}</span>)}
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {cartera.map(c => (
                  <div key={c.ticker} className="row" style={{ gridTemplateColumns:"70px 1fr 90px 110px 90px 90px 90px" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                      <div style={{ width:5, height:22, borderRadius:3, background:c.color }} />
                      <span style={{ fontWeight:800, fontSize:13, fontFamily:"'JetBrains Mono', monospace" }}>{c.ticker}</span>
                    </div>
                    <span style={{ fontSize:12, color:"#8090b0" }}>{c.nombre}</span>
                    <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:13 }}>{fmt(c.partic,0)}</span>
                    <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:13, fontWeight:600 }}>{fmtEur(c.valorMercado)}</span>
                    <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:12, color:"#8090b0" }}>{fmtEur(c.coste)}</span>
                    <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:13, color:c.pnl>=0?"#34d399":"#ff3b5c", fontWeight:600 }}>{c.pnl>=0?"+":""}{fmtEur(c.pnl)}</span>
                    <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:13, color:c.pnl>=0?"#34d399":"#ff3b5c" }}>{c.pnl>=0?"+":""}{fmtPct(c.pnlPct)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── CARTERA ── */}
        {tab === "cartera" && (
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            <div style={{ display:"grid", gridTemplateColumns:"70px 1.5fr 80px 100px 110px 90px 90px 80px 80px", gap:10, padding:"5px 18px" }} className="hm">
              {["Ticker","Activo","Partic.","Precio","Valor Mdo.","Coste","Peso Act.","P&L €","P&L %"].map(h=><span key={h} className="lbl">{h}</span>)}
            </div>
            {cartera.map(c => (
              <div key={c.ticker} className="row" style={{ gridTemplateColumns:"70px 1.5fr 80px 100px 110px 90px 90px 80px 80px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <div style={{ width:5, height:28, borderRadius:3, background:c.color }} />
                  <span style={{ fontWeight:800, fontSize:13, fontFamily:"'JetBrains Mono', monospace" }}>{c.ticker}</span>
                </div>
                <div>
                  <div style={{ fontSize:13, fontWeight:600 }}>{c.nombre}</div>
                  <div style={{ fontSize:10, color:"#4a5a7a" }}>Peso obj: {fmtPct(c.pesoObj)}</div>
                </div>
                <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:13 }}>{fmt(c.partic,0)}</span>
                <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:12, color:"#8090b0" }}>€{fmt(c.precio)}</span>
                <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:13, fontWeight:600 }}>{fmtEur(c.valorMercado)}</span>
                <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:12, color:"#8090b0" }}>{fmtEur(c.coste)}</span>
                <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:13, color:c.color }}>{fmtPct(c.pesoActual)}</span>
                <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:13, color:c.pnl>=0?"#34d399":"#ff3b5c", fontWeight:700 }}>{c.pnl>=0?"+":""}{fmtEur(c.pnl)}</span>
                <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:13, color:c.pnl>=0?"#34d399":"#ff3b5c" }}>{c.pnl>=0?"+":""}{fmtPct(c.pnlPct)}</span>
              </div>
            ))}
            {/* Total */}
            <div className="row" style={{ gridTemplateColumns:"70px 1.5fr 80px 100px 110px 90px 90px 80px 80px", background:"#0a1220", borderColor:"#1e3060" }}>
              <span style={{ fontWeight:800, color:"#8090b0", gridColumn:"1/5", fontFamily:"'JetBrains Mono', monospace", fontSize:12 }}>TOTAL</span>
              <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:14, fontWeight:800 }}>{fmtEur(totalCartera)}</span>
              <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:12, color:"#8090b0" }}>{fmtEur(totalCoste)}</span>
              <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:12, color:"#4a5a7a" }}>100%</span>
              <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:14, fontWeight:800, color:totalPnL>=0?"#34d399":"#ff3b5c" }}>{totalPnL>=0?"+":""}{fmtEur(totalPnL)}</span>
              <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:13, color:totalPnL>=0?"#34d399":"#ff3b5c" }}>{totalPnL>=0?"+":""}{fmtPct(totalPnLPct)}</span>
            </div>
          </div>
        )}

        {/* ── REBALANCEO ── */}
        {tab === "rebalanceo" && (
          <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
            <div className="card" style={{ borderColor:"#1e3060" }}>
              <div style={{ display:"flex", gap:24, flexWrap:"wrap", alignItems:"center" }}>
                <div>
                  <p className="lbl" style={{ marginBottom:4 }}>Valor total</p>
                  <p style={{ fontSize:24, fontWeight:800, fontFamily:"'JetBrains Mono', monospace" }}>{fmtEur(totalCartera)}</p>
                </div>
                <div style={{ width:1, background:"#162035", height:40 }} />
                <div>
                  <p className="lbl" style={{ marginBottom:4 }}>Estado</p>
                  <p style={{ fontSize:14, fontWeight:700, color:rebalanceo.some(r=>Math.abs(r.desviacion)>0.05)?"#ff9500":"#34d399" }}>
                    {rebalanceo.some(r=>Math.abs(r.desviacion)>0.05) ? "⚠ Rebalanceo recomendado" : "✓ Dentro de tolerancia (±5%)"}
                  </p>
                </div>
              </div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"70px 1fr 100px 100px 90px 90px 110px 130px", gap:10, padding:"5px 18px" }} className="hm">
              {["Ticker","Activo","Val. Actual","Val. Objetivo","Peso Act.","Peso Obj.","Diferencia","Acción"].map(h=><span key={h} className="lbl">{h}</span>)}
            </div>
            {rebalanceo.map(r => (
              <div key={r.ticker} className="row" style={{ gridTemplateColumns:"70px 1fr 100px 100px 90px 90px 110px 130px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <div style={{ width:5, height:28, borderRadius:3, background:r.color }} />
                  <span style={{ fontWeight:800, fontSize:13, fontFamily:"'JetBrains Mono', monospace" }}>{r.ticker}</span>
                </div>
                <span style={{ fontSize:12, color:"#8090b0" }}>{r.nombre}</span>
                <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:13 }}>{fmtEur(r.valorMercado)}</span>
                <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:12, color:"#8090b0" }}>{fmtEur(r.valorObj)}</span>
                <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:13, color:r.color }}>{fmtPct(r.pesoActual)}</span>
                <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:12, color:"#4a5a7a" }}>{fmtPct(r.pesoObj)}</span>
                <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:13, color:r.diferencia>=0?"#34d399":"#ff3b5c", fontWeight:600 }}>
                  {r.diferencia>=0?"+":""}{fmtEur(r.diferencia)}
                </span>
                <div>
                  {r.participaciones!==0 ? (
                    <span className="tag" style={{ background:r.participaciones>0?"rgba(52,211,153,0.15)":"rgba(255,59,92,0.15)", color:r.participaciones>0?"#34d399":"#ff3b5c" }}>
                      {r.participaciones>0?"▲ Comprar":"▼ Vender"} {Math.abs(r.participaciones)}
                    </span>
                  ) : <span style={{ fontSize:11, color:"#2a3a5a" }}>✓ OK</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── TRANSACCIONES ── */}
        {tab === "transacciones" && (
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:6 }}>
              <button className="btn" onClick={() => { setFormTx({ fecha:todayStr(), ticker:"VWCE", tipo:"Compra", participaciones:"", precio:"", comision:"" }); setModal("tx"); }} style={{ background:"#4f7fff", color:"white", padding:"9px 18px", fontSize:13 }}>
                + Añadir transacción
              </button>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"100px 70px 80px 90px 90px 80px 100px 40px", gap:10, padding:"5px 18px" }} className="hm">
              {["Fecha","Ticker","Tipo","Partic.","Precio","Comisión","Total",""].map(h=><span key={h} className="lbl">{h}</span>)}
            </div>
            {transacciones.length === 0 ? (
              <div className="card" style={{ textAlign:"center", padding:"48px", color:"#2a3a5a" }}>
                <p style={{ fontSize:36, marginBottom:10 }}>↕</p>
                <p>Sin transacciones registradas</p>
              </div>
            ) : (
              transacciones.map(tx => {
                const c = config.find(c=>c.ticker===tx.ticker);
                const total = +tx.participaciones * +tx.precio + (tx.tipo==="Compra" ? +tx.comision : -tx.comision);
                return (
                  <div key={tx.id} className="row" style={{ gridTemplateColumns:"100px 70px 80px 90px 90px 80px 100px 40px" }}>
                    <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:11, color:"#8090b0" }}>{tx.fecha}</span>
                    <span style={{ fontWeight:800, fontSize:13, fontFamily:"'JetBrains Mono', monospace", color:c?.color }}>{tx.ticker}</span>
                    <span className="tag" style={{ background:tx.tipo==="Compra"?"rgba(52,211,153,0.15)":"rgba(255,59,92,0.15)", color:tx.tipo==="Compra"?"#34d399":"#ff3b5c" }}>{tx.tipo}</span>
                    <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:13 }}>{fmt(tx.participaciones,0)}</span>
                    <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:13 }}>€{fmt(tx.precio)}</span>
                    <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:12, color:"#4a5a7a" }}>€{fmt(tx.comision)}</span>
                    <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:13, fontWeight:600 }}>€{fmt(total)}</span>
                    <button onClick={() => eliminarTx(tx.id)} style={{ background:"rgba(255,59,92,0.1)", color:"#ff3b5c", border:"none", borderRadius:6, width:28, height:28, cursor:"pointer", fontSize:11 }}>✕</button>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ── MIS ETFs ── */}
        {tab === "etfs" && (
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10 }}>
              <div>
                <h2 style={{ fontSize:18, fontWeight:800, letterSpacing:"-0.02em" }}>Mis ETFs</h2>
                <p style={{ fontSize:12, color:"#4a5a7a", marginTop:3 }}>
                  Pesos objetivo total: <span style={{ color: Math.abs(totalPesosObj - 1) < 0.01 ? "#34d399" : "#ff9500", fontFamily:"'JetBrains Mono', monospace", fontWeight:700 }}>{fmtPct(totalPesosObj)}</span>
                  {Math.abs(totalPesosObj - 1) > 0.01 && <span style={{ color:"#ff9500", marginLeft:8 }}>⚠ Deben sumar 100%</span>}
                </p>
              </div>
              <button className="btn" onClick={abrirNuevoETF} style={{ background:"#4f7fff", color:"white", padding:"9px 18px", fontSize:13 }}>
                + Añadir ETF
              </button>
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"80px 1fr 110px 110px 90px 100px", gap:10, padding:"5px 18px" }} className="hm">
              {["Ticker","Nombre","Peso Obj.","Valor Act.","P&L","Acciones"].map(h=><span key={h} className="lbl">{h}</span>)}
            </div>

            {config.length === 0 ? (
              <div className="card" style={{ textAlign:"center", padding:"48px", color:"#2a3a5a" }}>
                <p style={{ fontSize:36, marginBottom:10 }}>◇</p>
                <p>No hay ETFs configurados</p>
                <p style={{ fontSize:12, marginTop:6 }}>Añade tu primer ETF para empezar</p>
              </div>
            ) : (
              config.map(etf => {
                const c = cartera.find(x => x.ticker === etf.ticker);
                return (
                  <div key={etf.ticker} className="row" style={{ gridTemplateColumns:"80px 1fr 110px 110px 90px 100px" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                      <div style={{ width:5, height:28, borderRadius:3, background:etf.color }} />
                      <span style={{ fontWeight:800, fontSize:13, fontFamily:"'JetBrains Mono', monospace" }}>{etf.ticker}</span>
                    </div>
                    <span style={{ fontSize:13, color:"#8090b0" }}>{etf.nombre}</span>
                    <div>
                      <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:14, fontWeight:700, color:etf.color }}>{fmtPct(etf.pesoObj)}</span>
                      <div style={{ background:"#111e35", borderRadius:3, height:4, marginTop:4 }}>
                        <div style={{ width:`${Math.min(etf.pesoObj*100,100)}%`, height:"100%", background:etf.color, borderRadius:3 }} />
                      </div>
                    </div>
                    <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:13, fontWeight:600 }}>{c ? fmtEur(c.valorMercado) : "—"}</span>
                    <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:13, color:c?.pnl>=0?"#34d399":"#ff3b5c", fontWeight:600 }}>
                      {c?.pnl ? (c.pnl>=0?"+":"")+fmtEur(c.pnl) : "—"}
                    </span>
                    <div style={{ display:"flex", gap:6 }}>
                      <button onClick={() => abrirEditarETF(etf)} style={{ background:"rgba(79,127,255,0.1)", color:"#4f7fff", border:"none", borderRadius:7, width:32, height:32, cursor:"pointer", fontSize:13 }}>✏️</button>
                      <button onClick={() => eliminarETF(etf.ticker)} style={{ background:"rgba(255,59,92,0.1)", color:"#ff3b5c", border:"none", borderRadius:7, width:32, height:32, cursor:"pointer", fontSize:13 }}>🗑</button>
                    </div>
                  </div>
                );
              })
            )}

            <div style={{ background:"#0a1220", borderRadius:12, padding:"14px 18px", border:"1px solid #162035" }}>
              <p style={{ fontSize:11, color:"#2a3a5a", lineHeight:1.6 }}>
                💡 Los pesos objetivo deben sumar exactamente 100% para que el rebalanceo funcione correctamente. Al añadir un nuevo ETF, ajusta los pesos del resto.
              </p>
            </div>
          </div>
        )}

        {/* ── FISCALIDAD IS ── */}
        {tab === "fiscalidad" && (
          <div style={{ display:"flex", flexDirection:"column", gap:18 }}>

            {/* Aviso SL */}
            <div style={{ background:"rgba(79,127,255,0.08)", border:"1px solid rgba(79,127,255,0.2)", borderRadius:14, padding:"14px 18px", display:"flex", gap:12, alignItems:"flex-start" }}>
              <span style={{ fontSize:18 }}>🏢</span>
              <div>
                <p style={{ fontSize:13, fontWeight:700, color:"#4f7fff", marginBottom:3 }}>Régimen Fiscal: Impuesto de Sociedades (España)</p>
                <p style={{ fontSize:12, color:"#4a5a7a" }}>Las plusvalías de ETFs tributan al tipo general del IS junto con el resto de la base imponible. No aplican los tramos del IRPF ni retenciones automáticas. Las comisiones de compraventa son gasto fiscalmente deducible.</p>
              </div>
            </div>

            {/* Controles ejercicio e IS */}
            <div style={{ display:"flex", gap:12, flexWrap:"wrap", alignItems:"flex-end" }}>
              <div>
                <label className="lbl" style={{ display:"block", marginBottom:6 }}>Ejercicio fiscal</label>
                <select className="input" style={{ width:"auto" }} value={ejercicioFiscal} onChange={e => setEjercicioFiscal(e.target.value)}>
                  {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <div>
                <label className="lbl" style={{ display:"block", marginBottom:6 }}>Tipo IS aplicable</label>
                <div style={{ display:"flex", gap:8 }}>
                  <button className="btn" onClick={() => setTipoIS(IS_TIPO_GENERAL)}
                    style={{ padding:"9px 14px", fontSize:12, background:tipoIS===IS_TIPO_GENERAL?"#4f7fff":"#111e35", color:tipoIS===IS_TIPO_GENERAL?"white":"#8090b0", border:"1px solid #1e2d4a" }}>
                    25% — General
                  </button>
                  <button className="btn" onClick={() => setTipoIS(IS_TIPO_REDUCIDO)}
                    style={{ padding:"9px 14px", fontSize:12, background:tipoIS===IS_TIPO_REDUCIDO?"#4f7fff":"#111e35", color:tipoIS===IS_TIPO_REDUCIDO?"white":"#8090b0", border:"1px solid #1e2d4a" }}>
                    23% — Facturación &lt;1M€
                  </button>
                </div>
              </div>
            </div>

            {/* KPIs fiscales */}
            <div className="gs" style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12 }}>
              {[
                { label:"Plusvalías brutas", value:fmtEur(totalGanancias), color:totalGanancias>=0?"#34d399":"#ff3b5c" },
                { label:"Comisiones deducibles", value:"-"+fmtEur(totalComisiones), color:"#a78bfa" },
                { label:`Base imponible IS ${ejercicioFiscal}`, value:fmtEur(baseImponible), color:"#f5d300" },
                { label:`Cuota IS estimada (${(tipoIS*100).toFixed(0)}%)`, value:fmtEur(cuotaIS), color:"#ff9500" },
              ].map((k,i) => (
                <div key={i} className="card">
                  <p className="lbl" style={{ marginBottom:8 }}>{k.label}</p>
                  <p style={{ fontSize:20, fontWeight:800, color:k.color, fontFamily:"'JetBrains Mono', monospace" }}>{k.value}</p>
                </div>
              ))}
            </div>

            {/* Tabla ventas */}
            {fiscalidad.length === 0 ? (
              <div className="card" style={{ textAlign:"center", padding:"48px", color:"#2a3a5a" }}>
                <p style={{ fontSize:36, marginBottom:10 }}>⊕</p>
                <p>Sin ventas en {ejercicioFiscal}</p>
                <p style={{ fontSize:12, marginTop:6 }}>Registra transacciones de venta para ver el cálculo IS</p>
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                <h3 className="lbl" style={{ marginBottom:4 }}>Ventas realizadas · {ejercicioFiscal}</h3>
                <div style={{ display:"grid", gridTemplateColumns:"100px 70px 90px 110px 110px 110px", gap:10, padding:"5px 18px" }} className="hm">
                  {["Fecha","Ticker","Partic.","Ingresos netos","Coste FIFO","Plusvalía"].map(h=><span key={h} className="lbl">{h}</span>)}
                </div>
                {fiscalidad.map((v,i) => (
                  <div key={i} className="row" style={{ gridTemplateColumns:"100px 70px 90px 110px 110px 110px" }}>
                    <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:11, color:"#8090b0" }}>{v.fecha}</span>
                    <span style={{ fontWeight:800, fontSize:13, fontFamily:"'JetBrains Mono', monospace", color:config.find(c=>c.ticker===v.ticker)?.color }}>{v.ticker}</span>
                    <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:13 }}>{fmt(v.participaciones,0)}</span>
                    <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:13 }}>{fmtEur(v.ingresos)}</span>
                    <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:12, color:"#8090b0" }}>{fmtEur(v.costeTotal)}</span>
                    <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:13, fontWeight:700, color:v.ganancia>=0?"#34d399":"#ff3b5c" }}>
                      {v.ganancia>=0?"+":""}{fmtEur(v.ganancia)}
                    </span>
                  </div>
                ))}
                {/* Resumen */}
                <div className="row" style={{ gridTemplateColumns:"100px 70px 90px 110px 110px 110px", background:"#0a1220", borderColor:"#1e3060" }}>
                  <span style={{ fontWeight:700, fontSize:12, color:"#8090b0", gridColumn:"1/5", fontFamily:"'JetBrains Mono', monospace" }}>RESULTADO FISCAL</span>
                  <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:12, color:"#a78bfa" }}>-{fmtEur(totalComisiones)}</span>
                  <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize:14, fontWeight:800, color:baseImponible>=0?"#f5d300":"#34d399" }}>
                    {baseImponible>=0?"+":""}{fmtEur(baseImponible)}
                  </span>
                </div>
              </div>
            )}

            {/* Nota disclaimer */}
            <div style={{ background:"#0a1220", borderRadius:12, padding:"14px 18px", border:"1px solid #162035" }}>
              <p style={{ fontSize:11, color:"#2a3a5a", lineHeight:1.6 }}>
                ⚠️ <strong style={{ color:"#3a4a6a" }}>Cálculo estimativo.</strong> La base imponible del IS incluye todos los ingresos y gastos de la SL, no solo las plusvalías de la cartera. Consulta con tu asesor fiscal para la liquidación definitiva. Método de valoración: FIFO. Comisiones de Interactive Brokers incluidas como gasto deducible.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Modal Nueva Transacción ── */}
      {modal === "tx" && (
        <div className="modal-bg" onClick={() => setModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize:20, fontWeight:800, marginBottom:20 }}>Nueva Transacción</h2>
            <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <div>
                  <label className="lbl" style={{ display:"block", marginBottom:6 }}>Fecha</label>
                  <input className="input" type="date" value={formTx.fecha} onChange={e => setFormTx({...formTx, fecha:e.target.value})} />
                </div>
                <div>
                  <label className="lbl" style={{ display:"block", marginBottom:6 }}>Tipo</label>
                  <select className="input" value={formTx.tipo} onChange={e => setFormTx({...formTx, tipo:e.target.value})}>
                    <option>Compra</option>
                    <option>Venta</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="lbl" style={{ display:"block", marginBottom:6 }}>ETF</label>
                <select className="input" value={formTx.ticker} onChange={e => setFormTx({...formTx, ticker:e.target.value})}>
                  {config.map(c => <option key={c.ticker} value={c.ticker}>{c.ticker} — {c.nombre}</option>)}
                </select>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12 }}>
                <div>
                  <label className="lbl" style={{ display:"block", marginBottom:6 }}>Participaciones</label>
                  <input className="input" type="number" min="0" placeholder="0" value={formTx.participaciones} onChange={e => setFormTx({...formTx, participaciones:e.target.value})} />
                </div>
                <div>
                  <label className="lbl" style={{ display:"block", marginBottom:6 }}>Precio €</label>
                  <input className="input" type="number" min="0" step="0.001" placeholder="0.000" value={formTx.precio} onChange={e => setFormTx({...formTx, precio:e.target.value})} />
                </div>
                <div>
                  <label className="lbl" style={{ display:"block", marginBottom:6 }}>Comisión €</label>
                  <input className="input" type="number" min="0" step="0.01" placeholder="0.00" value={formTx.comision} onChange={e => setFormTx({...formTx, comision:e.target.value})} />
                </div>
              </div>
              {formTx.participaciones && formTx.precio && (
                <div style={{ background:"#111e35", borderRadius:10, padding:"12px 16px" }}>
                  <div className="lbl" style={{ marginBottom:4 }}>Total estimado</div>
                  <div style={{ fontSize:20, fontWeight:800, color:formTx.tipo==="Compra"?"#ff9500":"#34d399", fontFamily:"'JetBrains Mono', monospace" }}>
                    {formTx.tipo==="Compra"?"-":"+"}€{fmt(+formTx.participaciones * +formTx.precio + (formTx.tipo==="Compra"?+formTx.comision||0:0))}
                  </div>
                </div>
              )}
            </div>
            <div style={{ display:"flex", gap:10, marginTop:22, justifyContent:"flex-end" }}>
              <button className="btn" onClick={() => setModal(null)} style={{ background:"#111e35", color:"#8090b0", padding:"10px 18px", fontSize:13, border:"1px solid #1e2d4a" }}>Cancelar</button>
              <button className="btn" onClick={guardarTx} style={{ background:formTx.tipo==="Compra"?"#4f7fff":"#34d399", color:formTx.tipo==="Compra"?"white":"#060a14", padding:"10px 20px", fontSize:13, fontWeight:700 }}>
                Registrar {formTx.tipo}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Actualizar Precios ── */}
      {modal === "precios" && (
        <div className="modal-bg" onClick={() => setModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize:20, fontWeight:800, marginBottom:6 }}>Actualizar Precios</h2>
            <p style={{ fontSize:13, color:"#4a5a7a", marginBottom:20 }}>Introduce los precios actuales de cada ETF</p>
            <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
              {config.map(c => (
                <div key={c.ticker} style={{ display:"flex", alignItems:"center", gap:12 }}>
                  <div style={{ width:5, height:36, borderRadius:3, background:c.color, flexShrink:0 }} />
                  <div style={{ flex:1 }}>
                    <label style={{ fontSize:12, fontWeight:700, display:"block", marginBottom:5 }}>
                      {c.ticker} <span style={{ color:"#4a5a7a", fontWeight:400 }}>— {c.nombre}</span>
                    </label>
                    <input className="input" type="number" min="0" step="0.001" placeholder="0.000"
                      value={formPrecio[c.ticker]||""} onChange={e => setFormPrecio({...formPrecio, [c.ticker]:+e.target.value})} />
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display:"flex", gap:10, marginTop:22, justifyContent:"flex-end" }}>
              <button className="btn" onClick={() => setModal(null)} style={{ background:"#111e35", color:"#8090b0", padding:"10px 18px", fontSize:13, border:"1px solid #1e2d4a" }}>Cancelar</button>
              <button className="btn" onClick={guardarPrecios} style={{ background:"#4f7fff", color:"white", padding:"10px 20px", fontSize:13, fontWeight:700 }}>Guardar precios</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Añadir / Editar ETF ── */}
      {modal === "etf" && (
        <div className="modal-bg" onClick={() => setModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize:20, fontWeight:800, marginBottom:6 }}>{editingETF ? "Editar ETF" : "Añadir ETF"}</h2>
            <p style={{ fontSize:13, color:"#4a5a7a", marginBottom:20 }}>
              {editingETF ? "Modifica los datos del ETF" : "Añade un nuevo ETF a tu cartera"}
            </p>
            <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
              <div>
                <label className="lbl" style={{ display:"block", marginBottom:6 }}>Ticker <span style={{ color:"#2a3a5a", textTransform:"none", fontSize:10 }}>(ej: VWCE, SPY, QQQ...)</span></label>
                <input className="input" placeholder="TICKER" value={formETF.ticker}
                  onChange={e => setFormETF({...formETF, ticker:e.target.value.toUpperCase()})}
                  disabled={!!editingETF}
                  style={{ opacity: editingETF ? 0.5 : 1, fontFamily:"'JetBrains Mono', monospace", fontWeight:700, fontSize:16, letterSpacing:"0.05em" }} />
              </div>
              <div>
                <label className="lbl" style={{ display:"block", marginBottom:6 }}>Nombre descriptivo</label>
                <input className="input" placeholder="Ej: RV Global, Bonos Euro..." value={formETF.nombre}
                  onChange={e => setFormETF({...formETF, nombre:e.target.value})} />
              </div>
              <div>
                <label className="lbl" style={{ display:"block", marginBottom:6 }}>
                  Peso objetivo (%) <span style={{ color:"#2a3a5a", textTransform:"none", fontSize:10 }}>— total actual: {fmtPct(totalPesosObj)}</span>
                </label>
                <div style={{ position:"relative" }}>
                  <input className="input" type="number" min="0" max="100" step="0.1" placeholder="0.0"
                    value={formETF.pesoObj} onChange={e => setFormETF({...formETF, pesoObj:e.target.value})}
                    style={{ paddingRight:36 }} />
                  <span style={{ position:"absolute", right:14, top:"50%", transform:"translateY(-50%)", color:"#4a5a7a", fontSize:14, fontWeight:700 }}>%</span>
                </div>
                {formETF.pesoObj && (
                  <p style={{ fontSize:11, color:"#4a5a7a", marginTop:5, fontFamily:"'JetBrains Mono', monospace" }}>
                    Total resultante: <span style={{ color: Math.abs(totalPesosObj - (editingETF ? config.find(c=>c.ticker===editingETF)?.pesoObj||0 : 0) + parseFloat(formETF.pesoObj)/100 - 1) < 0.01 ? "#34d399" : "#ff9500" }}>
                      {fmtPct(totalPesosObj - (editingETF ? config.find(c=>c.ticker===editingETF)?.pesoObj||0 : 0) + (parseFloat(formETF.pesoObj)||0)/100)}
                    </span>
                  </p>
                )}
              </div>
            </div>
            <div style={{ display:"flex", gap:10, marginTop:22, justifyContent:"flex-end" }}>
              <button className="btn" onClick={() => { setModal(null); setEditingETF(null); }} style={{ background:"#111e35", color:"#8090b0", padding:"10px 18px", fontSize:13, border:"1px solid #1e2d4a" }}>Cancelar</button>
              <button className="btn" onClick={guardarETF} style={{ background:"#4f7fff", color:"white", padding:"10px 20px", fontSize:13, fontWeight:700 }}>
                {editingETF ? "Guardar cambios" : "Añadir ETF"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
