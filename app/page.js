"use client";

import { useEffect, useMemo, useState } from "react";

const STARTING_CAPITAL = 200;
const RISK_PER_TRADE = 0.005;

function money(x) {
  return new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" }).format(x);
}
function num(x, digits = 2) {
  return Number.isFinite(x) ? x.toLocaleString("pl-PL", { maximumFractionDigits: digits }) : "—";
}
function pct(x) {
  return Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${x.toFixed(2)}%` : "—";
}
function cfg(x) {
  return x ? Object.entries(x).map(([k,v]) => `${k}:${v}`).join(" · ") : "—";
}

export default function Home() {
  const [market, setMarket] = useState(null);
  const [marketError, setMarketError] = useState("");
  const [marketLoading, setMarketLoading] = useState(true);
  const [selected, setSelected] = useState("BTCUSDT");

  const [lab, setLab] = useState(null);
  const [labLoading, setLabLoading] = useState(false);

  const [paper, setPaper] = useState([]);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem("ai-paper-v03") || "[]");
      const h = JSON.parse(localStorage.getItem("ai-lab-history-v03") || "[]");
      if (Array.isArray(p)) setPaper(p);
      if (Array.isArray(h)) setHistory(h);
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem("ai-paper-v03", JSON.stringify(paper));
  }, [paper]);

  useEffect(() => {
    localStorage.setItem("ai-lab-history-v03", JSON.stringify(history));
  }, [history]);

  async function refreshMarket() {
    setMarketLoading(true);
    setMarketError("");
    try {
      const r = await fetch("/api/market", { cache: "no-store" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "Błąd danych");
      setMarket(data);
      if (data.instruments?.length && !data.instruments.some((x) => x.symbol === selected)) {
        setSelected(data.instruments[0].symbol);
      }
    } catch (e) {
      setMarketError(e.message);
    } finally {
      setMarketLoading(false);
    }
  }

  useEffect(() => {
    refreshMarket();
    const id = setInterval(refreshMarket, 60000);
    return () => clearInterval(id);
  }, []);

  async function runLab(symbol = selected) {
    setLabLoading(true);
    try {
      const r = await fetch(`/api/lab?symbol=${symbol}`, { cache: "no-store" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "Laboratorium niedostępne");
      setLab(data);

      const top = data.ranking?.[0];
      const record = {
        id: `${symbol}-${Date.now()}`,
        symbol,
        generatedAt: data.generatedAt,
        strategy: top?.name,
        testReturnPct: top?.test?.totalReturnPct,
        drawdownPct: top?.test?.maxDrawdownPct,
        stabilityPct: top?.walkForward?.stabilityPct,
        eligible: data.candidate?.eligible,
      };
      setHistory((h) => [record, ...h].slice(0, 40));
    } catch (e) {
      setLab({ error: e.message });
    } finally {
      setLabLoading(false);
    }
  }

  const selectedRow = useMemo(
    () => market?.instruments?.find((x) => x.symbol === selected),
    [market, selected]
  );

  function addPaperCandidate() {
    if (!selectedRow || !lab?.candidate) return;

    const atrStopPct = Math.max(1, Math.min(5, (selectedRow.atrPct || 1) * 2));
    const riskPln = STARTING_CAPITAL * RISK_PER_TRADE;
    const positionPln = Math.min(STARTING_CAPITAL, riskPln / (atrStopPct / 100));
    const stop = selectedRow.price * (1 - atrStopPct / 100);

    const row = {
      id: `${selectedRow.symbol}-${Date.now()}`,
      symbol: selectedRow.symbol,
      strategy: lab.candidate.strategyName,
      config: lab.candidate.config,
      entry: selectedRow.price,
      stop,
      stopPct: atrStopPct,
      riskPln,
      positionPln,
      createdAt: new Date().toISOString(),
      source: "v0.3 paper candidate",
    };

    setPaper((p) => [row, ...p].slice(0, 50));
  }

  function exportJournal() {
    const blob = new Blob(
      [JSON.stringify({ exportedAt: new Date().toISOString(), paper, history }, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `autonomiczny-inwestor-v03-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const top = lab?.ranking?.[0];
  const candidateReady =
    lab?.candidate?.eligible &&
    lab?.candidate?.signalNow === "LONG" &&
    selectedRow;

  return (
    <main>
      <header className="topbar">
        <div>
          <p className="eyebrow">AUTONOMICZNY INWESTOR · v0.3</p>
          <h1>Research Lab</h1>
          <p className="muted">Skaner + 4 rodziny strategii + OOS + walk-forward + paper gating</p>
        </div>
        <div className="badges">
          <span className="badge safe">PAPER ONLY</span>
          <span className="badge">XTB: NIEPOŁĄCZONY</span>
          <span className="badge live">BINANCE LIVE</span>
        </div>
      </header>

      <section className="warning">
        <strong>Realne zlecenia są wyłączone.</strong>
        <span> Ranking i bramki jakości służą wyłącznie do badań i paper tradingu.</span>
      </section>

      <section className="metrics">
        <Metric label="Kapitał paper" value={money(STARTING_CAPITAL)} sub="bazowy" />
        <Metric label="Ryzyko / trade" value={money(STARTING_CAPITAL * RISK_PER_TRADE)} sub="0,50%" />
        <Metric label="Instrumenty" value="8" sub="skaner 1h" />
        <Metric label="Strategie" value="4" sub="rodziny" />
        <Metric label="Walidacja" value="70/30" sub="train / test" />
        <Metric label="Walk-forward" value="3" sub="foldy OOS" />
      </section>

      <section className="card">
        <div className="cardTitle">
          <div>
            <h2>Skaner rynku</h2>
            <p className="muted">8 płynnych par · score techniczny · ATR do sizingu paper</p>
          </div>
          <button onClick={refreshMarket} disabled={marketLoading}>
            {marketLoading ? "Pobieranie…" : "Odśwież"}
          </button>
        </div>

        {marketError && <div className="errorBox">{marketError}</div>}
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Instrument</th><th>Cena</th><th>24h</th><th>Score</th>
                <th>RSI</th><th>Momentum</th><th>ATR%</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(market?.instruments || []).map((x) => (
                <tr key={x.symbol} className={selected === x.symbol ? "selected" : ""}>
                  <td>
                    <button
                      className="linkBtn"
                      onClick={() => { setSelected(x.symbol); setLab(null); }}
                    >
                      {x.symbol}
                    </button>
                  </td>
                  <td>{num(x.price, x.price < 10 ? 4 : 2)}</td>
                  <td className={x.change24h >= 0 ? "positive" : "negative"}>{pct(x.change24h)}</td>
                  <td><b>{x.score}/100</b></td>
                  <td>{num(x.rsi14, 1)}</td>
                  <td>{pct(x.momentum24h)}</td>
                  <td>{pct(x.atrPct)}</td>
                  <td><span className={`signal ${x.score >= 70 ? "good" : x.score <= 35 ? "bad" : ""}`}>{x.label}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="tiny">Ostatnia aktualizacja: {market?.asOf ? new Date(market.asOf).toLocaleString("pl-PL") : "—"}</p>
      </section>

      <section className="card">
        <div className="cardTitle">
          <div>
            <h2>Laboratorium strategii · {selected}</h2>
            <p className="muted">1500 świec 1h · optymalizacja konfiguracji na train · ocena na test + walk-forward</p>
          </div>
          <button onClick={() => runLab(selected)} disabled={labLoading || !selectedRow}>
            {labLoading ? "Liczenie…" : `Uruchom lab ${selected}`}
          </button>
        </div>

        {!lab && <div className="placeholder">Uruchom lab dla wybranego instrumentu.</div>}
        {lab?.error && <div className="errorBox">{lab.error}</div>}

        {lab && !lab.error && (
          <>
            <div className="labSummary">
              <div>
                <span>Top strategia</span>
                <b>{top?.name || "—"}</b>
                <small>{cfg(top?.bestConfig)}</small>
              </div>
              <div>
                <span>OOS zwrot</span>
                <b className={top?.test?.totalReturnPct >= 0 ? "positive" : "negative"}>{pct(top?.test?.totalReturnPct)}</b>
                <small>{top?.test?.trades || 0} transakcji</small>
              </div>
              <div>
                <span>OOS drawdown</span>
                <b>{pct(top?.test?.maxDrawdownPct)}</b>
                <small>test 30%</small>
              </div>
              <div>
                <span>WF stabilność</span>
                <b>{pct(top?.walkForward?.stabilityPct)}</b>
                <small>{top?.walkForward?.positiveFolds}/{top?.walkForward?.totalFolds} dodatnich foldów</small>
              </div>
              <div>
                <span>Sygnał teraz</span>
                <b>{lab.candidate?.signalNow || "—"}</b>
                <small>{lab.candidate?.eligible ? "bramki jakości: PASS" : "bramki jakości: FAIL"}</small>
              </div>
            </div>

            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th><th>Strategia</th><th>Parametry</th><th>Train</th>
                    <th>Test</th><th>DD test</th><th>PF</th><th>Trades</th><th>WF</th><th>Sygnał</th>
                  </tr>
                </thead>
                <tbody>
                  {lab.ranking.map((r, i) => (
                    <tr key={r.id}>
                      <td>{i + 1}</td>
                      <td><b>{r.name}</b></td>
                      <td>{cfg(r.bestConfig)}</td>
                      <td>{pct(r.train.totalReturnPct)}</td>
                      <td className={r.test.totalReturnPct >= 0 ? "positive" : "negative"}>{pct(r.test.totalReturnPct)}</td>
                      <td>{pct(r.test.maxDrawdownPct)}</td>
                      <td>{num(r.test.profitFactor, 2)}</td>
                      <td>{r.test.trades}</td>
                      <td>{pct(r.walkForward.stabilityPct)}</td>
                      <td>{r.signalNow}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={`candidateBox ${lab.candidate?.eligible ? "pass" : "fail"}`}>
              <div>
                <b>Paper gate: {lab.candidate?.eligible ? "PASS" : "FAIL"}</b>
                <p>{lab.candidate?.reason}</p>
              </div>
              <button onClick={addPaperCandidate} disabled={!candidateReady}>
                {candidateReady ? "Dodaj kandydata paper" : "Brak aktywnego LONG"}
              </button>
            </div>
          </>
        )}
      </section>

      <section className="grid two">
        <article className="card">
          <div className="cardTitle">
            <div>
              <h2>Paper journal</h2>
              <p className="muted">Sizing na podstawie 0,50% ryzyka i 2×ATR.</p>
            </div>
            <button onClick={exportJournal} disabled={!paper.length && !history.length}>Eksport JSON</button>
          </div>

          {paper.length === 0 ? (
            <div className="placeholder">Brak kandydatów paper.</div>
          ) : (
            <div className="tableWrap">
              <table>
                <thead>
                  <tr><th>Symbol</th><th>Strategia</th><th>Wejście</th><th>Stop</th><th>Stop%</th><th>Wielkość</th><th>Ryzyko</th></tr>
                </thead>
                <tbody>
                  {paper.map((p) => (
                    <tr key={p.id}>
                      <td><b>{p.symbol}</b></td>
                      <td>{p.strategy}</td>
                      <td>{num(p.entry, p.entry < 10 ? 4 : 2)}</td>
                      <td>{num(p.stop, p.stop < 10 ? 4 : 2)}</td>
                      <td>{pct(-p.stopPct)}</td>
                      <td>{money(p.positionPln)}</td>
                      <td>{money(p.riskPln)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>

        <article className="card">
          <h2>Historia labów</h2>
          <p className="muted">Ostatnie 40 uruchomień; można je eksportować do JSON.</p>
          {history.length === 0 ? (
            <div className="placeholder">Brak historii.</div>
          ) : (
            <div className="historyList">
              {history.slice(0, 8).map((h) => (
                <div key={h.id}>
                  <span><b>{h.symbol}</b> · {h.strategy}</span>
                  <span className={h.testReturnPct >= 0 ? "positive" : "negative"}>{pct(h.testReturnPct)}</span>
                  <small>WF {pct(h.stabilityPct)} · {h.eligible ? "PASS" : "FAIL"}</small>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className="card riskCard">
        <h2>Hard risk policy</h2>
        <div className="riskGrid">
          <div><span>Ryzyko / pozycję</span><b>0,50%</b></div>
          <div><span>Stop</span><b>2×ATR, min 1%, max 5%</b></div>
          <div><span>Maks. sizing</span><b>100% paper capital</b></div>
          <div><span>Live trading</span><b className="off">WYŁĄCZONY</b></div>
        </div>
        <p className="note">
          Ranking strategii nie jest rekomendacją inwestycyjną. Bramka PASS oznacza wyłącznie,
          że strategia spełniła techniczne kryteria do dalszego paper testu w tej próbce.
        </p>
      </section>

      <footer>
        v0.3 · dane rzeczywiste · badania historyczne · paper only · XTB niepołączony
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
