"""
FastAPI backend for Options Trading Dashboard
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional

from services.options import get_stock_quote, get_options_chain, get_top_volume_options, scan_market_options

app = FastAPI(
    title="Options Trading API",
    description="API for fetching real-time stock and options data",
    version="1.0.0"
)

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
    """Scan top stocks (SPY, QQQ, AAPL, TSLA, etc.) for most active options"""
    try:
        data = scan_market_options()
        return data
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error scanning market: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
