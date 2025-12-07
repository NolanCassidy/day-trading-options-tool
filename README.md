# Options Scanner Pro

> Advanced Options Scanner with AI-Powered Trade Recommendations, Interactive Charts & Real-Time Greeks

Scan 100+ stocks, get AI trade recommendations, analyze with interactive candlestick charts, and estimate profits with Black-Scholes pricing.

![Options Scanner](https://img.shields.io/badge/Options-Scanner-00d26a) ![AI Powered](https://img.shields.io/badge/AI-Gemini-4a9eff) ![React](https://img.shields.io/badge/React-18-61dafb) ![Python](https://img.shields.io/badge/Python-FastAPI-3776ab)

## Features

### 🧠 AI Trade Advisor (New v2)
- **Deep Analysis**: Analyzes technicals across **5 timeframes** (1m, 5m, 1h, 1d, 1wk) to spot trend alignment.
- **Actionable Plans**: Provides specific **Entry**, **Stop Loss**, and **Take Profit** targets for every trade.
- **Smart Strike Selection**: Automatically targets **ATM/Near-OTM** options (Delta 0.15-0.85) for optimal leverage, avoiding low-ROI deep ITM calls.
- **Scope Control**: Analyze Calls, Puts, or Both with a single click.

> **Customizing the AI Strategy**:
> You can tweak the AI's personality and risk tolerance by editing the prompt in `backend/services/options.py`. Look for the `prompt = ...` block to adjust:
> - Profit Targets (currently 10-80%)
> - Hold Times (minutes vs hours)
> - Risk Tolerance (Delta range)

### 📊 Professional Charting
- **Candlestick charts** with lightweight-charts v5
- **Multi-Timeframe**: 1m, 5m, 15m, 30m, 1h, 4h, 1d, 1wk
- **Toggleable EMAs**: 9, 20, 50, 200
- **Volume bars** with up/down coloring
- **Indicator badges**: RSI, ATR, 52-week proximity, earnings dates

### ⚡ Options Scanner
- **Scalp Score™**: Proprietary ranking for short-term momentum.
- **Visual Heatmap**:
  - **Rev% (Reversal Percentage)**: Green highlighting for high-potential reversal plays.
  - **R:R (Risk:Reward)**: Calculated based on potential reversal vs downside risk.
  - **OTM Dimming**: Instantly spot the "At-The-Money" line with dimmed OTM strikes.
- **Greeks**: Real-time Delta, Gamma, Theta, Vega for every option.
- **Filters**: Sort by Price, Spread, Volume, DTE.

![Screenshot Placeholder: Scanner Dashboard]

### 💰 Profit Estimator
- **Interactive P&L Chart**: Visualize profit at expiry vs now.
- **Stock Chart Overlay**: View the underlying stock chart directly on the estimator page (1m timeframe).
- **Time Slider**: See how Theta decay affects your position hour-by-hour.
- **URL Persistence**: Share or refresh specific option analysis pages (`#option/TICKER/SYMBOL`).
- **Scenarios**: Quick buttons for ±5%, ±10%, Breakeven.

![Screenshot Placeholder: Profit Estimator]

### 🔄 Live Data & Controls
- **Manual Refresh**: On-demand price updates with rate-limit protection.
- **Live Indicator**: Visual feedback when price data is updated.
- **Smart Caching**: prevents unnecessary API calls while keeping data fresh.

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

## Tech Stack

- **Frontend**: React 18, Vite, lightweight-charts v5
- **Backend**: Python FastAPI, yfinance, google-generativeai
- **AI**: Gemini 2.5 Flash for high-speed analysis

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/scan` | Scan all stocks, returns top 50 by scalp score |
| `GET /api/options/{ticker}` | Full options chain with Greeks & Rev% |
| `GET /api/history/{ticker}` | OHLCV + EMAs + RSI across timeframes |
| `POST /api/ai-recommend` | AI analysis with Trading Plan |

## Disclaimer

For educational purposes only. Options trading involves significant risk. Always do your own research.

## License

MIT

---

**Built for traders**
