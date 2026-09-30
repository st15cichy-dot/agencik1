"use client";

import { useEffect, useMemo, useState } from "react";

const STARTING_CAPITAL = 200;
const RISK_PER_TRADE = 0.005;
const AUTO_RESEARCH_AFTER_MS = 6 * 60 * 60 * 1000;

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
  return x ? Object.entries(x).map(([k, v]) => `${k}:${v}`).join(" · ") : "—";
}

export default function Home() {
  const [market, setMarket] = useState(null);
  const [marketError, setMarketError] = useState("");
  const [marketLoading, setMarketLoading] = useState(true);
  const [selected, setSelected] = useState("BTCUSDT");

  const [lab, setLab] = useState(null);
  const [labLoading, setLabLoading] = useState(false);

  const [allLab, setAllLab] = useState(null);
  const [allLabLoading, setAllLabLoading] = useState(false);

  const [paper, setPaper] = useState([]);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem("ai-paper-v04") || "[]");
      const h = JSON.parse(localStorage.getItem("ai-lab-history-v04") || "[]");
      const a = JSON.parse(localStorage.getItem("ai-all-lab-v04") || "null");
      if (Array.isArray(p)) setPaper(p);
      if (Array.isArray(h)) setHistory(h);
      if (a && typeof a === "object") setAllLab(a);
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem("ai-paper-v04", JSON.stringify(paper));
  }, [paper]);

  useEffect(() => {
    localStorage.setItem("ai-lab-history-v04", JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    if (allLab) localStorage.setItem("ai-all-lab-v04", JSON.stringify(allLab));
  }, [allLab]);

  async function refreshMarket() {
    setMarketLoading(true);
    setMarketError("");
    try {
      const r = await fetch("/api/market", { cache: "no-store" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "Błąd danych");
      setMarket(data);
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
      setHistory((h) => [{
        id: `${symbol}-${Date.now()}`,
        symbol,
        generatedAt: data.generatedAt,
        strategy: top?.name,
        testReturnPct: top?.test?.totalReturnPct,
        benchmarkPct: top?.test?.benchmarkPct,
        excessReturnPct: top?.test?.excessReturnPct,
        drawdownPct: top?.test?.maxDrawdownPct,
        trades: top?.test?.trades,
        stabilityPct: top?.walkForward?.stabilityPct,
        eligible: data.candidate?.eligible,
      }, ...h].slice(0, 100));
    } catch (e) {
      setLab({ error: e.message });
    } finally {
      setLabLoading(false);
    }
  }

  async function runAllLabs() {
    setAllLabLoading(true);
    try {
      const r = await fetch("/api/lab-all", { cache: "no-store" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "Analiza całego rynku niedostępna");
      setAllLab(data);
      localStorage.setItem("ai-all-lab-last-run", String(Date.now()));
    } catch (e) {
      setAllLab({ error: e.message });
    } finally {
      setAllLabLoading(false);
    }
  }

  useEffect(() => {
    const last = Number(localStorage.getItem("ai-all-lab-last-run") || 0);
    if (!last || Date.now() - last >= AUTO_RESEARCH_AFTER_MS) {
      runAllLabs();
    }
  }, []);

  const selectedRow = useMemo(
    () => market?.instruments?.find((x) => x.symbol === selected),
    [market, selected]
  );

  function addPaperCandidateFrom(symbol, strategy, config) {
    const row = market?.instruments?.find((x) => x.symbol === symbol);
    if (!row) return;

    const atrStopPct = Math.max(1, Math.min(5, (row.atrPct || 1) * 2));
    const riskPln = STARTING_CAPITAL * RISK_PER_TRADE;
    const positionPln = Math.min(STARTING_CAPITAL, riskPln / (atrStopPct / 100));

    setPaper((p) => [{
      id: `${symbol}-${Date.now()}`,
      symbol,
      strategy,
      config,
      entry: row.price,
      stop: row.price * (1 - atrStopPct / 100),
      stopPct: atrStopPct,
      riskPln,
      positionPln,
      createdAt: new Date().toISOString(),
      source: "v0.4 validated paper candidate",
    }, ...p].slice(0, 100));
  }

  function exportJournal() {
    const blob = new Blob(
      [JSON.stringify({
        version: "0.4.0",
        exportedAt: new Date().toISOString(),
        paper,
        history,
        allMarketResearch: allLab,
      }, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `autonomiczny-inwestor-v04-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const top = lab?.ranking?.[0];
  const chosen = lab?.ranking?.find((r) => r.id === lab?.candidate?.strategyId) || top;

  return (
    <main>
      <header className="topbar">
        <div>
          <p className="eyebrow">AUTONOMICZNY INWESTOR · v0.4</p>
          <h1>Validation Engine</h1>
          <p className="muted">Multi-market research + benchmark + ostrzejszy paper gate</p>
        </div>
        <div className="badges">
          <span className="badge safe">PAPER ONLY</span>
          <span className="badge">XTB: NIEPOŁĄCZONY</span>
          <span className="badge live">BINANCE LIVE</span>
        </div>
      </header>

      <section className="warning">
        <strong>Realne zlecenia pozostają wyłączone.</strong>
        <span> PASS oznacza tylko zgodę na dalszy paper test — nie rekomendację inwestycyjną.</span>
      </section>

      <section className="metrics">
        <Metric label="Kapitał paper" value={money(STARTING_CAPITAL)} sub="bazowy" />
        <Metric label="Ryzyko / trade" value={money(STARTING_CAPITAL * RISK_PER_TRADE)} sub="0,50%" />
        <Metric label="Min. OOS trades" value="8" sub="bramka jakości" />
        <Metric label="WF dodatnie" value="≥ 2/3" sub="bramka jakości" />
        <Metric label="Min. PF" value="1,15" sub="bramka jakości" />
        <Metric label="Max OOS DD" value="-12%" sub="bramka jakości" />
      </section>

      <section className="card">
        <div className="cardTitle">
          <div>
            <h2>Skaner rynku</h2>
            <p className="muted">8 par · cena, score, RSI, momentum i ATR</p>
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
      </section>

      <section className="card">
        <div className="cardTitle">
          <div>
            <h2>Analiza całego rynku</h2>
            <p className="muted">Automatyczny research 8 instrumentów; odświeża się po otwarciu, jeśli ostatni run był ≥ 6 h temu.</p>
          </div>
          <button onClick={runAllLabs} disabled={allLabLoading}>
            {allLabLoading ? "Analizuję 8 rynków…" : "Analizuj wszystkie 8"}
          </button>
        </div>

        {allLab?.error && <div className="errorBox">{allLab.error}</div>}
        {!allLab && <div className="placeholder">Oczekiwanie na pierwszy research.</div>}

        {allLab && !allLab.error && (
          <>
            <div className="allSummary">
              <Metric label="Przeanalizowano" value={String(allLab.successful)} sub={`z ${allLab.analyzed}`} />
              <Metric label="Paper-ready" value={String(allLab.candidates?.length || 0)} sub="PASS + aktywny LONG" />
              <Metric label="Ostatni run" value={new Date(allLab.generatedAt).toLocaleTimeString("pl-PL")} sub={new Date(allLab.generatedAt).toLocaleDateString("pl-PL")} />
            </div>

            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Instrument</th><th>Strategia</th><th>OOS</th><th>Benchmark</th>
                    <th>Excess</th><th>DD</th><th>PF</th><th>Trades</th><th>WF</th><th>Gate</th><th>Sygnał</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {(allLab.ranking || []).map((r) => (
                    <tr key={r.symbol}>
                      <td><b>{r.symbol}</b></td>
                      <td>{r.strategy}</td>
                      <td className={r.oosReturnPct >= 0 ? "positive" : "negative"}>{pct(r.oosReturnPct)}</td>
                      <td>{pct(r.benchmarkPct)}</td>
                      <td className={r.excessReturnPct >= 0 ? "positive" : "negative"}>{pct(r.excessReturnPct)}</td>
                      <td>{pct(r.drawdownPct)}</td>
                      <td>{num(r.profitFactor, 2)}</td>
                      <td>{r.trades}</td>
                      <td>{r.wfPositive}/{r.wfTotal}</td>
                      <td><span className={`signal ${r.eligible ? "good" : "bad"}`}>{r.eligible ? "PASS" : "FAIL"}</span></td>
                      <td>{r.signalNow}</td>
                      <td>
                        {r.paperReady && (
                          <button className="smallBtn" onClick={() => addPaperCandidateFrom(r.symbol, r.strategy, r.config)}>
                            Paper +
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="card">
        <div className="cardTitle">
          <div>
            <h2>Laboratorium pojedynczego instrumentu · {selected}</h2>
            <p className="muted">1500 świec 1h · train/test 70/30 · benchmark · 3-fold walk-forward</p>
          </div>
          <button onClick={() => runLab(selected)} disabled={labLoading || !selectedRow}>
            {labLoading ? "Liczenie…" : `Uruchom lab ${selected}`}
          </button>
        </div>

        {!lab && <div className="placeholder">Wybierz instrument i uruchom dokładny lab.</div>}
        {lab?.error && <div className="errorBox">{lab.error}</div>}

        {lab && !lab.error && (
          <>
            <div className="labSummary">
              <div><span>{lab.candidate?.eligible ? "Wybrana strategia" : "Top score (fallback)"}</span><b>{chosen?.name || "—"}</b><small>{cfg(chosen?.bestConfig)}</small></div>
              <div><span>OOS</span><b className={chosen?.test?.totalReturnPct >= 0 ? "positive" : "negative"}>{pct(chosen?.test?.totalReturnPct)}</b><small>{chosen?.test?.trades || 0} transakcji</small></div>
              <div><span>Buy & hold</span><b>{pct(chosen?.test?.benchmarkPct)}</b><small>ta sama próbka</small></div>
              <div><span>Excess vs B&H</span><b className={chosen?.test?.excessReturnPct >= 0 ? "positive" : "negative"}>{pct(chosen?.test?.excessReturnPct)}</b><small>po kosztach modelowych</small></div>
              <div><span>WF</span><b>{chosen?.walkForward?.positiveFolds}/{chosen?.walkForward?.totalFolds}</b><small>{pct(chosen?.walkForward?.stabilityPct)} dodatnich</small></div>
              <div><span>Gate</span><b>{lab.candidate?.eligible ? "PASS" : "FAIL"}</b><small>{lab.candidate?.gate?.passedCount}/{lab.candidate?.gate?.totalChecks} kryteriów</small></div>
            </div>

            <div className="gateGrid">
              {Object.entries(lab.candidate?.gate?.checks || {}).map(([key, value]) => (
                <div key={key} className={value ? "gatePass" : "gateFail"}>
                  <span>{value ? "✓" : "×"}</span>
                  <b>{key}</b>
                </div>
              ))}
            </div>

            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th><th>Strategia</th><th>Parametry</th><th>Train</th>
                    <th>OOS</th><th>B&H</th><th>Excess</th><th>DD</th><th>PF</th><th>Trades</th><th>WF</th><th>Gate</th><th>Sygnał</th>
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
                      <td>{pct(r.test.benchmarkPct)}</td>
                      <td className={r.test.excessReturnPct >= 0 ? "positive" : "negative"}>{pct(r.test.excessReturnPct)}</td>
                      <td>{pct(r.test.maxDrawdownPct)}</td>
                      <td>{num(r.test.profitFactor, 2)}</td>
                      <td>{r.test.trades}</td>
                      <td>{r.walkForward.positiveFolds}/{r.walkForward.totalFolds}</td>
                      <td><span className={`signal ${r.eligible ? "good" : "bad"}`}>{r.eligible ? "PASS" : "FAIL"}</span></td>
                      <td>{r.signalNow}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="grid two">
        <article className="card">
          <div className="cardTitle">
            <div>
              <h2>Paper candidates</h2>
              <p className="muted">Tylko ręcznie dodane po PASS + aktywnym LONG.</p>
            </div>
            <button onClick={exportJournal} disabled={!paper.length && !history.length && !allLab}>Eksport JSON</button>
          </div>

          {paper.length === 0 ? (
            <div className="placeholder">Brak kandydatów paper-ready.</div>
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
          <h2>Historia researchu</h2>
          <p className="muted">Do 100 ostatnich pojedynczych labów w tej przeglądarce.</p>
          {history.length === 0 ? (
            <div className="placeholder">Brak historii.</div>
          ) : (
            <div className="historyList">
              {history.slice(0, 10).map((h) => (
                <div key={h.id}>
                  <span><b>{h.symbol}</b> · {h.strategy}</span>
                  <span className={h.testReturnPct >= 0 ? "positive" : "negative"}>{pct(h.testReturnPct)}</span>
                  <small>Excess {pct(h.excessReturnPct)} · {h.trades} trades · WF {pct(h.stabilityPct)} · {h.eligible ? "PASS" : "FAIL"}</small>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className="card riskCard">
        <h2>Walidacja v0.4</h2>
        <div className="riskGrid">
          <div><span>OOS trades</span><b>≥ 8</b></div>
          <div><span>Walk-forward</span><b>≥ 2/3 dodatnie</b></div>
          <div><span>Profit factor</span><b>≥ 1,15</b></div>
          <div><span>OOS drawdown</span><b>≥ -12%</b></div>
          <div><span>OOS return</span><b>&gt; 0%</b></div>
          <div><span>Excess vs B&H</span><b>≥ 0%</b></div>
          <div><span>Ryzyko / pozycję</span><b>0,50%</b></div>
          <div><span>Live trading</span><b className="off">WYŁĄCZONY</b></div>
        </div>
        <p className="note">
          v0.4 celowo preferuje brak transakcji nad dopuszczenie słabo zweryfikowanej strategii.
          Wyniki historyczne nie gwarantują przyszłych rezultatów.
        </p>
      </section>

      <footer>
        v0.4 · multi-market validation · benchmark · strict paper gate · XTB niepołączony
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
