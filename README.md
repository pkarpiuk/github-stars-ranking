# github-stars-ranking

Ranking repozytoriów GitHuba wg gwiazdek (top 10 000): kolumny Change i Gain względem wybranego wcześniejszego rankingu, sortowanie,
filtry (użytkownicy, tematy, języki), wykresy historii i szczegóły repozytorium. Statyczna strona (ExtJS 4) na **GitHub Pages**;
dane odświeża raz w tygodniu **GitHub Actions** (bez serwera).

## Jak to działa

```
poniedziałek 04:17 UTC (Actions)
  └─ update.rb  ── GitHub GraphQL ──►  _site/db.js  (ranking, COMPARE, kolory języków, metadane)
                └─ dopisuje snapshot do data/ranking-db.json (historia)
  └─ site/ + _site/db.js  ──►  GitHub Pages
  └─ data/ranking-db.json, data/language_colors.json  ──►  commit do gałęzi `data`
```

- **`main`**: kod (`update.rb`, `compare_snapshots.rb`, `language_colors.rb`), strona (`site/`), workflow (`.github/workflows/update.yml`).
- **`data`**: tylko historia: `ranking-db.json` (JSON-lines, dopisywana co tydzień, ok. 0,4 MB na snapshot) i odświeżany słownik `language_colors.json`.
  Strona nie jest commitowana: `db.js` (ok. 5,7 MB) powstaje przy każdym przebiegu i jest publikowany jako artefakt Pages.
- `update.rb` ma bramkę świeżości: jeśli ostatni snapshot ma mniej niż 6 dni, nic nie pobiera (opcja `force` w ręcznym uruchomieniu to pomija).

## Pierwsze uruchomienie

1. **Repozytorium publiczne na GitHubie** (Actions są wtedy darmowe, a Pages dostępne na darmowym planie). Wypchnij `main`.
2. **Pages:** Settings → Pages → *Build and deployment* → Source: **GitHub Actions**.
3. **Token:** utwórz token fine-grained (Settings → Developer settings → Personal access tokens; zakres: tylko publiczne repozytoria,
   bez żadnych uprawnień do zapisu) i zapisz go jako sekret `STARS_TOKEN` (Settings → Secrets and variables → Actions). Bez sekretu workflow
   użyje wbudowanego `GITHUB_TOKEN`, ale jego limit GraphQL nie był sprawdzony.
4. **Gałąź `data`** z dotychczasową historią (ziarno leży lokalnie w `data/ranking-db.json`, ignorowane w `main`):
   ```
   git worktree add --orphan -b data ../github-stars-ranking-data
   cp data/ranking-db.json ../github-stars-ranking-data/
   cd ../github-stars-ranking-data && git add ranking-db.json && git commit -m "Historia rankingu (ziarno)" && git push -u origin data
   ```
   (wymaga git 2.42+). Bez tej gałęzi pierwszy przebieg zakończy się błędem przy checkout.
5. **Pierwszy przebieg:** Actions → *Aktualizacja rankingu i wdrożenie na GitHub Pages* → Run workflow (zaznacz `force`, bo ostatni snapshot z ziarna
   może być świeży). Adres strony: `https://<użytkownik>.github.io/github-stars-ranking/`.

Potem workflow działa sam co poniedziałek. Zmiany w `site/` trafiają na Pages przy następnym przebiegu (ręczny *Run workflow* wystarczy).

## Uruchamianie lokalne

```
GITHUB_TOKEN=... ruby update.rb [--force]       # wymaga tylko Ruby 3 (biblioteka standardowa, bez gemów): sudo apt-get install ruby
cp -r site/. _site/ && cd _site && python3 -m http.server 8000     # http://localhost:8000/
```

Domyślne ścieżki: historia `data/ranking-db.json`, wynik `_site/db.js`. Zmienne: `RANKING_DB`, `OUTPUT_DB_JS`, `RANKING_LANG_COLORS`, `RANKING_SIZE` (10000),
`MIN_STARS` (1000), `PAGE_SIZE` (50), `MIN_INTERVAL` (518400 s). Pełne pobranie 10 000 repozytoriów to ok. 200 zapytań GraphQL i trwa kilka–kilkanaście minut.

## Uwagi i ograniczenia

- **GitHub Pages:** strona do 1 GB, transfer 100 GB/miesiąc (limit miękki), brak własnych nagłówków cache. Strona waży ok. 1,8 MB po kompresji (`db.js`).
- **Harmonogram Actions** bywa opóźniany (zwłaszcza o pełnej godzinie) i w publicznym repozytorium **wyłącza się po 60 dniach bez aktywności** w repozytorium;
  cotygodniowy commit do gałęzi `data` powinien to zapobiegać, ale nie jest to sprawdzone. Jeśli harmonogram zniknie, włącz workflow ponownie w zakładce Actions.
- Błąd pobrania (limit, sieć) kończy przebieg bez zapisu i bez wdrożenia: Pages zostaje przy poprzedniej wersji, a historia nie dostaje wpisu.
- Workflow nie był jeszcze uruchomiony na GitHubie: sprawdzono tylko składnię i `update.rb` na atrapie API (patrz `CLAUDE.md`).
