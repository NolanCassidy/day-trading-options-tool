"""
Options data service using yfinance
"""
import yfinance as yf
from datetime import datetime, timedelta
from typing import Optional
import time
import pandas as pd
from concurrent.futures import ThreadPoolExecutor, as_completed
from functools import lru_cache
import math
from scipy.stats import norm

# Simple cache with TTL
_cache = {}
_cache_ttl = 60  # seconds

# Risk-free rate (approximate)
RISK_FREE_RATE = 0.05


def calculate_greeks(stock_price: float, strike: float, time_to_expiry: float, 
                     iv: float, option_type: str = 'call') -> dict:
    """
    Calculate option Greeks using Black-Scholes model.
    
    Args:
        stock_price: Current stock price
        strike: Option strike price
        time_to_expiry: Time to expiry in years (e.g., 1 day = 1/365)
        iv: Implied volatility as decimal (e.g., 0.50 for 50%)
        option_type: 'call' or 'put'
    
    Returns:
        dict with delta, gamma, theta, vega
    """
    # Handle edge cases
    if time_to_expiry <= 0 or iv <= 0 or stock_price <= 0 or strike <= 0:
        return {'delta': 0, 'gamma': 0, 'theta': 0, 'vega': 0}
    
    try:
        S = stock_price
        K = strike
        T = time_to_expiry
        r = RISK_FREE_RATE
        sigma = iv
        
        # Black-Scholes d1 and d2
        d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
        d2 = d1 - sigma * math.sqrt(T)
        
        # Standard normal PDF and CDF
        n_d1 = norm.cdf(d1)
        n_d2 = norm.cdf(d2)
        n_prime_d1 = norm.pdf(d1)
        
        # Greeks
        if option_type.lower() == 'call':
            delta = n_d1
            theta = (-(S * n_prime_d1 * sigma) / (2 * math.sqrt(T)) 
                     - r * K * math.exp(-r * T) * n_d2) / 365
        else:  # put
            delta = n_d1 - 1
            theta = (-(S * n_prime_d1 * sigma) / (2 * math.sqrt(T)) 
                     + r * K * math.exp(-r * T) * norm.cdf(-d2)) / 365
        
        gamma = n_prime_d1 / (S * sigma * math.sqrt(T))
        vega = S * n_prime_d1 * math.sqrt(T) / 100  # Per 1% IV change
        
        return {
            'delta': round(delta, 3),
            'gamma': round(gamma, 4),
            'theta': round(theta, 3),
            'vega': round(vega, 3)
        }
    except Exception:
        return {'delta': 0, 'gamma': 0, 'theta': 0, 'vega': 0}


def calculate_scalp_score(gamma: float, vol_oi_ratio: float, spread_pct: float, 
                          delta: float) -> float:
    """
    Calculate a scalp score favoring options good for quick reversals.
    Higher score = better for scalping.
    
    Factors:
    - High gamma (explosive moves)
    - High volume/OI ratio (unusual activity)
    - Tight spreads (less slippage)
    - Delta near 0.5 (ATM, most responsive)
    """
    # Gamma contribution (higher = better, scaled significantly)
    gamma_score = min(gamma * 1000, 50)  # Cap at 50 points
    
    # Volume/OI ratio (unusual activity indicator)
    vol_oi_score = min(vol_oi_ratio * 5, 25)  # Cap at 25 points
    
    # Spread penalty (tighter = better)
    spread_penalty = min(spread_pct * 10, 25)  # Cap penalty at 25
    
    # Delta bonus for ATM options (delta near 0.5)
    atm_bonus = (1 - abs(abs(delta) - 0.5) * 2) * 15  # Max 15 points at delta=0.5
    
    score = gamma_score + vol_oi_score - spread_penalty + atm_bonus
    return round(max(score, 0), 1)

def cached_ticker(ticker: str):
    """Get cached ticker or create new one"""
    now = time.time()
    if ticker in _cache:
        cached_time, stock = _cache[ticker]
        if now - cached_time < _cache_ttl:
            return stock
    stock = yf.Ticker(ticker)
    _cache[ticker] = (now, stock)
    return stock


def with_retry(func, max_retries=3, initial_delay=1):
    """Retry decorator for handling rate limits"""
    def wrapper(*args, **kwargs):
        last_error = None
        for attempt in range(max_retries):
            try:
                return func(*args, **kwargs)
            except Exception as e:
                last_error = e
                if "429" in str(e) or "Too Many Requests" in str(e):
                    delay = initial_delay * (2 ** attempt)
                    time.sleep(delay)
                else:
                    raise e
        raise last_error
    return wrapper


@with_retry
def get_stock_quote(ticker: str) -> dict:
    """Get current stock quote"""
    stock = yf.Ticker(ticker)
    info = stock.info
    
    # Get real-time price from fast_info if available
    try:
        fast = stock.fast_info
        current_price = fast.last_price
        previous_close = fast.previous_close
        change = current_price - previous_close if current_price and previous_close else 0
        change_percent = (change / previous_close * 100) if previous_close else 0
    except:
        current_price = info.get('currentPrice') or info.get('regularMarketPrice', 0)
        previous_close = info.get('previousClose', 0)
        change = current_price - previous_close if current_price and previous_close else 0
        change_percent = (change / previous_close * 100) if previous_close else 0
    
    return {
        "symbol": ticker.upper(),
        "name": info.get('shortName', ticker.upper()),
        "price": round(current_price, 2) if current_price else 0,
        "change": round(change, 2),
        "changePercent": round(change_percent, 2),
        "previousClose": round(previous_close, 2) if previous_close else 0,
        "volume": info.get('volume', 0),
        "marketCap": info.get('marketCap', 0),
    }

@with_retry
def get_options_chain(ticker: str, expiry: Optional[str] = None) -> dict:
    """Get options chain for a stock"""
    stock = yf.Ticker(ticker)
    
    # Get available expiration dates
    expirations = stock.options
    
    if not expirations:
        return {
            "symbol": ticker.upper(),
            "expirations": [],
            "selectedExpiry": None,
            "calls": [],
            "puts": []
        }
    
    # Use provided expiry or default to first available
    selected_expiry = expiry if expiry and expiry in expirations else expirations[0]
    
    # Get options chain for selected expiry
    opt = stock.option_chain(selected_expiry)
    
    # Format calls
    calls = []
    for _, row in opt.calls.iterrows():
        calls.append({
            "strike": float(row['strike']),
            "lastPrice": float(row['lastPrice']) if not pd.isna(row['lastPrice']) else 0,
            "bid": float(row['bid']) if not pd.isna(row['bid']) else 0,
            "ask": float(row['ask']) if not pd.isna(row['ask']) else 0,
            "change": float(row['change']) if not pd.isna(row['change']) else 0,
            "percentChange": float(row['percentChange']) if not pd.isna(row['percentChange']) else 0,
            "volume": int(row['volume']) if not pd.isna(row['volume']) else 0,
            "openInterest": int(row['openInterest']) if not pd.isna(row['openInterest']) else 0,
            "impliedVolatility": round(float(row['impliedVolatility']) * 100, 2) if not pd.isna(row['impliedVolatility']) else 0,
            "inTheMoney": bool(row['inTheMoney']),
            "contractSymbol": row['contractSymbol']
        })
    
    # Format puts
    puts = []
    for _, row in opt.puts.iterrows():
        puts.append({
            "strike": float(row['strike']),
            "lastPrice": float(row['lastPrice']) if not pd.isna(row['lastPrice']) else 0,
            "bid": float(row['bid']) if not pd.isna(row['bid']) else 0,
            "ask": float(row['ask']) if not pd.isna(row['ask']) else 0,
            "change": float(row['change']) if not pd.isna(row['change']) else 0,
            "percentChange": float(row['percentChange']) if not pd.isna(row['percentChange']) else 0,
            "volume": int(row['volume']) if not pd.isna(row['volume']) else 0,
            "openInterest": int(row['openInterest']) if not pd.isna(row['openInterest']) else 0,
            "impliedVolatility": round(float(row['impliedVolatility']) * 100, 2) if not pd.isna(row['impliedVolatility']) else 0,
            "inTheMoney": bool(row['inTheMoney']),
            "contractSymbol": row['contractSymbol']
        })
    
    return {
        "symbol": ticker.upper(),
        "expirations": list(expirations),
        "selectedExpiry": selected_expiry,
        "calls": calls,
        "puts": puts
    }


def get_top_volume_options(ticker: str, top_n: int = 10) -> dict:
    """Get top volume options for near-term expiry (1-2 days out) with Greeks and scalp metrics"""
    try:
        stock = cached_ticker(ticker)
        
        # Get stock price info including high/low
        try:
            fast = stock.fast_info
            current_price = fast.last_price
            day_high = fast.day_high
            day_low = fast.day_low
        except:
            try:
                info = stock.info
                current_price = info.get('currentPrice') or info.get('regularMarketPrice', 0)
                day_high = info.get('dayHigh', current_price)
                day_low = info.get('dayLow', current_price)
            except:
                current_price = 0
                day_high = 0
                day_low = 0
        
        # Try to get options list with retry
        expirations = None
        for attempt in range(3):
            try:
                expirations = stock.options
                break
            except Exception as e:
                if attempt < 2:
                    time.sleep(1 * (attempt + 1))
                else:
                    raise e
        
        if not expirations:
            return {
                "symbol": ticker.upper(),
                "expiry": None,
                "daysToExpiry": 0,
                "stockPrice": current_price,
                "dayHigh": day_high,
                "dayLow": day_low,
                "topCalls": [],
                "topPuts": [],
                "message": "No options available for this ticker"
            }
    except Exception as e:
        return {
            "symbol": ticker.upper(),
            "expiry": None,
            "daysToExpiry": 0,
            "topCalls": [],
            "topPuts": [],
            "error": f"Rate limited - please try again in a minute: {str(e)}"
        }
    
    # Find expiry closest to 1 day out (or first available)
    today = datetime.now().date()
    target_date = today + timedelta(days=1)
    
    # Find the nearest expiry to our target
    best_expiry = expirations[0]
    min_diff = float('inf')
    for exp in expirations[:5]:  # Only check first 5 to limit API calls
        exp_date = datetime.strptime(exp, '%Y-%m-%d').date()
        diff = abs((exp_date - target_date).days)
        if diff < min_diff:
            min_diff = diff
            best_expiry = exp
    
    # Get options chain
    try:
        opt = stock.option_chain(best_expiry)
    except Exception as e:
        return {
            "symbol": ticker.upper(),
            "expiry": best_expiry,
            "error": str(e),
            "topCalls": [],
            "topPuts": []
        }
    
    # Calculate days to expiry for Greeks
    days_to_expiry = (datetime.strptime(best_expiry, '%Y-%m-%d').date() - today).days
    time_to_expiry = max(days_to_expiry, 0.5) / 365.0  # At least half day for 0DTE
    
    def format_option(row, option_type):
        strike = float(row['strike'])
        last_price = float(row['lastPrice']) if not pd.isna(row['lastPrice']) else 0
        bid = float(row['bid']) if not pd.isna(row['bid']) else 0
        ask = float(row['ask']) if not pd.isna(row['ask']) else 0
        spread = round(ask - bid, 2) if ask and bid else 0
        volume = int(row['volume']) if not pd.isna(row['volume']) else 0
        open_interest = int(row['openInterest']) if not pd.isna(row['openInterest']) else 0
        iv = float(row['impliedVolatility']) if not pd.isna(row['impliedVolatility']) else 0
        
        # Calculate Greeks
        greeks = calculate_greeks(
            stock_price=current_price if current_price else strike,
            strike=strike,
            time_to_expiry=time_to_expiry,
            iv=iv,
            option_type=option_type.lower()
        )
        
        # Calculate vol/OI ratio
        vol_oi_ratio = round(volume / open_interest, 2) if open_interest > 0 else 0
        
        # Spread as percentage of option price
        mid_price = (bid + ask) / 2 if bid and ask else last_price
        spread_pct = round((spread / mid_price * 100), 1) if mid_price > 0 else 0
        
        # Calculate scalp score
        scalp_score = calculate_scalp_score(
            gamma=greeks['gamma'],
            vol_oi_ratio=vol_oi_ratio,
            spread_pct=spread_pct,
            delta=greeks['delta']
        )
        
        # Calculate reversal profit (if stock goes back to high for calls, low for puts)
        reversal_profit = 0
        reversal_pct = 0
        if current_price and day_high and day_low and greeks['delta']:
            if option_type == 'CALL' and current_price < day_high:
                # If stock recovers to day high, estimate option profit
                price_move = day_high - current_price
                reversal_profit = round(price_move * abs(greeks['delta']) * 100, 2)  # Per contract
                reversal_pct = round((price_move * abs(greeks['delta']) / mid_price * 100), 1) if mid_price > 0 else 0
            elif option_type == 'PUT' and current_price > day_low:
                # If stock drops to day low, estimate option profit
                price_move = current_price - day_low
                reversal_profit = round(price_move * abs(greeks['delta']) * 100, 2)  # Per contract
                reversal_pct = round((price_move * abs(greeks['delta']) / mid_price * 100), 1) if mid_price > 0 else 0
        
        return {
            "type": option_type,
            "strike": strike,
            "lastPrice": last_price,
            "bid": bid,
            "ask": ask,
            "spread": spread,
            "spreadPct": spread_pct,
            "volume": volume,
            "openInterest": open_interest,
            "impliedVolatility": round(iv * 100, 2),
            "inTheMoney": bool(row['inTheMoney']),
            "contractSymbol": row['contractSymbol'],
            # Greeks
            "delta": greeks['delta'],
            "gamma": greeks['gamma'],
            "theta": greeks['theta'],
            "vega": greeks['vega'],
            # Scalp metrics
            "volOiRatio": vol_oi_ratio,
            "scalpScore": scalp_score,
            # Reversal profit
            "reversalProfit": reversal_profit,
            "reversalPct": reversal_pct
        }
    
    # Sort by volume and get top N
    calls_sorted = opt.calls.sort_values('volume', ascending=False).head(top_n)
    puts_sorted = opt.puts.sort_values('volume', ascending=False).head(top_n)
    
    top_calls = [format_option(row, 'CALL') for _, row in calls_sorted.iterrows()]
    top_puts = [format_option(row, 'PUT') for _, row in puts_sorted.iterrows()]
    
    return {
        "symbol": ticker.upper(),
        "expiry": best_expiry,
        "daysToExpiry": days_to_expiry,
        "stockPrice": round(current_price, 2) if current_price else 0,
        "dayHigh": round(day_high, 2) if day_high else 0,
        "dayLow": round(day_low, 2) if day_low else 0,
        "topCalls": top_calls,
        "topPuts": top_puts
    }


# Top stocks for market scanning - expanded watchlist (~100 stocks)
TOP_STOCKS = [
    # Index ETFs
    'SPY', 'QQQ', 'IWM', 'DIA', 'VOO', 'VTI', 'VXX', 'UVXY', 'SQQQ', 'TQQQ',
    'SPXL', 'SPXS', 'SOXL', 'SOXS', 'ARKK', 'ARKW', 'ARKG', 'XLK', 'XLV', 'XLI',
    
    # Mega-Cap Tech (FAANG+)
    'AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'META', 'TSLA', 'NVDA', 'AVGO', 'ORCL',
    
    # More Big Tech & Cloud
    'CRM', 'ADBE', 'NFLX', 'PYPL', 'INTC', 'CSCO', 'IBM', 'QCOM', 'TXN', 'NOW',
    'SNOW', 'PLTR', 'UBER', 'ABNB', 'SHOP', 'SQ', 'SPOT', 'DDOG', 'ZS', 'CRWD',
    'NET', 'MDB', 'PANW', 'OKTA', 'TWLO', 'ZM', 'DOCU', 'ROKU', 'U', 'RBLX',
    
    # Semiconductors
    'AMD', 'MU', 'MRVL', 'LRCX', 'KLAC', 'AMAT', 'ASML', 'TSM', 'ON', 'ARM',
    
    # Bitcoin/Crypto Related
    'MSTR', 'COIN', 'MARA', 'RIOT', 'CLSK', 'HUT', 'BITF', 'IBIT', 'GBTC', 'BITO',
    
    # Financials & Banks
    'JPM', 'BAC', 'WFC', 'GS', 'MS', 'C', 'SCHW', 'BLK', 'AXP', 'V', 'MA',
    
    # Healthcare & Biotech
    'UNH', 'JNJ', 'PFE', 'MRNA', 'ABBV', 'LLY', 'MRK', 'BMY', 'GILD', 'AMGN',
    
    # Consumer & Retail
    'WMT', 'COST', 'TGT', 'HD', 'LOW', 'NKE', 'SBUX', 'MCD', 'KO', 'PEP',
    
    # Industrial & Energy
    'BA', 'CAT', 'DE', 'GE', 'HON', 'UPS', 'FDX', 'XOM', 'CVX', 'COP',
    
    # EV & Clean Energy
    'RIVN', 'LCID', 'NIO', 'LI', 'XPEV', 'PLUG', 'FSLR', 'ENPH', 'RUN', 'CHPT',
    
    # Meme/Retail Favorites
    'GME', 'AMC', 'BBBY', 'SOFI', 'HOOD', 'AFRM', 'UPST', 
    
    # Entertainment & Media
    'DIS', 'CMCSA', 'WBD', 'PARA', 'NFLX', 'SNAP', 'PINS', 'MTCH',
    
    # Sector ETFs
    'XLF', 'XLE', 'XLP', 'XLB', 'XLRE', 'XLU', 'GLD', 'SLV', 'USO', 'UNG',
    'TLT', 'HYG', 'LQD', 'EEM', 'EFA', 'FXI', 'KWEB'
]


def scan_market_options(top_n_per_stock: int = 3) -> dict:
    """Scan multiple top stocks and return the most active options across all of them.
    Uses parallel execution for faster scanning."""
    all_calls = []
    all_puts = []
    scanned_stocks = []
    errors = []
    
    def fetch_stock_options(ticker):
        """Fetch options for a single stock - runs in parallel"""
        try:
            result = get_top_volume_options(ticker, top_n=top_n_per_stock)
            return (ticker, result, None)
        except Exception as e:
            return (ticker, None, str(e))
    
    # Use ThreadPoolExecutor for parallel fetching (10 workers = ~10x faster)
    with ThreadPoolExecutor(max_workers=10) as executor:
        # Submit all tasks
        futures = {executor.submit(fetch_stock_options, ticker): ticker for ticker in TOP_STOCKS}
        
        # Collect results as they complete
        for future in as_completed(futures):
            ticker, result, error = future.result()
            
            if error:
                errors.append(f"{ticker}: {error}")
                continue
                
            if result and result.get('error'):
                errors.append(f"{ticker}: {result['error']}")
                continue
            
            if result:
                # Add ticker info to each option
                for call in result.get('topCalls', []):
                    call['ticker'] = ticker
                    call['expiry'] = result.get('expiry')
                    call['daysToExpiry'] = result.get('daysToExpiry')
                    call['stockPrice'] = result.get('stockPrice')
                    call['dayHigh'] = result.get('dayHigh')
                    call['dayLow'] = result.get('dayLow')
                    all_calls.append(call)
                
                for put in result.get('topPuts', []):
                    put['ticker'] = ticker
                    put['expiry'] = result.get('expiry')
                    put['daysToExpiry'] = result.get('daysToExpiry')
                    put['stockPrice'] = result.get('stockPrice')
                    put['dayHigh'] = result.get('dayHigh')
                    put['dayLow'] = result.get('dayLow')
                    all_puts.append(put)
                
                scanned_stocks.append(ticker)
    
    # Sort all options by scalp score (best for quick trades) then by volume
    all_calls.sort(key=lambda x: (x.get('scalpScore', 0), x.get('volume', 0)), reverse=True)
    all_puts.sort(key=lambda x: (x.get('scalpScore', 0), x.get('volume', 0)), reverse=True)
    
    return {
        "scannedStocks": scanned_stocks,
        "totalStocks": len(TOP_STOCKS),
        "timestamp": datetime.now().isoformat(),
        "topCalls": all_calls[:50],  # Top 50 most active calls
        "topPuts": all_puts[:50],    # Top 50 most active puts
        "errors": errors if errors else None
    }

