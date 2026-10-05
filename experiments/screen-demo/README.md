# Eksperyment ekranu: lokalny PAPER MOCK

Ten prototyp otwiera **własną makietę**, robi zrzut jej widocznego obszaru,
odczytuje obraz lokalnym Tesseract OCR i wysyła pojedyncze kliknięcie do jej
Canvas. Drugi świeży obraz musi pokazać zgodne `STATE FILLED` i dane intencji.
Zakup/sprzedaż zmienia tylko fikcyjne pozycje w pamięci makiety, początkowo
5 sztuk AAPL. Cena fikcyjnego wykonania wynosi 100 jednostek; nie jest ceną
giełdową. Nie ma konta brokera, sieci, prawdziwych pieniędzy ani płatnego API.

**Stan weryfikacji:** na Linux sprawdzamy faktyczne PNG → Tesseract → decyzję
i drugie PNG → potwierdzenie, z kontrolowanym wykonawcą kliknięcia.
Natywne Windows, ImageGrab, HWND i obsługa kliknięć wymagają próby na Windows:
`NativeWindows UNTESTED`. Wynik makiety nie potwierdza integracji z XTB,
gotowości LIVE ani zysku. Główna aplikacja i jej PAPER/SHADOW pozostają osobne.

## Uruchomienie na Windows 10/11

Wymagane: Python 3.11 lub nowszy z Tcl/Tk, Pillow oraz bezpłatny Tesseract
z językiem `eng`. Tesseract jest osobnym programem: wybierz instalator Windows
ze źródła wskazanego w [dokumentacji Tesseract](https://tesseract-ocr.github.io/tessdoc/Installation.html).
Wykonawca nie loguje się do usług. Launcher instaluje Pillow z PyPI w lokalnym
środowisku `.venv`; Python i Tesseract należy zainstalować wcześniej.

W tym katalogu możesz uruchomić `URUCHOM_DEMO.cmd` albo wykonać w terminalu:

```bat
py -3 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe screen_demo.py --demo
```

Jeżeli Tesseract nie jest w PATH:

```bat
.venv\Scripts\python.exe screen_demo.py --demo --tesseract "C:\Program Files\Tesseract-OCR\tesseract.exe"
```

Pozostaw całe okno widoczne. Kliknij **Run ONE screenshot/OCR/mock click**.
Prawidłowy wynik to jedno fikcyjne wykonanie i widoczny stan `FILLED`.
Samodzielne kliknięcie zielonego pola nie składa zlecenia: przycisk jest
uzbrajany wyłącznie na czas zweryfikowanego wywołania wykonawcy.
`ESC` i czerwony `STOP` zatrzymują wykonawcę; interfejs obsługuje je także
podczas OCR. Brak Tcl/Tk albo Tesseract oznacza błąd z instrukcją instalacji.

Domyślnie obrazy i trwały dziennik znajdują się w ignorowanym katalogu
repozytorium `.development-output/screen-demo`. Dziennik Windows to
`native-execution.jsonl`; obrazy to `native-before.png` i `native-after.png`.
Potwierdzona intencja nie może zostać ponownie wysłana. Po `HALT` ponowne
uruchomienie z tym samym dziennikiem pozostaje zatrzymane. Nie ma
automatycznego resetowania ani ponawiania niepewnego zlecenia.

Oddzielną próbę SELL w fikcyjnym środowisku uruchom z nowym ID i osobnym
dziennikiem (makieta rozpoczyna każdą sesję od 5 fikcyjnych AAPL):

```bat
.venv\Scripts\python.exe screen_demo.py --demo --side SELL --intent DEMO002 --log "..\..\.development-output\screen-demo\sell-test.jsonl"
```

Każda próba wykonuje jedną intencję operatora. Prototyp nie wybiera strategii
ani instrumentu i nie działa po zamknięciu programu.

## Testy dostępne również na Linux

```sh
python -m pip install -r requirements.txt
python -m unittest discover -s . -p 'test_screen_demo.py' -v
python screen_demo.py --render-fixtures ../../.development-output/screen-demo/fixtures
python screen_demo.py --self-demo
python screen_demo.py --self-demo --side SELL --intent DEMO002
```

Tesseract musi być zainstalowany lokalnie. `--self-demo` wymaga rzeczywistego
OCR i zapisuje obrazy przed/po oraz `execution.jsonl` w nowym podkatalogu
każdej próby. JSON wyniku podaje ścieżkę artefaktów i jawnie oznacza
`RENDERED_MOCK_OCR_ONLY`; nie wysyła natywnych komunikatów Windows.
`--output OUT` zmienia katalog artefaktów tej próby.

Testy niezależnego autora sprawdzają zgodny BUY/SELL, błędny tryb konta,
instrument, stronę, ilość, ID i rewizję, stare i niepoprawne obrazy, dialog,
wylogowanie, przesunięty układ, brak lub niejednoznaczny przycisk oraz błędne
potwierdzenie. Sprawdzają też brak duplikatu po niepewnym wykonaniu i restarcie,
trwałe `PENDING` zapisane przed kliknięciem oraz uszkodzony dziennik.

## Granice wykonawcy

- Wymagane są zgodne pola `SCREEN`, `ACCOUNT PAPER_MOCK`, instrument, strona,
  ilość, ID, rewizja, `STATE READY`, kalibrowany układ 800 × 600 i obraz
  nie starszy niż 5 sekund. Niejasność oznacza `HALT`.
- Po kliknięciu wykonawca wymaga drugiego świeżego obrazu ze zgodnymi danymi
  i `STATE FILLED`. Brak potwierdzenia zatrzymuje dalsze intencje bez retry.
- Przed wysłaniem `WM_LBUTTONDOWN/UP` wykonawca sprawdza dokładny HWND swojego
  Canvas, PID tego procesu i rozmiar. Nie używa `SendInput`, globalnego kursora
  ani sterowania obcym oknem. DPI jest ustawiane przed utworzeniem Tk;
  niezgodna geometria zatrzymuje działanie.
- Historia fikcyjnych pozycji jest pamięcią sesji. Dziennik wykonawcy jest
  trwały, ale nie zastępuje historii ani stanu konta prawdziwego brokera.
- Nie jest to moduł wykonawczy głównej aplikacji. Próba na rzeczywistym
  pulpicie lub demo brokera wymaga osobnego etapu i podłączonego środowiska.
