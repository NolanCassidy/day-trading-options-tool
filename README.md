# Options Scanner Pro

> Advanced Options Scanner with AI-Powered Trade Recommendations, Interactive Charts & Real-Time Greeks

Scan 100+ stocks, get AI trade recommendations, analyze with interactive candlestick charts, and estimate profits with Black-Scholes pricing.

![Options Scanner](https://img.shields.io/badge/Options-Scanner-00d26a) ![AI Powered](https://img.shields.io/badge/AI-Gemini-4a9eff) ![React](https://img.shields.io/badge/React-18-61dafb) ![Python](https://img.shields.io/badge/Python-FastAPI-3776ab)

## Features

### AI Trade Advisor
- **Gemini AI-powered** trade recommendations
- Analyzes 40+ options with stock technicals (RSI, ATR, 52-week data)
- Returns **top pick + 4 runner-ups**
- Click any recommendation → opens Profit Estimator
- Works on scanner results AND individual stock pages

### Interactive Stock Charts
- **Candlestick charts** with lightweight-charts v5
- **Intraday timeframes**: 1M, 5M, 15M for day trading
- **Daily timeframes**: 5D, 1MO, 3MO, 6MO, 1Y
- **Toggleable EMAs**: 9, 20, 50, 200
- **Volume bars** with up/down coloring
- **Indicator badges**: RSI, ATR, 52-week proximity, earnings dates

### Market Scanner
- Scan **100+ liquid stocks** in ~15 seconds
- **Scalp Score™** ranking algorithm
- **Greeks**: Delta, Gamma, Theta, Vega
- **Reversal %**: Profit potential if stock reverts to day high/low
- Filter by price, spread, volume, DTE
- Auto-refresh every 30 seconds

### Profit Estimator
- **Interactive P&L chart** with hover line
- **Time slider** with 30-min increments
- **Click ticker** → navigates to stock page
- **Quick scenarios**: ±5%, ±10%, breakeven
- Black-Scholes option pricing

### UX Improvements
- **URL routing**: Refresh preserves current page (`#scan`, `#stock/SPY`)
- **Hacker-style UI**: Minimal buttons, monospace fonts, green accents
- **Dark mode** trading interface

## Quick Start

```bash
# Backend
cd backend
pip install -r requirements.txt
GEMINI_API_KEY=your_key python main.py

# Frontend  
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

## Environment Variables

Create `backend/.env`:
```
GEMINI_API_KEY=your_gemini_api_key
```

## Tech Stack

- **Frontend**: React 18, Vite, lightweight-charts v5
- **Backend**: Python FastAPI, yfinance, google-generativeai
- **AI**: Gemini 3 Pro for trade analysis

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/scan` | Scan all stocks, returns top 50 by scalp score |
| `GET /api/quote/{ticker}` | Stock quote with price, change, volume |
| `GET /api/options/{ticker}` | Full options chain |
| `GET /api/history/{ticker}` | OHLCV + EMAs + RSI + ATR + 52wk |
| `POST /api/ai-recommend` | AI-powered trade recommendation |

## Stocks Covered

130+ liquid stocks: SPY, QQQ, AAPL, MSFT, GOOGL, AMZN, META, TSLA, NVDA, AMD, MSTR, COIN, GME, and more.

## Disclaimer

For educational purposes only. Options trading involves significant risk. Always do your own research.

## License

MIT

---

**Built for traders**
