"use client";

import { useEffect, useMemo, useState } from "react";

const STARTING_CAPITAL = 200;
const RISK_PER_TRADE = 0.005;
const AUTO_SCREEN_AFTER_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MEMORY_URL =
  "https://raw.githubusercontent.com/st15cichy-dot/agencik1/research-data/latest.json";
const MEMORY_URL =
  process.env.NEXT_PUBLIC_AUTONOMOUS_MEMORY_URL || DEFAULT_MEMORY_URL;

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
  const [autoMemory, setAutoMemory] = useState(null);
  const [autoMemoryError, setAutoMemoryError] = useState("");
  const [autoMemoryLoading, setAutoMemoryLoading] = useState(false);

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
      source: "manual browser sandbox v0.7",
    }, ...p].slice(0, 100));
  }

  function exportResearch() {
    const blob = new Blob(
      [JSON.stringify({
        version: "0.6.0",
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
    a.download = `autonomiczny-inwestor-v07-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }


async function refreshAutonomousMemory() {
  setAutoMemoryLoading(true);
  setAutoMemoryError("");

  try {
    const separator = MEMORY_URL.includes("?") ? "&" : "?";
    const r = await fetch(`${MEMORY_URL}${separator}ts=${Date.now()}`, {
      cache: "no-store",
    });

    if (!r.ok) {
      throw new Error(
        r.status === 404
          ? "Brak gałęzi research-data — uruchom workflow Autonomous research heartbeat po wdrożeniu v0.7."
          : `HTTP ${r.status}`
      );
    }

    const data = await r.json();
    setAutoMemory(data);
  } catch (error) {
    setAutoMemoryError(error?.message || String(error));
  } finally {
    setAutoMemoryLoading(false);
  }
}

useEffect(() => {
  refreshAutonomousMemory();
  const id = setInterval(refreshAutonomousMemory, 10 * 60 * 1000);
  return () => clearInterval(id);
}, []);

  return (
    <main>
      <header className="topbar">
        <div>
          <p className="eyebrow">AUTONOMICZNY INWESTOR · v0.7</p>
          <h1>Research Quality Engine</h1>
          <p className="muted">Autonomous research + paper portfolio + hard risk engine</p>
        </div>
        <div className="badges">
          <span className="badge safe">PAPER ONLY</span>
          <span className="badge">XTB: NIEPOŁĄCZONY</span>
          <span className="badge live">BINANCE LIVE</span>
        </div>
      </header>

      <section className="warning">
        <strong>Realne zlecenia są wyłączone.</strong>
        <span> v0.7 może sam otwierać i zamykać wyłącznie pozycje PAPER po Deep PASS + aktywnym wejściu LONG.</span>
      </section>

      <section className="metrics">
        <Metric label="Paper equity" value={money(autoMemory?.paperPortfolio?.equityPln ?? STARTING_CAPITAL)} sub="kapitał symulacyjny" />
        <Metric label="Otwarte paper" value={String(autoMemory?.paperPortfolio?.openPositionsCount ?? 0)} sub="maks. 3" />
        <Metric label="P/L paper" value={money(autoMemory?.paperPortfolio?.totalPnlPln ?? 0)} sub={pct(autoMemory?.paperPortfolio?.totalReturnPct ?? 0)} />
        <Metric label="Portfolio DD" value={pct(autoMemory?.paperPortfolio?.drawdownPct ?? 0)} sub="hard stop -10%" />
        <Metric label="Ryzyko / trade" value={money((autoMemory?.paperPortfolio?.equityPln ?? STARTING_CAPITAL) * RISK_PER_TRADE)} sub="0,50%" />
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


<section className="card autonomousCard">
  <div className="cardTitle">
    <div>
      <h2>Autonomous research memory</h2>
      <p className="muted">
        Wyniki generowane poza przeglądarką przez GitHub Actions. Ta sekcja działa nawet,
        gdy panel był zamknięty.
      </p>
    </div>
    <button onClick={refreshAutonomousMemory} disabled={autoMemoryLoading}>
      {autoMemoryLoading ? "Pobieranie…" : "Odśwież pamięć"}
    </button>
  </div>

  {autoMemoryError && <div className="errorBox">{autoMemoryError}</div>}

  {!autoMemory && !autoMemoryError && (
    <div className="placeholder">Oczekiwanie na pierwszy autonomiczny heartbeat.</div>
  )}

  {autoMemory && (
    <>
      <div className="screenSummary">
        <Metric
          label="Ostatni heartbeat"
          value={new Date(autoMemory.completedAt).toLocaleTimeString("pl-PL")}
          sub={new Date(autoMemory.completedAt).toLocaleDateString("pl-PL")}
        />
        <Metric
          label="Screen PASS"
          value={String(autoMemory.screenPass?.length || 0)}
          sub={(autoMemory.screenPass || []).join(", ") || "brak"}
        />
        <Metric
          label="Deep PASS"
          value={String(autoMemory.deepPass?.length || 0)}
          sub={(autoMemory.deepPass || []).join(", ") || "brak"}
        />
      </div>

      <div className="memoryStatus">
        <span className="badge safe">BACKGROUND RESEARCH: ON</span>
        <span className="badge">BROKER: OFF</span>
        <span className="badge">PUBLIC RESEARCH MEMORY</span>
      </div>

      {(autoMemory.deep || []).length > 0 ? (
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Instrument</th><th>Strategia</th><th>OOS</th><th>Excess</th>
                <th>DD</th><th>Trades</th><th>Deep</th><th>Sygnał</th><th>Paper-ready</th>
              </tr>
            </thead>
            <tbody>
              {autoMemory.deep.map((x) => (
                <tr key={x.symbol}>
                  <td><b>{x.symbol}</b></td>
                  <td>{x.strategy}</td>
                  <td className={x.returnPct >= 0 ? "positive" : "negative"}>{pct(x.returnPct)}</td>
                  <td className={x.excessPct >= 0 ? "positive" : "negative"}>{pct(x.excessPct)}</td>
                  <td>{pct(x.drawdownPct)}</td>
                  <td>{x.trades}</td>
                  <td>
                    <span className={`signal ${x.eligible ? "good" : "bad"}`}>
                      {x.eligible ? "PASS" : "FAIL"}
                    </span>
                  </td>
                  <td>{x.signalNow}</td>
                  <td>{x.paperReady ? "TAK" : "NIE"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="placeholder">W ostatnim heartbeat screening nie wybrał kandydatów do Deep Lab.</div>
      )}


{autoMemory.paperPortfolio && (
  <div className="paperAuto">
    <div className="sectionDivider" />
    <div className="cardTitle">
      <div>
        <h3>Autonomous paper portfolio</h3>
        <p className="muted">
          Pozycje są symulowane i zarządzane przez heartbeat. Brak połączenia z brokerem.
        </p>
      </div>
      <span className={`signal ${autoMemory.paperPortfolio.halted ? "bad" : "good"}`}>
        {autoMemory.paperPortfolio.halted
          ? "HARD HALT"
          : autoMemory.paperPortfolio.dailyHalt
            ? "DAILY HALT"
            : "ACTIVE"}
      </span>
    </div>

    <div className="metricStrip">
      <Metric label="Equity" value={money(autoMemory.paperPortfolio.equityPln)} sub="paper PLN" />
      <Metric label="Cash" value={money(autoMemory.paperPortfolio.cashPln)} sub="wolne środki" />
      <Metric label="Realized" value={money(autoMemory.paperPortfolio.realizedPnlPln)} sub="zamknięte pozycje" />
      <Metric label="Unrealized" value={money(autoMemory.paperPortfolio.unrealizedPnlPln)} sub="otwarte pozycje" />
      <Metric label="Daily P/L" value={pct(autoMemory.paperPortfolio.dailyPnlPct)} sub="halt przy -2%" />
      <Metric label="Win rate" value={pct(autoMemory.paperPortfolio.winRatePct)} sub={`${autoMemory.paperPortfolio.closedTradesCount} zamkniętych`} />
    </div>

    {(autoMemory.paperPortfolio.openPositions || []).length > 0 ? (
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Symbol</th><th>Strategia</th><th>Wejście</th><th>Teraz</th>
              <th>Stop</th><th>Notional</th><th>Ryzyko</th><th>P/L</th><th>Max hold</th>
            </tr>
          </thead>
          <tbody>
            {autoMemory.paperPortfolio.openPositions.map((p) => (
              <tr key={p.id}>
                <td><b>{p.symbol}</b></td>
                <td>{p.strategy}</td>
                <td>{num(p.entryPrice, p.entryPrice < 10 ? 4 : 2)}</td>
                <td>{num(p.currentPrice, p.currentPrice < 10 ? 4 : 2)}</td>
                <td>{num(p.stopPrice, p.stopPrice < 10 ? 4 : 2)} · {pct(-p.stopPct)}</td>
                <td>{money(p.notionalPln)}</td>
                <td>{money(p.riskPln)}</td>
                <td className={p.unrealizedPnlPln >= 0 ? "positive" : "negative"}>
                  {money(p.unrealizedPnlPln)} · {pct(p.pnlPct)}
                </td>
                <td>{new Date(p.maxHoldUntil).toLocaleString("pl-PL")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <div className="placeholder">Brak otwartych autonomicznych pozycji paper.</div>
    )}

    {(autoMemory.paperPortfolio.recentClosedTrades || []).length > 0 && (
      <>
        <h3>Ostatnio zamknięte paper</h3>
        <div className="tableWrap compact">
          <table>
            <thead>
              <tr><th>Symbol</th><th>Strategia</th><th>P/L</th><th>Zwrot</th><th>Czas</th><th>Powód</th></tr>
            </thead>
            <tbody>
              {autoMemory.paperPortfolio.recentClosedTrades.map((t, i) => (
                <tr key={`${t.symbol}-${t.closedAt}-${i}`}>
                  <td><b>{t.symbol}</b></td>
                  <td>{t.strategy}</td>
                  <td className={t.pnlPln >= 0 ? "positive" : "negative"}>{money(t.pnlPln)}</td>
                  <td>{pct(t.returnPct)}</td>
                  <td>{num(t.holdingHours, 1)} h</td>
                  <td>{t.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    )}
  </div>
)}

      {(autoMemory.events || []).length > 0 && (
        <div className="eventList">
          <h3>Nowe zdarzenia</h3>
          {autoMemory.events.map((event, i) => (
            <div key={`${event.type}-${event.symbol}-${i}`}>
              <b>{event.type}</b>
              <span>{event.message}</span>
            </div>
          ))}
        </div>
      )}
    </>
  )}
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
              <Metric label="Sharpe (ann.)" value={num(chosen.final.sharpe, 2)} sub={`${num(chosen.final.durationDays, 0)} dni${chosen.final.sharpeShortSample ? " · krótka próba" : ""}`} />
              <Metric label="Calmar" value={chosen.final.calmar == null ? "N/A" : num(chosen.final.calmar, 2)} sub={chosen.final.calmar == null ? "wymaga ≥180 dni" : "annualized return / DD"} />
              <Metric label="Return / DD" value={num(chosen.final.returnToDrawdown, 2)} sub="bez annualizacji" />
              <Metric label="Param. stability" value={pct(chosen.walkForward.parameterStabilityPct)} sub="wybrany config" />
            </div>

            <div className="gateGrid">
              {Object.entries(chosen.gate?.checks || {}).map(([key, value]) => (
                <div key={key} className={value ? "gatePass" : "gateFail"}>
                  <span>{value ? "✓" : "×"}</span><b>{key}</b>
                </div>
              ))}
            </div>

            <h3>Historical regime robustness</h3>
            <p className="muted">
              Okna 20-dniowe z całej dostępnej historii Deep. To raport diagnostyczny — nie zmienia gate,
              żeby nie mieszać danych development z final OOS.
            </p>
            <div className="tableWrap compact">
              <table>
                <thead>
                  <tr>
                    <th>Reżim</th><th>Okna</th><th>Śr. rynek</th><th>Śr. strategia</th>
                    <th>Śr. excess</th><th>Najgorszy DD</th><th>Dodatnie okna</th>
                  </tr>
                </thead>
                <tbody>
                  {(chosen.regimeRobustness?.summary || []).map((r) => (
                    <tr key={r.regime}>
                      <td><b>{r.regime}</b></td>
                      <td>{r.windows}</td>
                      <td>{r.avgMarketPct == null ? "—" : pct(r.avgMarketPct)}</td>
                      <td className={r.avgStrategyPct >= 0 ? "positive" : "negative"}>
                        {r.avgStrategyPct == null ? "—" : pct(r.avgStrategyPct)}
                      </td>
                      <td className={r.avgExcessPct >= 0 ? "positive" : "negative"}>
                        {r.avgExcessPct == null ? "—" : pct(r.avgExcessPct)}
                      </td>
                      <td>{r.worstDrawdownPct == null ? "—" : pct(r.worstDrawdownPct)}</td>
                      <td>{r.windows ? `${r.positiveWindows}/${r.windows} · ${pct(r.positivePct)}` : "—"}</td>
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
                Dodaj ręcznie
              </button>
            </div>
          </>
        )}
      </section>

      <section className="grid two">
        <article className="card">
          <div className="cardTitle">
            <div>
              <h2>Manual paper sandbox</h2>
              <p className="muted">Lokalny, ręczny sandbox w przeglądarce. Nie jest częścią autonomicznego portfolio v0.7.</p>
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
        <h2>Co dodaje v0.7</h2>
        <div className="riskGrid">
          <div><span>Autonomous paper</span><b>wejścia + wyjścia</b></div>
          <div><span>Heartbeat</span><b>co 2 h + signal window</b></div>
          <div><span>Stan portfolio</span><b>paper.json</b></div>
          <div><span>Max pozycje</span><b>3</b></div>
          <div><span>Stop</span><b>2×ATR · 1–5%</b></div>
          <div><span>Dzienny halt</span><b>-2%</b></div>
          <div><span>Hard DD stop</span><b>-10%</b></div>
          <div><span>Live trading</span><b className="off">WYŁĄCZONY</b></div>
        </div>
      </section>

      <footer>
        v0.7 · autonomous paper portfolio · persistent trade journal · live trading OFF
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
