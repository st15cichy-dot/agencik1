"use client";

import { useEffect, useMemo, useState } from "react";

const STARTING_CAPITAL = 200;
const RISK_PER_TRADE = 0.005;
const AUTO_SCREEN_AFTER_MS = 6 * 60 * 60 * 1000;

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

  const [screen, setScreen] = useState(null);
  const [screenLoading, setScreenLoading] = useState(false);

  const [lab, setLab] = useState(null);
  const [labLoading, setLabLoading] = useState(false);

  const [paper, setPaper] = useState([]);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem("ai-paper-v05") || "[]");
      const h = JSON.parse(localStorage.getItem("ai-lab-history-v05") || "[]");
      const s = JSON.parse(localStorage.getItem("ai-screen-v05") || "null");
      if (Array.isArray(p)) setPaper(p);
      if (Array.isArray(h)) setHistory(h);
      if (s && typeof s === "object") setScreen(s);
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem("ai-paper-v05", JSON.stringify(paper));
  }, [paper]);

  useEffect(() => {
    localStorage.setItem("ai-lab-history-v05", JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    if (screen) localStorage.setItem("ai-screen-v05", JSON.stringify(screen));
  }, [screen]);

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

  async function runScreen() {
    setScreenLoading(true);
    try {
      const r = await fetch("/api/lab-all", { cache: "no-store" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "Screening niedostępny");
      setScreen(data);
      localStorage.setItem("ai-screen-last-run-v05", String(Date.now()));
    } catch (e) {
      setScreen({ error: e.message });
    } finally {
      setScreenLoading(false);
    }
  }

  useEffect(() => {
    const last = Number(localStorage.getItem("ai-screen-last-run-v05") || 0);
    if (!last || Date.now() - last >= AUTO_SCREEN_AFTER_MS) runScreen();
  }, []);

  async function runDeepLab(symbol = selected) {
    setSelected(symbol);
    setLabLoading(true);
    setLab(null);

    try {
      const r = await fetch(`/api/lab?symbol=${symbol}`, { cache: "no-store" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "Deep lab niedostępny");
      setLab(data);

      const chosen =
        data.ranking?.find((x) => x.id === data.candidate?.strategyId) ||
        data.ranking?.[0];

      setHistory((h) => [{
        id: `${symbol}-${Date.now()}`,
        symbol,
        generatedAt: data.generatedAt,
        strategy: chosen?.name,
        returnPct: chosen?.final?.totalReturnPct,
        exposureExcessPct: chosen?.final?.excessVsExposureBenchmarkPct,
        trades: chosen?.final?.trades,
        sharpe: chosen?.final?.sharpe,
        calmar: chosen?.final?.calmar,
        stabilityPct: chosen?.walkForward?.parameterStabilityPct,
        eligible: data.candidate?.eligible,
        signalNow: data.candidate?.signalNow,
      }, ...h].slice(0, 100));
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

  const chosen = useMemo(() => {
    if (!lab?.ranking?.length) return null;
    return lab.ranking.find((x) => x.id === lab.candidate?.strategyId) || lab.ranking[0];
  }, [lab]);

  function addPaperCandidate() {
    if (!lab?.candidate?.paperReady || !selectedRow || !chosen) return;

    const atrStopPct = Math.max(1, Math.min(5, (selectedRow.atrPct || 1) * 2));
    const riskPln = STARTING_CAPITAL * RISK_PER_TRADE;
    const positionPln = Math.min(STARTING_CAPITAL, riskPln / (atrStopPct / 100));

    setPaper((p) => [{
      id: `${selected}-${Date.now()}`,
      symbol: selected,
      strategy: chosen.name,
      config: chosen.config,
      entry: selectedRow.price,
      stop: selectedRow.price * (1 - atrStopPct / 100),
      stopPct: atrStopPct,
      riskPln,
      positionPln,
      createdAt: new Date().toISOString(),
      source: "v0.5 deep-validated candidate",
    }, ...p].slice(0, 100));
  }

  function exportResearch() {
    const blob = new Blob(
      [JSON.stringify({
        version: "0.5.0",
        exportedAt: new Date().toISOString(),
        screen,
        lastDeepLab: lab,
        paper,
        history,
      }, null, 2)],
      { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `autonomiczny-inwestor-v05-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main>
      <header className="topbar">
        <div>
          <p className="eyebrow">AUTONOMICZNY INWESTOR · v0.5</p>
          <h1>Research Quality Engine</h1>
          <p className="muted">Deep OOS + purged walk-forward + regime analysis + exposure benchmark</p>
        </div>
        <div className="badges">
          <span className="badge safe">PAPER ONLY</span>
          <span className="badge">XTB: NIEPOŁĄCZONY</span>
          <span className="badge live">BINANCE LIVE</span>
        </div>
      </header>

      <section className="warning">
        <strong>Brak wymuszania transakcji.</strong>
        <span> Screening wybiera tylko kandydatów do głębokiego testu; paper wymaga osobnego Deep PASS + aktywnego LONG.</span>
      </section>

      <section className="metrics">
        <Metric label="Deep historia" value="5000 h" sub="~208 dni" />
        <Metric label="Final OOS" value="30%" sub="nieużywany do strojenia" />
        <Metric label="Purge gap" value="24 h" sub="między train i test" />
        <Metric label="Reżimy" value="3" sub="final OOS" />
        <Metric label="Ryzyko / trade" value={money(STARTING_CAPITAL * RISK_PER_TRADE)} sub="0,50%" />
        <Metric label="Live trading" value="OFF" sub="XTB niepołączony" />
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
            <h2>Etap 1 · All-market screening</h2>
            <p className="muted">3000 świec / instrument. PASS oznacza tylko „warto zrobić Deep Lab”.</p>
          </div>
          <button onClick={runScreen} disabled={screenLoading}>
            {screenLoading ? "Screening 8 rynków…" : "Uruchom screening"}
          </button>
        </div>

        {screen?.error && <div className="errorBox">{screen.error}</div>}
        {!screen && <div className="placeholder">Oczekiwanie na pierwszy screening.</div>}

        {screen && !screen.error && (
          <>
            <div className="screenSummary">
              <Metric label="Przeanalizowano" value={String(screen.successful)} sub={`z ${screen.analyzed}`} />
              <Metric label="Deep-check" value={String(screen.deepCheckCandidates?.length || 0)} sub="screen PASS" />
              <Metric label="Ostatni run" value={new Date(screen.generatedAt).toLocaleTimeString("pl-PL")} sub={new Date(screen.generatedAt).toLocaleDateString("pl-PL")} />
            </div>

            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Instrument</th><th>Strategia</th><th>OOS</th><th>Exposure bench</th>
                    <th>Excess</th><th>DD</th><th>PF</th><th>Sharpe</th><th>Trades</th>
                    <th>WF</th><th>Stabilność</th><th>Screen</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {(screen.ranking || []).map((r) => (
                    <tr key={r.symbol}>
                      <td><b>{r.symbol}</b></td>
                      <td>{r.strategy}</td>
                      <td className={r.oosReturnPct >= 0 ? "positive" : "negative"}>{pct(r.oosReturnPct)}</td>
                      <td>{pct(r.exposureBenchmarkPct)}</td>
                      <td className={r.exposureExcessPct >= 0 ? "positive" : "negative"}>{pct(r.exposureExcessPct)}</td>
                      <td>{pct(r.drawdownPct)}</td>
                      <td>{num(r.profitFactor, 2)}</td>
                      <td>{num(r.sharpe, 2)}</td>
                      <td>{r.trades}</td>
                      <td>{r.wfPositive}/{r.wfTotal}</td>
                      <td>{pct(r.parameterStabilityPct)}</td>
                      <td><span className={`signal ${r.screenPass ? "good" : "bad"}`}>{r.screenPass ? "PASS" : "FAIL"}</span></td>
                      <td>
                        <button className="smallBtn" onClick={() => runDeepLab(r.symbol)}>
                          Deep lab
                        </button>
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
            <h2>Etap 2 · Deep Lab · {selected}</h2>
            <p className="muted">5000 świec · 70% development / 30% final OOS · anchored + 24h purge</p>
          </div>
          <button onClick={() => runDeepLab(selected)} disabled={labLoading || !selectedRow}>
            {labLoading ? "Głęboka walidacja…" : `Deep lab ${selected}`}
          </button>
        </div>

        {!lab && <div className="placeholder">Uruchom głęboką walidację wybranego instrumentu.</div>}
        {lab?.error && <div className="errorBox">{lab.error}</div>}

        {lab && !lab.error && chosen && (
          <>
            <div className="labSummary">
              <div><span>Wybrana strategia</span><b>{chosen.name}</b><small>{cfg(chosen.config)}</small></div>
              <div><span>Final OOS</span><b className={chosen.final.totalReturnPct >= 0 ? "positive" : "negative"}>{pct(chosen.final.totalReturnPct)}</b><small>{chosen.final.trades} transakcji</small></div>
              <div><span>Raw B&H</span><b>{pct(chosen.final.benchmarkPct)}</b><small>pełna ekspozycja</small></div>
              <div><span>Exposure benchmark</span><b>{pct(chosen.final.exposureBenchmarkPct)}</b><small>ekspozycja {pct(chosen.final.exposurePct)}</small></div>
              <div><span>Excess</span><b className={chosen.final.excessVsExposureBenchmarkPct >= 0 ? "positive" : "negative"}>{pct(chosen.final.excessVsExposureBenchmarkPct)}</b><small>vs exposure benchmark</small></div>
              <div><span>Deep gate</span><b>{lab.candidate.eligible ? "PASS" : "FAIL"}</b><small>{chosen.gate.passedCount}/{chosen.gate.totalChecks} kryteriów</small></div>
            </div>

            <div className="metricStrip">
              <Metric label="Max DD" value={pct(chosen.final.maxDrawdownPct)} sub="final OOS" />
              <Metric label="Profit Factor" value={num(chosen.final.profitFactor, 2)} sub="final OOS" />
              <Metric label="Sharpe" value={num(chosen.final.sharpe, 2)} sub="annualizowany 1h" />
              <Metric label="Calmar" value={num(chosen.final.calmar, 2)} sub="ann. return / DD" />
              <Metric label="WF dodatnie" value={`${chosen.walkForward.positiveFolds}/${chosen.walkForward.totalFolds}`} sub="purged" />
              <Metric label="Param. stability" value={pct(chosen.walkForward.parameterStabilityPct)} sub="wybrany config" />
            </div>

            <div className="gateGrid">
              {Object.entries(chosen.gate.checks).map(([key, value]) => (
                <div key={key} className={value ? "gatePass" : "gateFail"}>
                  <span>{value ? "✓" : "×"}</span><b>{key}</b>
                </div>
              ))}
            </div>

            <h3>Reżimy final OOS</h3>
            <div className="tableWrap compact">
              <table>
                <thead>
                  <tr>
                    <th>#</th><th>Reżim</th><th>Zmienność</th><th>Rynek</th>
                    <th>Strategia</th><th>DD</th><th>Trades</th>
                  </tr>
                </thead>
                <tbody>
                  {chosen.regimes.segments.map((r) => (
                    <tr key={r.index}>
                      <td>{r.index}</td>
                      <td><b>{r.regime}</b></td>
                      <td>{r.volatility} · {pct(r.volPct)}</td>
                      <td>{pct(r.benchmarkPct)}</td>
                      <td className={r.result.totalReturnPct >= 0 ? "positive" : "negative"}>{pct(r.result.totalReturnPct)}</td>
                      <td>{pct(r.result.maxDrawdownPct)}</td>
                      <td>{r.result.trades}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3>Ranking rodzin strategii</h3>
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th><th>Strategia</th><th>Config</th><th>OOS</th><th>Exposure bench</th>
                    <th>Excess</th><th>DD</th><th>PF</th><th>Sharpe</th><th>Calmar</th>
                    <th>Trades</th><th>WF</th><th>Stability</th><th>Gate</th><th>Sygnał</th>
                  </tr>
                </thead>
                <tbody>
                  {lab.ranking.map((r, i) => (
                    <tr key={r.id}>
                      <td>{i + 1}</td>
                      <td><b>{r.name}</b></td>
                      <td>{cfg(r.config)}</td>
                      <td className={r.final.totalReturnPct >= 0 ? "positive" : "negative"}>{pct(r.final.totalReturnPct)}</td>
                      <td>{pct(r.final.exposureBenchmarkPct)}</td>
                      <td className={r.final.excessVsExposureBenchmarkPct >= 0 ? "positive" : "negative"}>{pct(r.final.excessVsExposureBenchmarkPct)}</td>
                      <td>{pct(r.final.maxDrawdownPct)}</td>
                      <td>{num(r.final.profitFactor, 2)}</td>
                      <td>{num(r.final.sharpe, 2)}</td>
                      <td>{num(r.final.calmar, 2)}</td>
                      <td>{r.final.trades}</td>
                      <td>{r.walkForward.positiveFolds}/{r.walkForward.totalFolds}</td>
                      <td>{pct(r.walkForward.parameterStabilityPct)}</td>
                      <td><span className={`signal ${r.eligible ? "good" : "bad"}`}>{r.eligible ? "PASS" : "FAIL"}</span></td>
                      <td>{r.signalNow}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={`candidateBox ${lab.candidate.paperReady ? "pass" : "fail"}`}>
              <div>
                <b>{lab.candidate.paperReady ? "PAPER READY" : lab.candidate.eligible ? "DEEP PASS, BRAK LONG" : "DEEP FAIL"}</b>
                <p>
                  {lab.candidate.paperReady
                    ? "Strategia przeszła walidację i ma aktywny sygnał LONG."
                    : lab.candidate.eligible
                      ? "Strategia przeszła walidację, ale aktualnie nie ma wejścia LONG."
                      : "Nie spełniono wszystkich kryteriów Deep Lab."}
                </p>
              </div>
              <button onClick={addPaperCandidate} disabled={!lab.candidate.paperReady}>
                Dodaj do paper
              </button>
            </div>
          </>
        )}
      </section>

      <section className="grid two">
        <article className="card">
          <div className="cardTitle">
            <div>
              <h2>Paper candidates</h2>
              <p className="muted">Tylko Deep PASS + aktywny LONG.</p>
            </div>
            <button onClick={exportResearch}>Eksport JSON</button>
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
          <h2>Historia Deep Lab</h2>
          <p className="muted">Do 100 ostatnich uruchomień w tej przeglądarce.</p>
          {history.length === 0 ? (
            <div className="placeholder">Brak historii.</div>
          ) : (
            <div className="historyList">
              {history.slice(0, 10).map((h) => (
                <div key={h.id}>
                  <span><b>{h.symbol}</b> · {h.strategy}</span>
                  <span className={h.returnPct >= 0 ? "positive" : "negative"}>{pct(h.returnPct)}</span>
                  <small>
                    Excess {pct(h.exposureExcessPct)} · {h.trades} trades · Sharpe {num(h.sharpe, 2)} ·
                    Stability {pct(h.stabilityPct)} · {h.eligible ? "PASS" : "FAIL"} · {h.signalNow}
                  </small>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className="card riskCard">
        <h2>Co poprawia v0.5</h2>
        <div className="riskGrid">
          <div><span>Dane Deep</span><b>5000 świec 1h</b></div>
          <div><span>Untouched final OOS</span><b>30%</b></div>
          <div><span>Walk-forward</span><b>anchored + purge 24h</b></div>
          <div><span>Benchmark</span><b>raw + exposure-adjusted</b></div>
          <div><span>Metryki</span><b>Sharpe + Calmar</b></div>
          <div><span>Parametry</span><b>stability across folds</b></div>
          <div><span>Reżimy</span><b>3 segmenty OOS</b></div>
          <div><span>Live trading</span><b className="off">WYŁĄCZONY</b></div>
        </div>
      </section>

      <footer>
        v0.5 · research-first · final OOS · purged walk-forward · paper only
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
