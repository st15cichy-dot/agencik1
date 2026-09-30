"use client";

import { useMemo, useState } from "react";

const opportunities = [
  { symbol: "SPY", market: "ETF", side: "WATCH", score: 78, horizon: "1–3 dni", reason: "trend + momentum" },
  { symbol: "BTC/USDT", market: "Krypto", side: "WATCH", score: 74, horizon: "intraday", reason: "wybicie zmienności" },
  { symbol: "AAPL", market: "Akcje", side: "WATCH", score: 69, horizon: "1–5 dni", reason: "siła względna" },
  { symbol: "XAU/USD", market: "Surowce", side: "WATCH", score: 65, horizon: "1–3 dni", reason: "trend średnioterminowy" },
];

const positions = [
  { symbol: "SPY", side: "LONG", entry: "592.20", now: "594.05", pnl: "+0.31%", risk: "0.50%" },
  { symbol: "BTC/USDT", side: "LONG", entry: "63 480", now: "63 920", pnl: "+0.69%", risk: "0.50%" },
];

const journal = [
  { time: "21:40", event: "Skan rynku", detail: "24 instrumenty, 4 kandydatów" },
  { time: "21:42", event: "Risk engine", detail: "Limity pozycji i dzienny limit strat: OK" },
  { time: "21:43", event: "Paper broker", detail: "Brak realnych zleceń — tryb symulacji" },
];

function Metric({ label, value, sub }) {
  return (
    <article className="metric">
      <div className="muted">{label}</div>
      <strong>{value}</strong>
      <small>{sub}</small>
    </article>
  );
}

export default function Home() {
  const [scanState, setScanState] = useState("Gotowy");
  const [lastScan, setLastScan] = useState("—");

  const scan = () => {
    setScanState("Skanowanie...");
    setTimeout(() => {
      setLastScan(new Date().toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" }));
      setScanState("Zakończono");
    }, 650);
  };

  const devFund = useMemo(() => "0,00 zł", []);

  return (
    <main>
      <header className="topbar">
        <div>
          <p className="eyebrow">AUTONOMICZNY INWESTOR · v0.1</p>
          <h1>Panel inwestycyjny</h1>
          <p className="muted">Research + paper trading + risk engine</p>
        </div>
        <div className="badges">
          <span className="badge safe">PAPER ONLY</span>
          <span className="badge">XTB: NIEPOŁĄCZONY</span>
          <span className="badge warn">DANE DEMO</span>
        </div>
      </header>

      <section className="warning">
        <strong>Realne transakcje są wyłączone.</strong>
        <span> Ta wersja służy do testowania logiki, strategii i kontroli ryzyka.</span>
      </section>

      <section className="metrics">
        <Metric label="Kapitał symulacyjny" value="200,00 zł" sub="saldo startowe" />
        <Metric label="P/L dzisiaj" value="+0,84 zł" sub="+0,42%" />
        <Metric label="P/L łącznie" value="+1,62 zł" sub="+0,81%" />
        <Metric label="Max drawdown" value="-1,30%" sub="paper portfolio" />
        <Metric label="Win rate" value="54,5%" sub="11 zamkniętych prób" />
        <Metric label="AI development fund" value={devFund} sub="10% zrealizowanego zysku netto" />
      </section>

      <section className="grid two">
        <article className="card">
          <div className="cardTitle">
            <div>
              <h2>Skaner okazji</h2>
              <p className="muted">Ranking demonstracyjny — bez danych live</p>
            </div>
            <button onClick={scan}>Uruchom skan</button>
          </div>
          <div className="scanline">
            <span>Status: <b>{scanState}</b></span>
            <span>Ostatni skan: <b>{lastScan}</b></span>
          </div>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Instrument</th><th>Rynek</th><th>Score</th><th>Horyzont</th><th>Sygnał</th>
                </tr>
              </thead>
              <tbody>
                {opportunities.map((x) => (
                  <tr key={x.symbol}>
                    <td><b>{x.symbol}</b></td>
                    <td>{x.market}</td>
                    <td>{x.score}/100</td>
                    <td>{x.horizon}</td>
                    <td>{x.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="card">
          <h2>Risk engine</h2>
          <div className="riskList">
            <div><span>Ryzyko na pozycję</span><b>0,50%</b></div>
            <div><span>Maks. otwartych pozycji</span><b>4</b></div>
            <div><span>Dzienny limit straty</span><b>2,00%</b></div>
            <div><span>Twardy drawdown stop</span><b>10,00%</b></div>
            <div><span>Live trading</span><b className="off">WYŁĄCZONY</b></div>
          </div>
          <p className="note">Warstwa ryzyka jest niezależna od modułu AI i nie może być wyłączona przez strategię.</p>
        </article>
      </section>

      <section className="grid two">
        <article className="card">
          <h2>Otwarte pozycje — paper</h2>
          <div className="tableWrap">
            <table>
              <thead>
                <tr><th>Symbol</th><th>Strona</th><th>Wejście</th><th>Teraz</th><th>P/L</th><th>Ryzyko</th></tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={p.symbol}>
                    <td><b>{p.symbol}</b></td><td>{p.side}</td><td>{p.entry}</td><td>{p.now}</td><td className="positive">{p.pnl}</td><td>{p.risk}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="card">
          <h2>Pamięć / dziennik decyzji</h2>
          <div className="journal">
            {journal.map((x) => (
              <div className="journalItem" key={x.time + x.event}>
                <time>{x.time}</time>
                <div><b>{x.event}</b><p>{x.detail}</p></div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="card roadmap">
        <h2>Następne moduły</h2>
        <div className="roadGrid">
          <div><b>1. Dane rynkowe</b><span>cache + darmowe źródła</span></div>
          <div><b>2. Backtesting</b><span>koszty, spread, slippage</span></div>
          <div><b>3. Walk-forward</b><span>out-of-sample + ranking</span></div>
          <div><b>4. Paper broker</b><span>automatyczne testy strategii</span></div>
          <div><b>5. AI research</b><span>batched calls, bez per-tick LLM</span></div>
          <div><b>6. XTB</b><span>dopiero po walidacji integracji</span></div>
        </div>
      </section>

      <footer>
        Autonomiczny Inwestor · wersja demonstracyjna · bez gwarancji wyniku inwestycyjnego
      </footer>
    </main>
  );
}
