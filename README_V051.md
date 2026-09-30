# Autonomiczny Inwestor v0.5.1

Patch metodologiczny do v0.5.

## Zmiany
- Historyczne reżimy nie są już tworzone wyłącznie z final OOS.
- Wybrana konfiguracja strategii jest sprawdzana diagnostycznie na 20-dniowych oknach
  z całej dostępnej historii Deep:
  - BULL
  - BEAR
  - RANGE
- Raport pokazuje liczbę okien, średni wynik rynku, średni wynik strategii,
  średni excess względem benchmarku skorygowanego o ekspozycję,
  najgorszy drawdown i odsetek dodatnich okien.
- Regime robustness jest celowo DIAGNOSTIC ONLY i nie wchodzi do gate,
  żeby dane development nie stały się ukrytym dodatkowym OOS.
- Calmar nie jest już raportowany dla próbek krótszych niż 180 dni.
- Dodano Return/DD bez annualizacji.
- Sharpe nadal jest annualizowany, ale interfejs ostrzega o krótkiej próbie (<90 dni).
- Wpływ Sharpe na scoring został ograniczony.

## Bramki PASS
Nie zostały poluzowane.
Live trading pozostaje wyłączony.
