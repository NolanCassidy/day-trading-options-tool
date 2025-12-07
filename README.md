# 📈 Options Scanner Pro - Real-Time Options Trading Tool

> **Advanced Options Scanner with Greeks, Profit Estimator & Scalping Metrics**

A powerful, real-time options trading scanner and profit calculator built for day traders, scalpers, and options traders. Scan 100+ stocks instantly, identify high-probability trades with Greeks analysis, and estimate profits with an interactive P&L calculator.

![Options Scanner](https://img.shields.io/badge/Options-Scanner-green) ![Day Trading](https://img.shields.io/badge/Day-Trading-blue) ![Greeks](https://img.shields.io/badge/Greeks-Calculator-orange) ![React](https://img.shields.io/badge/React-18-61dafb) ![Python](https://img.shields.io/badge/Python-FastAPI-3776ab)

## 🚀 Features

### Market Scanner
- **Scan 100+ stocks** simultaneously with parallel processing (~15 seconds)
- **Real-time options data** from Yahoo Finance (no API key needed)
- **Scalp Score™** - proprietary ranking system for identifying best scalping opportunities
- Filter by price, spread, volume, days to expiration (DTE)
- Auto-refresh every 30 seconds

### Options Greeks
- **Delta (Δ)** - Price sensitivity to stock movement
- **Gamma (γ)** - Rate of delta change (momentum indicator)
- **Theta (Θ)** - Time decay per day
- **Vega (ν)** - Implied volatility sensitivity

### Scalping Metrics
- **Reversal Profit %** - Potential gain if stock reverts to day high/low
- **Volume/OI Ratio** - Unusual activity detector
- **Day High/Low** - Intraday range for reversal trades
- **Bid-Ask Spread** - Color-coded for quick assessment

### Profit Estimator Modal
- **Interactive P&L Chart** - Hover to see profit at any price
- **Time Slider** - Estimate profits at any point before expiration
- **% Returns Display** - See percentage gains alongside dollar amounts
- **Quick Scenarios** - +5%, +10%, -5%, breakeven calculations
- **Black-Scholes Pricing** - Industry-standard option valuation

## 📸 Screenshots

Coming soon...

## 🎯 Perfect For

- **Day Traders** - Quick scalp plays with tight spreads
- **Options Scalpers** - Find high-gamma opportunities for explosive moves
- **Swing Traders** - Identify options for multi-day holds
- **0DTE Traders** - Filter for same-day expiration plays
- **Momentum Traders** - Track unusual volume and activity

## 🛠️ Tech Stack

**Frontend:**
- React 18 + Vite
- Interactive charts and P&L visualization
- Real-time data updates
- Dark mode trading interface

**Backend:**
- Python FastAPI
- Black-Scholes Greeks calculation
- Parallel stock scanning with ThreadPoolExecutor
- Yahoo Finance data via yfinance

## 📦 Installation

### Prerequisites
- Node.js 18+
- Python 3.9+

### Quick Start

```bash
# Clone the repository
git clone https://github.com/yourusername/options-scanner-pro.git
cd options-scanner-pro

# Backend setup
cd backend
pip install -r requirements.txt
python main.py

# Frontend setup (new terminal)
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

## 📊 Stocks Covered

Scans **130+ liquid stocks** including:

- **Index ETFs**: SPY, QQQ, IWM, DIA, VXX, TQQQ, SQQQ, SOXL
- **Mega-Cap Tech**: AAPL, MSFT, GOOGL, AMZN, META, TSLA, NVDA
- **Semiconductors**: AMD, NVDA, MU, ASML, TSM, AVGO
- **Bitcoin/Crypto**: MSTR, COIN, MARA, RIOT, IBIT, GBTC
- **Financials**: JPM, BAC, GS, V, MA
- **Meme Stocks**: GME, AMC, SOFI, HOOD
- **Leveraged ETFs**: TQQQ, SQQQ, SOXL, SOXS, UVXY

## 🔧 API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/scan` | Scan all stocks, returns top 50 options by scalp score |
| `GET /api/quote/{ticker}` | Get stock quote with price, change, volume |
| `GET /api/options/{ticker}` | Full options chain for a ticker |
| `GET /api/top-volume/{ticker}` | Top volume options with Greeks |

## 📈 Scalp Score Algorithm

The proprietary Scalp Score™ ranks options for quick-profit potential:

```
Score = (Gamma × 1000) + (Vol/OI Ratio × 5) - (Spread% × 10) + ATM Bonus
```

- **High Gamma** = More explosive moves
- **High Vol/OI** = Unusual activity
- **Tight Spreads** = Less slippage
- **ATM Options** = Most responsive to price changes

## 🎓 How to Use

1. **Click "Scan Market"** to find top options across 130+ stocks
2. **Sort by Score** - Higher scores = better scalp opportunities
3. **Check Rev%** - Reversal profit if stock returns to high/low
4. **Click any option** to open the Profit Estimator
5. **Adjust time slider** to see P&L at different sell times
6. **Hover the chart** to explore profit at various stock prices

## ⚠️ Disclaimer

This tool is for educational and informational purposes only. Options trading involves significant risk of loss. Past performance does not guarantee future results. Always do your own research and consider consulting a financial advisor.

## 🤝 Contributing

Contributions welcome! Please feel free to submit a Pull Request.

## 📝 License

MIT License - feel free to use this for personal or commercial projects.

## 🔗 Keywords

Options trading, options scanner, options screener, day trading, scalping, options greeks, delta, gamma, theta, vega, profit calculator, P&L estimator, stock options, call options, put options, 0DTE, zero days to expiration, options chain, implied volatility, IV, bid ask spread, options volume, open interest, Black-Scholes, option pricing, SPY options, QQQ options, TSLA options, NVDA options, AMD options, meme stocks, trading tools, fintech, React, Python, FastAPI, yfinance

---

**Built with ❤️ for traders**

