# NBA Shot Evolution Dashboard

Two Decades of Evolution in the NBA Shooting Landscape: An Interactive Visual Analysis from the Mid-Range Era to the Three-Point Era.
Interactive D3.js visualization for the course project "Visualization Analysis & Design".

## Run locally

```powershell
cd D:\Final-Cousre-Project\Code
python -m http.server 8000 --bind 127.0.0.1
```

Open:

```text
http://127.0.0.1:8000/
```

## Regenerate data

The raw CSV files are read from:

```text
D:\Final-Cousre-Project\datasets\NBA_Shots_04_25-main
```

Run:

```powershell
cd D:\Final-Cousre-Project\Code
python scripts\preprocess.py
```

The script writes compact JSON files under `data/`. Court grid data is split into `data/hex/ALL.json` and one lazy-loaded file per team so the initial page load remains light.

## Test

```powershell
cd D:\Final-Cousre-Project\Code
python -m unittest discover -s tests
node --check js\app.js
```

## Main files

- `index.html`: static D3 application shell.
- `css/styles.css`: responsive dashboard styling.
- `js/app.js`: coordinated views, filters, interactions and chart rendering.
- `scripts/preprocess.py`: raw CSV to aggregated JSON pipeline.
- `tests/test_preprocess.py`: unit tests for the preprocessing logic.
