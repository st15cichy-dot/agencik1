"use client";

import { useEffect, useMemo, useState } from "react";

const STARTING_CAPITAL = 200;
const RISK_PER_TRADE = 0.005;
const STOP_DISTANCE = 0.02;

function money(x) {
  return new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" }).format(x);
}
function num(x, digits = 2) {
  return Number.isFinite(x) ? x.toLocaleString("pl-PL", { maximumFractionDigits: digits }) : "—";
}
function pct(x) {
  return Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${x.toFixed(2)}%` : "—";
}

export default function Home() {
  const [market, setMarket] = useState(null);
  const [marketError, setMarketError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState("BTCUSDT");
  const [backtest, setBacktest] = useState(null);
  const [btLoading, setBtLoading] = useState(false);
  const [paper, setPaper] = useState([]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("ai-paper-v02") || "[]");
      if (Array.isArray(saved)) setPaper(saved);
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem("ai-paper-v02", JSON.stringify(paper));
  }, [paper]);

  async function refresh() {
    setLoading(true);
    setMarketError("");
    try {
      const r = await fetch("/api/market", { cache: "no-store" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "Błąd danych");
      setMarket(data);
      if (data.instruments?.length && !data.instruments.some(x => x.symbol === selected)) {
        setSelected(data.instruments[0].symbol);
      }
    } catch (e) {
      setMarketError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 60000);
    return () => clearInterval(id);
  }, []);

  async function runBacktest(symbol = selected) {
    setBtLoading(true);
    try {
      const r = await fetch(`/api/backtest?symbol=${symbol}`, { cache: "no-store" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "Backtest niedostępny");
      setBacktest(data);
    } catch (e) {
      setBacktest({ error: e.message });
    } finally {
      setBtLoading(false);
    }
  }

  function addPaper(x) {
    const riskPln = STARTING_CAPITAL * RISK_PER_TRADE;
    const positionPln = Math.min(STARTING_CAPITAL, riskPln / STOP_DISTANCE);
    const row = {
      id: `${x.symbol}-${Date.now()}`,
      symbol: x.symbol,
      entry: x.price,
      riskPln,
      positionPln,
      stop: x.price * (1 - STOP_DISTANCE),
      createdAt: new Date().toISOString(),
    };
    setPaper((p) => [row, ...p].slice(0, 20));
  }

  const selectedRow = useMemo(
    () => market?.instruments?.find((x) => x.symbol === selected),
    [market, selected]
  );

  return (
    <main>
      <header className="topbar">
        <div>
          <p className="eyebrow">AUTONOMICZNY INWESTOR · v0.2</p>
          <h1>Panel inwestycyjny</h1>
          <p className="muted">Live market data + skaner + backtest + paper trading</p>
        </div>
        <div className="badges">
          <span className="badge safe">PAPER ONLY</span>
          <span className="badge">XTB: NIEPOŁĄCZONY</span>
          <span className="badge live">DANE: BINANCE LIVE</span>
        </div>
      </header>

      <section className="warning">
        <strong>Realne transakcje pozostają wyłączone.</strong>
        <span> Dane rynkowe są rzeczywiste, ale wszystkie zlecenia w tej wersji są wyłącznie symulowane.</span>
      </section>

      <section className="metrics">
        <Metric label="Kapitał paper" value={money(STARTING_CAPITAL)} sub="saldo bazowe" />
        <Metric label="Ryzyko / transakcję" value={money(STARTING_CAPITAL * RISK_PER_TRADE)} sub="0,50% kapitału" />
        <Metric label="Stop modelowy" value="2,00%" sub="do sizingu demonstracyjnego" />
        <Metric label="Pozycje paper" value={String(paper.length)} sub="lokalnie w przeglądarce" />
        <Metric label="Źródło" value="Binance" sub="public market API" />
        <Metric label="Odświeżanie" value="60 s" sub="cache + batch" />
      </section>

      <section className="card">
        <div className="cardTitle">
          <div>
            <h2>Skaner rynku</h2>
            <p className="muted">Deterministyczny ranking: SMA20/50 + RSI14 + momentum + zmienność</p>
          </div>
          <button onClick={refresh} disabled={loading}>{loading ? "Pobieranie…" : "Odśwież"}</button>
        </div>

        {marketError && <div className="errorBox">Dane chwilowo niedostępne: {marketError}</div>}
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Instrument</th><th>Cena</th><th>24h</th><th>Score</th><th>RSI</th><th>Momentum</th><th>Sygnał</th><th></th>
              </tr>
            </thead>
            <tbody>
              {(market?.instruments || []).map((x) => (
                <tr key={x.symbol} className={selected === x.symbol ? "selected" : ""}>
                  <td><button className="linkBtn" onClick={() => setSelected(x.symbol)}>{x.symbol}</button></td>
                  <td>{num(x.price, x.price < 10 ? 4 : 2)}</td>
                  <td className={x.change24h >= 0 ? "positive" : "negative"}>{pct(x.change24h)}</td>
                  <td><b>{x.score}/100</b></td>
                  <td>{num(x.rsi14, 1)}</td>
                  <td>{pct(x.momentum24h)}</td>
                  <td><span className={`signal ${x.score >= 70 ? "good" : x.score <= 35 ? "bad" : ""}`}>{x.label}</span></td>
                  <td><button className="smallBtn" onClick={() => addPaper(x)}>Paper +</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="tiny">Ostatnia aktualizacja: {market?.asOf ? new Date(market.asOf).toLocaleString("pl-PL") : "—"}</p>
      </section>

      <section className="grid two">
        <article className="card">
          <div className="cardTitle">
            <div>
              <h2>Backtest</h2>
              <p className="muted">SMA20/SMA50, long-only, 1h, 500 świec</p>
            </div>
            <button onClick={() => runBacktest(selected)} disabled={btLoading || !selectedRow}>
              {btLoading ? "Liczenie…" : `Testuj ${selected}`}
            </button>
          </div>
          {!backtest && <div className="placeholder">Wybierz instrument i uruchom test.</div>}
          {backtest?.error && <div className="errorBox">{backtest.error}</div>}
          {backtest && !backtest.error && (
            <div className="btGrid">
              <Metric label="Zwrot" value={pct(backtest.totalReturnPct)} sub="historyczny wynik testu" />
              <Metric label="Max drawdown" value={pct(backtest.maxDrawdownPct)} sub="historyczny" />
              <Metric label="Win rate" value={pct(backtest.winRatePct)} sub={`${backtest.trades} transakcji`} />
              <Metric label="Koszt modelowy" value={`${backtest.assumptions.feePerSidePct.toFixed(2)}%/stronę`} sub="bez slippage" />
            </div>
          )}
          <p className="note">Backtest ma ograniczoną próbę i nie przewiduje przyszłych wyników.</p>
        </article>

        <article className="card">
          <h2>Risk engine</h2>
          <div className="riskList">
            <div><span>Kapitał</span><b>{money(STARTING_CAPITAL)}</b></div>
            <div><span>Ryzyko na pozycję</span><b>0,50%</b></div>
            <div><span>Modelowy stop</span><b>2,00%</b></div>
            <div><span>Maks. sizing modelowy</span><b>{money(Math.min(STARTING_CAPITAL, (STARTING_CAPITAL * RISK_PER_TRADE) / STOP_DISTANCE))}</b></div>
            <div><span>Live trading</span><b className="off">WYŁĄCZONY</b></div>
          </div>
          <p className="note">To warstwa techniczna do testów paper tradingu, nie rekomendacja inwestycyjna.</p>
        </article>
      </section>

      <section className="card">
        <div className="cardTitle">
          <div>
            <h2>Paper journal</h2>
            <p className="muted">Symulowane wejścia zapisują się lokalnie w tej przeglądarce.</p>
          </div>
          {paper.length > 0 && <button onClick={() => setPaper([])}>Wyczyść</button>}
        </div>
        {paper.length === 0 ? (
          <div className="placeholder">Brak pozycji paper. Użyj „Paper +” w skanerze.</div>
        ) : (
          <div className="tableWrap">
            <table>
              <thead><tr><th>Symbol</th><th>Wejście</th><th>Stop</th><th>Wielkość</th><th>Ryzyko</th><th>Czas</th></tr></thead>
              <tbody>
                {paper.map((p) => (
                  <tr key={p.id}>
                    <td><b>{p.symbol}</b></td>
                    <td>{num(p.entry, p.entry < 10 ? 4 : 2)}</td>
                    <td>{num(p.stop, p.stop < 10 ? 4 : 2)}</td>
                    <td>{money(p.positionPln)}</td>
                    <td>{money(p.riskPln)}</td>
                    <td>{new Date(p.createdAt).toLocaleString("pl-PL")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer>
        v0.2 · rzeczywiste dane rynkowe, wyłącznie paper trading · brak automatycznego składania zleceń
      </footer>
    </main>
  );
}

function Metric({ label, value, sub }) {
  return (
    <article className="metric">
      <div className="muted">{label}</div>
      <strong>{value}</strong>
      <small>{sub}</small>
    </article>
  );
}
