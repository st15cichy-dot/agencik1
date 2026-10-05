# Współpraca przy rozwoju agencik1

## Punkt startowy

Sprawdź `git status`, bieżący HEAD, ostatnie PR i istniejące workflow przed zmianami.
Aktualny produkt to Next.js i silnik JS (`lib/`, `scripts/`, `tests-js/`). Python
w `agent/` jest starszym rdzeniem; nie przenoś jego innych limitów do silnika JS.
Instrukcje i ograniczenia wydania opisuje [README_V018.md](README_V018.md).

## Role i przekazywanie pracy

- Koordynator uzgadnia zakres, wyznacza rozłączne pliki agentom i integruje zmiany.
- Agent implementacji pisze kod oraz opisuje kontrakt, ryzyka i zmienione pliki.
- Agent testów niezależnie sprawdza zachowanie, regresje, błędy i granice bezpieczeństwa.
- Agent przeglądu czyta końcowy diff, weryfikuje bezpieczniki i zgłasza konkretne błędy.

Używaj rzeczywistych agentów dostępnych w sesji. Gdy ich nie ma, zapisz w PR,
że poszczególne role wykonał ten sam wykonawca. Nie przedstawiaj skryptu ani
jobów CI jako niezależnych agentów AI. Nie dodawaj płatnych API, nowych usług
ani sekretów dla tego workflow. Unikaj równoczesnej edycji tych samych plików;
autor testów powinien otrzymać kontrakt, zanim implementacja będzie gotowa.

Przekazanie pracy zawiera SHA, listę zmienionych plików, komendy i wyniki testów,
otwarte problemy oraz zakres przeglądu. Recenzent musi obejrzeć końcowy diff.
Po poprawce ponów odpowiednie testy i przegląd zmienionego fragmentu. Raport
poprzedniej wersji nie jest dowodem dla nowej wersji.

## Weryfikacja i PR

`npm run verify-development` uruchamia testy JS i produkcyjny build oraz zapisuje
`.development-output/verification.json`. Raport wiąże wyniki z HEAD i odciskiem
plików roboczych. Różnica źródeł przed i po weryfikacji powoduje błąd; chwilowa
zmiana cofnięta przed końcem nie jest wykrywana, więc nie edytuj równolegle kodu. Raport CI
jest do pobrania jako artifact; niezależny przegląd kodu opisuje wykonawca w PR.
Stan `independentReview` w raporcie nie potwierdza wykonania przeglądu.

Przygotuj PR z opisem zachowania, wynikami weryfikacji, autorami ról, SHA
przeglądu i ograniczeniami pracy w tle. Samo przygotowanie PR nie oznacza merge
ani wdrożenia. Istniejące CI ma pozostać z uprawnieniem `contents: read`.

## Niezmienne bezpieczniki

- LIVE wyłączony; broker odłączony; adapter `NONE`; wysyłanie zleceń wyłączone.
- PAPER: 200 PLN, ryzyko 0,5%, maks. 3 pozycje, ekspozycja 100%, jedna pozycja
  maks. 50%, dzienny halt 2%, hard drawdown stop 10%. Koszty i slippage pozostają.
- Badania obejmują 16 rynków, PAPER tylko dotychczasowe 8. Pozostałe 8 to SHADOW.
- SHADOW, governance i allocation nie mają uprawnień do wykonania lub PAPER.
- Zachowaj regresję v0.17: odzyskana historyczna luka heartbeat to telemetria;
  bieżąca nieaktualność, naruszenie bezpieczeństwa i hard halt nadal alarmują.
- Nie publikuj sekretów ani danych rzeczywistych kont w repo, raportach lub pamięci.

Agenci sesji nie są usługą działającą po zakończeniu rozmowy. W tle pracują
wyłącznie już skonfigurowane GitHub Actions; nie obiecuj kolejnych zmian kodu
ani PR bez dostępnego wykonawcy.
