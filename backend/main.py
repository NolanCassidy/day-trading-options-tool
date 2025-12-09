"""
FastAPI backend for Options Trading Dashboard
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional
from pydantic import BaseModel

from services.options import (
    get_stock_quote, get_options_chain, get_top_volume_options, 
    scan_market_options, get_stock_history, detect_unusual_activity,
    get_ai_recommendation, get_option_history, get_quote_lite
)
from services.options_search import find_best_options
from services.database import (
    init_db, get_all_tickers, get_scanner_tickers, add_ticker, remove_ticker,
    get_all_options, add_option, remove_option, is_option_in_watchlist
)

app = FastAPI(
    title="Options Trading API",
    description="API for fetching real-time stock and options data",
    version="1.0.0"
)

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost", "http://localhost:80", "http://localhost:8420"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event():
    """Initialize database on startup"""
    init_db()
    print("Database initialized")


@app.get("/")
async def root():
    return {"message": "Options Trading API", "status": "running"}


@app.get("/api/quote/{ticker}")
async def quote(ticker: str):
    """Get current stock quote"""
    try:
        data = get_stock_quote(ticker.upper())
        return data
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error fetching quote for {ticker}: {str(e)}")


@app.get("/api/quote-lite/{ticker}")
async def quote_lite(ticker: str):
    """Lightweight quote for live updates - fast price data only"""
    try:
        data = get_quote_lite(ticker.upper())
        return data
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error fetching quote for {ticker}: {str(e)}")


@app.get("/api/options/{ticker}")
async def options(ticker: str, expiry: Optional[str] = None):
    """Get options chain for a stock"""
    try:
        data = get_options_chain(ticker.upper(), expiry)
        return data
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error fetching options for {ticker}: {str(e)}")


@app.get("/api/top-volume/{ticker}")
async def top_volume(ticker: str, top_n: int = 10):
    """Get top volume options for near-term expiry (1-2 days out)"""
    try:
        data = get_top_volume_options(ticker.upper(), top_n)
        return data
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error fetching top volume for {ticker}: {str(e)}")


@app.get("/api/scan")
async def market_scan():
    """Scan top stocks for most active options - uses watchlist tickers"""
    try:
        data = scan_market_options()
        return data
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error scanning market: {str(e)}")


@app.get("/api/history/{ticker}")
async def stock_history(ticker: str, period: str = "3mo", interval: str = "1d"):
    """Get stock price history with EMAs and technical indicators"""
    try:
        data = get_stock_history(ticker.upper(), period, interval)
        return data
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error fetching history for {ticker}: {str(e)}")


@app.get("/api/unusual/{ticker}")
async def unusual_activity(ticker: str):
    """Detect unusual options activity"""
    try:
        data = detect_unusual_activity(ticker.upper())
        return data
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error detecting unusual activity for {ticker}: {str(e)}")


@app.get("/api/option-history/{contract_symbol}")
async def option_history(contract_symbol: str, period: str = "1mo", interval: str = "1d"):
    """Get historical prices for a specific option contract"""
    try:
        data = get_option_history(contract_symbol, period, interval)
        return data
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error fetching option history: {str(e)}")


class AIRecommendRequest(BaseModel):
    topCalls: list = []
    topPuts: list = []


@app.post("/api/ai-recommend")
async def ai_recommend(request: AIRecommendRequest):
    """Get AI-powered trade recommendation based on scan results"""
    try:
        data = get_ai_recommendation({
            "topCalls": request.topCalls,
            "topPuts": request.topPuts
        })
        return data
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error generating recommendation: {str(e)}")


class FindOptionsRequest(BaseModel):
    ticker: str
    optionType: str
    targetPrice: float
    stopLoss: float | None = None
    targetDate: str


@app.post("/api/find-options")
async def find_options(request: FindOptionsRequest):
    """Find best options based on user thesis"""
    try:
        data = find_best_options(
            request.ticker,
            request.targetPrice,
            request.stopLoss,
            request.targetDate,
            request.optionType
        )
        if "error" in data:
            raise HTTPException(status_code=400, detail=data["error"])
        return data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error finding options: {str(e)}")


# ============== WATCHLIST API ENDPOINTS ==============

# --- Ticker Watchlist ---

@app.get("/api/watchlist/tickers")
async def get_tickers():
    """Get all tickers in watchlist"""
    try:
        return {"tickers": get_all_tickers()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class AddTickerRequest(BaseModel):
    symbol: str
    category: str = "Other"


@app.post("/api/watchlist/tickers")
async def add_ticker_endpoint(request: AddTickerRequest):
    """Add a ticker to watchlist"""
    try:
        result = add_ticker(request.symbol, request.category)
        if result["success"]:
            return result
        raise HTTPException(status_code=400, detail=result["error"])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/watchlist/tickers/{symbol}")
async def remove_ticker_endpoint(symbol: str):
    """Remove a ticker from watchlist"""
    try:
        result = remove_ticker(symbol)
        if result["success"]:
            return result
        raise HTTPException(status_code=404, detail=result["error"])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Option Watchlist ---

@app.get("/api/watchlist/options")
async def get_options_watchlist():
    """Get all options in watchlist"""
    try:
        return {"options": get_all_options()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class AddOptionRequest(BaseModel):
    contractSymbol: str
    ticker: str
    strike: float
    expiry: str
    optionType: str
    notes: str = ""


@app.post("/api/watchlist/options")
async def add_option_endpoint(request: AddOptionRequest):
    """Add an option to watchlist"""
    try:
        result = add_option(
            request.contractSymbol,
            request.ticker,
            request.strike,
            request.expiry,
            request.optionType,
            request.notes
        )
        if result["success"]:
            return result
        raise HTTPException(status_code=400, detail=result["error"])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/watchlist/options/{contract_symbol}")
async def remove_option_endpoint(contract_symbol: str):
    """Remove an option from watchlist"""
    try:
        result = remove_option(contract_symbol)
        if result["success"]:
            return result
        raise HTTPException(status_code=404, detail=result["error"])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/watchlist/options/check/{contract_symbol}")
async def check_option_in_watchlist(contract_symbol: str):
    """Check if an option is in the watchlist"""
    try:
        return {"inWatchlist": is_option_in_watchlist(contract_symbol)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

