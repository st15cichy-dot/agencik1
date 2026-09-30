# Autonomiczny Inwestor v0.4

## Główne zmiany
- ostrzejszy paper gate:
  - minimum 8 transakcji OOS,
  - minimum 2/3 dodatnich foldów walk-forward,
  - profit factor >= 1.15,
  - max drawdown OOS nie gorszy niż -12%,
  - dodatni zwrot OOS,
  - strategia musi co najmniej dorównać buy-and-hold na tej samej próbce,
- jawny benchmark buy-and-hold i excess return,
- mocniejsza kara scoringowa za małą liczbę transakcji,
- analiza wszystkich 8 instrumentów jednym przyciskiem,
- automatyczny all-market research po otwarciu panelu, jeśli ostatni run był >= 6 h temu,
- osobna lista paper-ready,
- do 100 wpisów historii lokalnej,
- eksport JSON historii + paper candidates + ostatniego all-market research.

## Ważne ograniczenie
Automatyczny research w v0.4 działa podczas korzystania z panelu i przy jego otwarciu.
Nie jest to jeszcze trwały proces 24/7, ponieważ nie dodajemy jeszcze zewnętrznego storage/auth.
Pełna praca 24/7 wymaga trwałego backendu i magazynu wyników.

## Upload
Do katalogu głównego repozytorium wgraj/nadpisz:
- package.json
- next.config.mjs
- app/
- lib/

Vercel automatycznie wdroży main.
