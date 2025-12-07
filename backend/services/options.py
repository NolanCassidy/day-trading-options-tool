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
import os

# Gemini AI setup
try:
    import google.generativeai as genai
    from dotenv import load_dotenv
    load_dotenv()
    GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY')
    if GEMINI_API_KEY:
        genai.configure(api_key=GEMINI_API_KEY)
        GEMINI_AVAILABLE = True
    else:
        GEMINI_AVAILABLE = False
except ImportError:
    GEMINI_AVAILABLE = False

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


def calculate_option_price(option_type: str, stock_price: float, strike: float, 
                         time_to_expiry: float, iv: float, risk_free_rate: float = 0.05) -> float:
    """
    Calculate theoretical option price using Black-Scholes.
    """
    if time_to_expiry <= 0 or iv <= 0 or stock_price <= 0 or strike <= 0:
        if option_type.lower() == 'call':
            return max(0.0, stock_price - strike)
        else:
            return max(0.0, strike - stock_price)

    try:
        S = stock_price
        K = strike
        T = time_to_expiry
        r = risk_free_rate
        sigma = iv

        d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
        d2 = d1 - sigma * math.sqrt(T)

        if option_type.lower() == 'call':
            price = S * norm.cdf(d1) - K * math.exp(-r * T) * norm.cdf(d2)
        else:
            price = K * math.exp(-r * T) * norm.cdf(-d2) - S * norm.cdf(-d1)
            
        return max(0.01, price) # Minimum value
    except:
        return 0.0

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


def get_robust_stock_data(stock) -> dict:
    """
    Robustly fetch current price, high, and low data.
    Falls back to historical data if real-time info is missing/zero.
    """
    current_price = 0
    day_high = 0
    day_low = 0
    previous_close = 0
    
    # 1. Try fast_info (fastest)
    try:
        fast = stock.fast_info
        current_price = fast.last_price
        day_high = fast.day_high
        day_low = fast.day_low
        previous_close = fast.previous_close
    except:
        pass
    
    # 2. Try regular info if values are missing
    if not current_price or not day_high or not day_low:
        try:
            info = stock.info
            if not current_price:
                current_price = info.get('currentPrice') or info.get('regularMarketPrice', 0)
            if not day_high:
                day_high = info.get('dayHigh') or info.get('regularMarketDayHigh', 0)
            if not day_low:
                day_low = info.get('dayLow') or info.get('regularMarketDayLow', 0)
            if not previous_close:
                previous_close = info.get('previousClose', 0)
        except:
            pass
            
    # 3. Fallback to 5d history if still missing/zero (common on weekends/holidays)
    if not current_price or not day_high or not day_low:
        try:
            # Get last 5 days to ensure we find the last trading day
            hist = stock.history(period='5d')
            if not hist.empty:
                last_row = hist.iloc[-1]
                # If we have a current price but no high/low, use the history's high/low
                # If we have NO current price, use the history's close
                if not current_price:
                    current_price = last_row['Close']
                
                # Only overwrite if we don't have valid values
                if not day_high:
                    day_high = last_row['High']
                if not day_low:
                    day_low = last_row['Low']
                    
                # If previous close is missing, use the close of the day BEFORE the last one
                if not previous_close and len(hist) >= 2:
                    previous_close = hist['Close'].iloc[-2]
        except:
            pass
            
    return {
        "current_price": current_price,
        "day_high": day_high,
        "day_low": day_low,
        "previous_close": previous_close
    }


@with_retry
def get_stock_quote(ticker: str) -> dict:
    """Get current stock quote"""
    stock = yf.Ticker(ticker)
    info = stock.info
    
    # Use robust data fetching
    data = get_robust_stock_data(stock)
    current_price = data['current_price']
    previous_close = data['previous_close']
    
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


def get_quote_lite(ticker: str) -> dict:
    """
    Lightweight quote for live updates - only essential price data.
    Uses fast_info for speed (~0.2s vs 0.5s for full info).
    """
    try:
        stock = yf.Ticker(ticker)
        
        # Use robust data fetching
        data = get_robust_stock_data(stock)
        current_price = data['current_price']
        day_high = data['day_high']
        day_low = data['day_low']
        previous_close = data['previous_close']
        
        change = current_price - previous_close if current_price and previous_close else 0
        change_percent = (change / previous_close * 100) if previous_close else 0
        
        return {
            "symbol": ticker.upper(),
            "price": round(current_price, 2) if current_price else 0,
            "change": round(change, 2),
            "changePercent": round(change_percent, 2),
            "dayHigh": round(day_high, 2) if day_high else 0,
            "dayLow": round(day_low, 2) if day_low else 0,
            "timestamp": int(time.time() * 1000)
        }
    except Exception as e:
        return {"error": str(e), "symbol": ticker.upper()}

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
    
    # Get stock data for Greeks/Reversal calc
    try:
        # Check history first as it was doing before, but fallback if empty
        hist = stock.history(period='1d')
        if not hist.empty:
            current_price = hist['Close'].iloc[-1]
            day_high = hist['High'].iloc[-1]
            day_low = hist['Low'].iloc[-1]
        else:
            # Fallback to robust fetching
            data = get_robust_stock_data(stock)
            current_price = data['current_price']
            day_high = data['day_high']
            day_low = data['day_low']
    except:
        current_price = day_high = day_low = 0

    # Calculate time to expiry
    expiry_date = datetime.strptime(selected_expiry, '%Y-%m-%d')
    days_to_expiry = (expiry_date - datetime.now()).days
    time_to_expiry = max(days_to_expiry / 365.0, 0.001)

    # Helper to process option row
    def process_option_row(row, opt_type):
        strike = float(row['strike'])
        last_price = float(row['lastPrice']) if not pd.isna(row['lastPrice']) else 0
        bid = float(row['bid']) if not pd.isna(row['bid']) else 0
        ask = float(row['ask']) if not pd.isna(row['ask']) else 0
        volume = int(row['volume']) if not pd.isna(row['volume']) else 0
        open_interest = int(row['openInterest']) if not pd.isna(row['openInterest']) else 0
        iv = float(row['impliedVolatility']) if not pd.isna(row['impliedVolatility']) else 0
        
        # Greeks
        greeks = calculate_greeks(current_price, strike, time_to_expiry, iv, opt_type)
        
        # Vol/OI
        vol_oi_ratio = round(volume / open_interest, 2) if open_interest > 0 else 0
        
        # Spread Pct
        mid_price = (bid + ask) / 2 if bid and ask else last_price
        spread_pct = round(((ask - bid) / mid_price * 100), 1) if mid_price > 0 else 0
        
        # Scalp Score
        scalp_score = calculate_scalp_score(greeks['gamma'], vol_oi_ratio, spread_pct, greeks['delta'])
        
        # Reversal % - profit if stock returns to daily high (for CALL) or low (for PUT)
        reversal_pct = 0
        risk_ratio = 0
        
        if current_price and day_high and day_low and mid_price > 0:
            # Use Black-Scholes for accurate Risk/Reward
            # Use Black-Scholes for accurate Risk/Reward
            # Target P/L calc
            
            # Match Frontend: Use Trading Hours Model for Consistency
            # Logic: Calculate offset based on current time of day "next 30m" logic
            
            non_trading_deduction = 0.5
            try:
                now = datetime.now() # System time (PT)
                day = now.weekday() # 0=Mon, 6=Sun
                current_hour = now.hour + now.minute / 60.0
                market_open = 6.5
                market_close = 13.0
                
                if day >= 5: # Sat/Sun
                    non_trading_deduction = 0.5
                elif current_hour < market_open:
                    non_trading_deduction = 0.5
                elif current_hour >= market_close:
                    non_trading_deduction = 6.5 + 0.5 # Start of next day
                else:
                    # In market hours
                    elapsed = current_hour - market_open
                    next_interval = math.ceil(elapsed * 2) / 2.0
                    if next_interval == elapsed:
                        next_interval += 0.5
                    non_trading_deduction = max(0.5, next_interval)
            except:
                non_trading_deduction = 0.5

            # 1. Estimate total trading hours
            est_trading_days = max(1, days_to_expiry)
            total_trading_hours = est_trading_days * 6.5
            
            # 2. Subtract calculated deduction
            hours_remaining = max(0.1, total_trading_hours - non_trading_deduction)
            
            # 3. Calculate T using Trading Year
            rr_tte = hours_remaining / (252 * 6.5)
            
            if opt_type == 'CALL':
                # Reward: Price at Day High
                price_at_high = calculate_option_price('call', day_high, strike, rr_tte, iv)
                reward = price_at_high - mid_price
                
                # Risk: Price at Day Low
                price_at_low = calculate_option_price('call', day_low, strike, rr_tte, iv)
                risk = price_at_low - mid_price # Expected to be negative
                
                # Reversal % (Bonus metric)
                # If current < day_high, potential upside
                if current_price < day_high:
                    reversal_pct = round((reward / mid_price * 100), 1)

            elif opt_type == 'PUT':
                # Reward: Price at Day Low
                price_at_low = calculate_option_price('put', day_low, strike, rr_tte, iv)
                reward = price_at_low - mid_price
                
                # Risk: Price at Day High
                price_at_high = calculate_option_price('put', day_high, strike, rr_tte, iv)
                risk = price_at_high - mid_price # Expected to be negative

                # Reversal %
                # If current > day_low, potential upside
                if current_price > day_low:
                     reversal_pct = round((reward / mid_price * 100), 1)

            # Calculate R:R Ratio
            # If Risk is >= 0 (Profit in both cases), Infinite R:R
            if risk >= 0:
                risk_ratio = 999.9 # Effectively infinite
            elif reward <= 0:
                risk_ratio = 0.0
            else:
                risk_ratio = round(reward / abs(risk), 2)


        return {
            "strike": strike,
            "lastPrice": last_price,
            "bid": bid,
            "ask": ask,
            "change": float(row['change']) if not pd.isna(row['change']) else 0,
            "percentChange": float(row['percentChange']) if not pd.isna(row['percentChange']) else 0,
            "volume": volume,
            "openInterest": open_interest,
            "impliedVolatility": round(iv * 100, 2),
            "inTheMoney": bool(row['inTheMoney']),
            "contractSymbol": row['contractSymbol'],
            # key additions
            "delta": greeks['delta'],
            "gamma": greeks['gamma'],
            "scalpScore": scalp_score,
            "reversalPct": reversal_pct,
            "riskRatio": risk_ratio,
            "spread": round(ask - bid, 2),
            "type": opt_type
        }
    
    # Format calls
    calls = []
    for _, row in opt.calls.iterrows():
        calls.append(process_option_row(row, 'CALL'))
    
    # Format puts
    puts = []
    for _, row in opt.puts.iterrows():
        puts.append(process_option_row(row, 'PUT'))
    
    return {
        "symbol": ticker.upper(),
        "expirations": list(expirations),
        "selectedExpiry": selected_expiry,
        "calls": calls,
        "puts": puts,
        "stockPrice": round(current_price, 2) # Useful for frontend
    }


def get_top_volume_options(ticker: str, top_n: int = 10) -> dict:
    """Get top volume options for near-term expiry (1-2 days out) with Greeks and scalp metrics"""
    try:
        stock = cached_ticker(ticker)
        
        # Get stock price info including high/low
        try:
            data = get_robust_stock_data(stock)
            current_price = data['current_price']
            day_high = data['day_high']
            day_low = data['day_low']
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
        
        # Calculate risk/reward ratio (potential gain at high vs loss at low for CALL)
        # For CALL: gain if stock goes to high, loss if stock goes to low
        # For PUT: gain if stock goes to low, loss if stock goes to high
        risk_ratio = 0
        # Calculate risk/reward ratio using Black-Scholes
        risk_ratio = 0
        if current_price and day_high and day_low and mid_price > 0:
            # Match Frontend: Use Trading Hours Model with dynamic time
            
            non_trading_deduction = 0.5
            try:
                now = datetime.now()
                day = now.weekday()
                current_hour = now.hour + now.minute / 60.0
                market_open = 6.5
                market_close = 13.0
                
                if day >= 5: # Sat/Sun (5,6)
                    non_trading_deduction = 0.5
                elif current_hour < market_open:
                    non_trading_deduction = 0.5
                elif current_hour >= market_close:
                    non_trading_deduction = 6.5 + 0.5
                else:
                    elapsed = current_hour - market_open
                    next_interval = math.ceil(elapsed * 2) / 2.0
                    if next_interval == elapsed:
                        next_interval += 0.5
                    non_trading_deduction = max(0.5, next_interval)
            except:
                non_trading_deduction = 0.5

            # 1. Estimate total trading hours
            est_trading_days = max(1, days_to_expiry)
            total_trading_hours = est_trading_days * 6.5
            
            # 2. Subtract calculated deduction
            hours_remaining = max(0.1, total_trading_hours - non_trading_deduction)
            
            # 3. Calculate T using Trading Year
            rr_tte = hours_remaining / (252 * 6.5)

            if option_type == 'CALL':
                # Reward: Price at Day High
                price_at_high = calculate_option_price('call', day_high, strike, rr_tte, iv)
                reward = price_at_high - mid_price
                
                # Risk: Price at Day Low
                price_at_low = calculate_option_price('call', day_low, strike, rr_tte, iv)
                risk = price_at_low - mid_price
                
            elif option_type == 'PUT':
                # Reward: Price at Day Low
                price_at_low = calculate_option_price('put', day_low, strike, rr_tte, iv)
                reward = price_at_low - mid_price
                
                # Risk: Price at Day High
                price_at_high = calculate_option_price('put', day_high, strike, rr_tte, iv)
                risk = price_at_high - mid_price

            # Calculate R:R Ratio
            if risk >= 0:
                risk_ratio = 999.9  # Infinite
            elif reward <= 0:
                risk_ratio = 0.0
            else:
                risk_ratio = round(reward / abs(risk), 2)
        
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
            "reversalPct": reversal_pct,
            # Risk/Reward ratio
            "riskRatio": risk_ratio,
            # Ensure consistent High/Low data for frontend estimator
            "dayHigh": day_high,
            "dayLow": day_low
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


def calculate_ema(data: pd.Series, period: int) -> pd.Series:
    """Calculate Exponential Moving Average"""
    return data.ewm(span=period, adjust=False).mean()


def calculate_rsi(data: pd.Series, period: int = 14) -> float:
    """Calculate RSI (Relative Strength Index)"""
    delta = data.diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
    
    rs = gain / loss
    rsi = 100 - (100 / (1 + rs))
    return round(rsi.iloc[-1], 1) if not pd.isna(rsi.iloc[-1]) else 50


def calculate_atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> float:
    """Calculate Average True Range"""
    tr1 = high - low
    tr2 = abs(high - close.shift())
    tr3 = abs(low - close.shift())
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    atr = tr.rolling(window=period).mean()
    return round(atr.iloc[-1], 2) if not pd.isna(atr.iloc[-1]) else 0


def get_stock_history(ticker: str, period: str = "3mo", interval: str = "1d") -> dict:
    """
    Get stock price history with technical indicators.
    
    Args:
        ticker: Stock symbol
        period: 1d, 5d, 1mo, 3mo, 6mo, 1y
        interval: 1m, 5m, 15m, 1h, 1d, 1wk, 1mo
    """
    try:
        stock = yf.Ticker(ticker)
        
        # Get historical data
        hist = stock.history(period=period, interval=interval)
        
        if hist.empty:
            return {"error": "No historical data available", "ticker": ticker}
        
        # Calculate EMAs
        close = hist['Close']
        ema9 = calculate_ema(close, 9)
        ema20 = calculate_ema(close, 20)
        ema50 = calculate_ema(close, 50)
        ema200 = calculate_ema(close, 200)
        
        # Calculate RSI
        rsi = calculate_rsi(close)
        
        # Calculate ATR
        atr = calculate_atr(hist['High'], hist['Low'], close)
        
        # Get 52-week high/low
        try:
            info = stock.info
            week52_high = info.get('fiftyTwoWeekHigh', 0)
            week52_low = info.get('fiftyTwoWeekLow', 0)
            current_price = close.iloc[-1]
            
            pct_from_52high = round((current_price - week52_high) / week52_high * 100, 1) if week52_high else 0
            pct_from_52low = round((current_price - week52_low) / week52_low * 100, 1) if week52_low else 0
        except:
            week52_high = 0
            week52_low = 0
            pct_from_52high = 0
            pct_from_52low = 0
        
        # Get earnings date
        try:
            calendar = stock.calendar
            if calendar is not None and not calendar.empty:
                earnings_date = calendar.get('Earnings Date', [None])[0]
                earnings_str = earnings_date.strftime('%Y-%m-%d') if earnings_date else None
            else:
                earnings_str = None
        except:
            earnings_str = None
        
        # Format OHLCV data for chart
        candles = []
        for idx, row in hist.iterrows():
            timestamp = int(idx.timestamp()) if hasattr(idx, 'timestamp') else int(pd.Timestamp(idx).timestamp())
            candles.append({
                "time": timestamp,
                "open": round(row['Open'], 2),
                "high": round(row['High'], 2),
                "low": round(row['Low'], 2),
                "close": round(row['Close'], 2),
                "volume": int(row['Volume']),
                "ema9": round(ema9.loc[idx], 2) if not pd.isna(ema9.loc[idx]) else None,
                "ema20": round(ema20.loc[idx], 2) if not pd.isna(ema20.loc[idx]) else None,
                "ema50": round(ema50.loc[idx], 2) if not pd.isna(ema50.loc[idx]) else None,
                "ema200": round(ema200.loc[idx], 2) if not pd.isna(ema200.loc[idx]) else None,
            })
        
        return {
            "ticker": ticker.upper(),
            "period": period,
            "interval": interval,
            "candles": candles,
            "indicators": {
                "rsi": rsi,
                "atr": atr,
                "atrPercent": round(atr / current_price * 100, 2) if current_price else 0,
                "week52High": round(week52_high, 2) if week52_high else 0,
                "week52Low": round(week52_low, 2) if week52_low else 0,
                "pctFrom52High": pct_from_52high,
                "pctFrom52Low": pct_from_52low,
                "earningsDate": earnings_str,
                "currentPrice": round(current_price, 2) if current_price else 0,
                "dayHigh": round(hist['High'].iloc[-1], 2),
                "dayLow": round(hist['Low'].iloc[-1], 2),
            }
        }
        
    except Exception as e:
        return {"error": str(e), "ticker": ticker}


def detect_unusual_activity(ticker: str) -> dict:
    """Detect unusual options activity by comparing current volume to average"""
    try:
        result = get_top_volume_options(ticker, top_n=5)
        if result.get('error'):
            return result
        
        # Calculate avg volume for options (simplified - compare to OI)
        unusual_calls = []
        unusual_puts = []
        
        for opt in result.get('topCalls', []):
            vol_oi = opt.get('volOiRatio', 0)
            if vol_oi >= 2.0:  # Volume is 2x+ open interest
                unusual_calls.append({
                    **opt,
                    "unusualScore": round(vol_oi, 1),
                    "signal": "🔥 High" if vol_oi >= 5 else "⚡ Elevated"
                })
        
        for opt in result.get('topPuts', []):
            vol_oi = opt.get('volOiRatio', 0)
            if vol_oi >= 2.0:
                unusual_puts.append({
                    **opt,
                    "unusualScore": round(vol_oi, 1),
                    "signal": "🔥 High" if vol_oi >= 5 else "⚡ Elevated"
                })
        
        return {
            "ticker": ticker,
            "unusualCalls": unusual_calls,
            "unusualPuts": unusual_puts,
            "hasUnusualActivity": len(unusual_calls) > 0 or len(unusual_puts) > 0
        }
    except Exception as e:
        return {"error": str(e), "ticker": ticker}


def get_multi_timeframe_technicals(ticker: str) -> dict:
    """
    Fetch technical indicators for multiple timeframes (1m, 5m, 1h, 1d, 1wk)
    to provide AI with deep context.
    """
    timeframes = {
        "1m": {"period": "1d", "interval": "1m"},
        "5m": {"period": "5d", "interval": "5m"},
        "1h": {"period": "1mo", "interval": "60m"},
        "4h": {"period": "3mo", "interval": "60m"}, # 4h not supported by yfinance, will reuse 1h data generally or just rely on 1h/1d
        "1d": {"period": "6mo", "interval": "1d"},
        "1wk": {"period": "1y", "interval": "1wk"}
    }
    
    results = {}
    
    for tf, params in timeframes.items():
        try:
            # Skip 4h actual fetch, just reuse 1h logic or skip
            if tf == "4h":
                continue
                
            tik = yf.Ticker(ticker)
            # Fetch history
            hist = tik.history(period=params['period'], interval=params['interval'])
            
            if hist.empty:
                results[tf] = {"error": "No data"}
                continue
                
            # Basic checks
            current_price = hist['Close'].iloc[-1]
            
            # EMAs
            ema9 = hist['Close'].ewm(span=9, adjust=False).mean().iloc[-1]
            ema21 = hist['Close'].ewm(span=21, adjust=False).mean().iloc[-1]
            ema50 = hist['Close'].ewm(span=50, adjust=False).mean().iloc[-1]
            ema200 = hist['Close'].ewm(span=200, adjust=False).mean().iloc[-1]
            
            # RSI
            delta = hist['Close'].diff()
            gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
            loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
            rs = gain / loss
            rsi = 100 - (100 / (1 + rs)).iloc[-1]
            
            # Trend
            trend = "NEUTRAL"
            if current_price > ema9 > ema21:
                trend = "BULLISH"
            elif current_price < ema9 < ema21:
                trend = "BEARISH"
                
            results[tf] = {
                "price": round(current_price, 2),
                "rsi": round(rsi, 1) if not pd.isna(rsi) else 50,
                "ema9": round(ema9, 2),
                "ema21": round(ema21, 2),
                "ema50": round(ema50, 2),
                "ema200": round(ema200, 2),
                "trend": trend,
                "change": round(((current_price - hist['Open'].iloc[0]) / hist['Open'].iloc[0]) * 100, 2)
            }
            
        except Exception as e:
            results[tf] = {"error": str(e)}
            
    
    return results


def get_option_history(contract_symbol: str, period: str = "1mo", interval: str = "1d") -> dict:
    """
    Get historical price data for a specific option contract.
    Note: Intraday data for options is often unavailable or delayed on free tiers.
    """
    import io
    import contextlib
    
    try:
        # Suppress yfinance print statements by redirecting stdout/stderr
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            # Prioritize Ticker.history for single symbol to reduce noise and overhead
            tick = yf.Ticker(contract_symbol)
            try:
                data = tick.history(period=period, interval=interval)
            except Exception:
                data = pd.DataFrame()

            if data.empty:
                # Fallback to download (sometimes works when Ticker fails)
                data = yf.download(contract_symbol, period=period, interval=interval, 
                                 progress=False, auto_adjust=True, threads=False)
            
        if data.empty:
            # Return specific error to frontend so it can show a helpful message
            error_msg = f"No data found for {contract_symbol}"
            if interval in ['15m', '60m', '90m', '1h']:
                error_msg = "Intraday option data unavailable (Free Tier Limit)"
            return {"error": error_msg, "candles": []}
            
        candles = []
        for idx, row in data.iterrows():
            # Handle MultiIndex columns if present (new yfinance behavior)
            if isinstance(data.columns, pd.MultiIndex):
                # Flatten or access specific level. For single ticker download, 
                # yfinance might return (Price, Ticker) columns.
                # Assuming single ticker, we can try to access by column name directly matches
                # But safer to just look at values if we know the structure
                
                # Check if 'Close' is a tuple
                close_val = row['Close'].iloc[0] if isinstance(row['Close'], pd.Series) else row['Close']
                open_val = row['Open'].iloc[0] if isinstance(row['Open'], pd.Series) else row['Open']
                high_val = row['High'].iloc[0] if isinstance(row['High'], pd.Series) else row['High']
                low_val = row['Low'].iloc[0] if isinstance(row['Low'], pd.Series) else row['Low']
                vol_val = row['Volume'].iloc[0] if isinstance(row['Volume'], pd.Series) else row['Volume']
            else:
                close_val = row['Close']
                open_val = row['Open']
                high_val = row['High']
                low_val = row['Low']
                vol_val = row.get('Volume', 0)

            # Ensure values are floats/ints (handle weird numpy types)
            timestamp = int(idx.timestamp())
            
            # Handle NaN
            if pd.isna(close_val): continue
            
            candles.append({
                "time": timestamp,
                "open": round(float(open_val), 2),
                "high": round(float(high_val), 2),
                "low": round(float(low_val), 2),
                "close": round(float(close_val), 2),
                "volume": int(vol_val) if not pd.isna(vol_val) else 0
            })
            
        return {
            "symbol": contract_symbol,
            "period": period,
            "interval": interval,
            "candles": candles
        }
    except Exception as e:
        return {"error": str(e), "symbol": contract_symbol}


def get_ai_recommendation(options_data: dict, market_context: dict = None) -> dict:
    """
    Generate AI recommendation for best option trade using Gemini API.
    Gemini analyzes ALL options and picks the best one.
    """
    try:
        # Get ALL options (don't slice yet)
        raw_calls = options_data.get('topCalls', [])
        raw_puts = options_data.get('topPuts', [])

        # ------------------------------------------------------------------
        # STRIKE FILTERING (HARD CONSTRAINT)
        # Filter out Deep ITM (Delta > 0.80) and Far OTM (Delta < 0.20)
        # ------------------------------------------------------------------
        def is_tradeable(opt):
            try:
                # If Delta is missing, assume it's tradeable to be safe, or filter?
                # Using 0.0 default might filter it out.
                d = abs(float(opt.get('delta', 0)))
                # Range: 0.15 to 0.85 (Slightly wider to catch edge cases)
                return 0.15 <= d <= 0.85
            except:
                return False

        # Filter FIRST, then slice
        filtered_calls = [c for c in raw_calls if is_tradeable(c)]
        filtered_puts = [p for p in raw_puts if is_tradeable(p)]
        
        # Sort by Scalp Score (descending) before slicing
        # This prioritizes the "best" technical setups within the tradeable range
        filtered_calls.sort(key=lambda x: x.get('scalpScore', 0) or 0, reverse=True)
        filtered_puts.sort(key=lambda x: x.get('scalpScore', 0) or 0, reverse=True)

        # If filtering removes too many, fallback to:
        # 1. Widen filter? 
        # 2. Just take the ones closest to ATM (Delta ~0.5)?
        # For now, if empty, we take the middle of the raw list (likely ATM)
        if len(filtered_calls) < 3 and len(raw_calls) > 10:
             mid = len(raw_calls) // 2
             filtered_calls = raw_calls[max(0, mid-5):min(len(raw_calls), mid+5)]
        
        if len(filtered_puts) < 3 and len(raw_puts) > 10:
             mid = len(raw_puts) // 2
             filtered_puts = raw_puts[max(0, mid-5):min(len(raw_puts), mid+5)]
        
        # Now take top candidates for AI
        ai_calls = filtered_calls[:10]
        ai_puts = filtered_puts[:10]

        if not ai_calls and not ai_puts:
            # Last resort fallback
            ai_calls = raw_calls[:5]
            ai_puts = raw_puts[:5]
        
        if not ai_calls and not ai_puts:
            return {"error": "No options data to analyze"}
        
        print(f"[AI] GEMINI_AVAILABLE = {GEMINI_AVAILABLE}")
        
        if GEMINI_AVAILABLE:
            try:
                print(f"[AI] Calling Gemini with {len(calls)} calls and {len(puts)} puts...")
                model = genai.GenerativeModel('gemini-2.5-flash')
                
                # Get unique tickers and fetch their stock data
                all_tickers = set([c.get('ticker') for c in calls] + [p.get('ticker') for p in puts])
                stock_data = {}
                for ticker in list(all_tickers)[:5]:  # Limit to 5 stocks for speed with multi-tf fetch
                    try:
                        # Use the new multi-timeframe fetcher
                        technicals = get_multi_timeframe_technicals(ticker)
                        if technicals:
                            stock_data[ticker] = technicals
                    except:
                        pass
                
                # Format stock data section with multi-timeframe info
                stock_info = []
                for ticker, tf_data in stock_data.items():
                    info = [f"=== {ticker} MULTI-TIMEFRAME ANALYSIS ==="]
                    for tf, data in tf_data.items():
                        if "error" not in data:
                            info.append(f"[{tf}] Trend:{data.get('trend')} | Price:${data.get('price')} | RSI:{data.get('rsi')} | Change:{data.get('change')}%")
                    stock_info.append(" | ".join(info))
                
                stock_section = chr(10).join(stock_info) if stock_info else "Stock data unavailable"
                
                # Format options for the prompt
                all_options = []
                for i, c in enumerate(filtered_calls[:8]):
                     all_options.append(f"{i+1}. CALL {c.get('ticker')} ${c.get('strike')} exp:{c.get('expiry')} | Price:${c.get('lastPrice'):.2f} Δ:{c.get('delta')} γ:{c.get('gamma')} Score:{c.get('scalpScore')} Rev%:{c.get('reversalPct')}%")
                
                for i, p in enumerate(filtered_puts[:8]):
                     all_options.append(f"{i+1+len(filtered_calls[:8])}. PUT {p.get('ticker')} ${p.get('strike')} exp:{p.get('expiry')} | Price:${p.get('lastPrice'):.2f} Δ:{p.get('delta')} γ:{p.get('gamma')} Score:{p.get('scalpScore')} Rev%:{p.get('reversalPct')}%")

                options_list = chr(10).join(all_options)
                
                prompt = f"""You are an expert options day trader specializing in quick scalping plays. Analyze ALL these options and pick THE SINGLE BEST one for a quick scalp trade (hold for minutes to hours). 
TARGET: Look for options that can deliver 10-80% returns on a 0.5% - 5% quick stock move. Avoid options that are too far OTM to profit from small moves.

STOCK TECHNICAL DATA (MULTI-TIMEFRAME):
{stock_section}

OPTIONS TO ANALYZE:
{options_list}

CRITERIA TO CONSIDER:
- **STRIKE SELECTION (CRITICAL)**: PREFER strikes that are At-The-Money (ATM) or slightly Out-Of-The-Money (OTM).
    - **Ideal Delta**: 0.30 to 0.65. This offers the best balance of speed and leverage.
    - **AVOID Deep ITM**: Do NOT pick options with Delta > 0.80. They are too expensive and lack leverage.
    - **AVOID Far OTM**: Do NOT pick Delta < 0.20 unless it's a "lotto" runner-up.
- **MULTI-TIMEFRAME ALIGNMENT**: Look for alignment between 5m/15m momentum and 1h/1d trends.
- **RSI**: < 30 (oversold) good for calls, > 70 (overbought) good for puts.
- **Scalp Score**: Higher is better.

FORMAT YOUR RESPONSE EXACTLY LIKE THIS:
PICK: [Option Number]
TICKER: [Ticker Symbol]
TYPE: [CALL or PUT]
STRIKE: [Strike Price]
REASONING: [2-3 sentences explaining why this is the best scalp. Explicitly reference the MULTI-TIMEFRAME alignment (e.g. "Daily is bullish and 5m is oversold..."). Mention Greeks/Score.]
PLAN: Entry: [Entry Price/Condition] | SL: [Stop Loss Price] | TP: [Take Profit Price]
CONFIDENCE: [HIGH/MEDIUM/LOW]

RUNNER UPS:
1. [Option Number] [Type] [Strike] (Reason: short reason)
2. [Option Number] [Type] [Strike] (Reason: short reason)
3. [Option Number] [Type] [Strike] (Reason: short reason)
4. [Option Number] [Type] [Strike] (Reason: short reason)
"""
                response = model.generate_content(prompt)
                ai_text = response.text.strip()
                print(f"[AI] Gemini response:\n{ai_text}")
                
                
                # Parse the response
                lines = ai_text.split('\n')
                pick_num = None
                reasoning = ""
                plan = ""
                confidence = "medium"
                runner_up_details = {}
                
                for line in lines:
                    line = line.strip()
                    if line.startswith('PICK:'):
                        try:
                            pick_num = int(line.replace('PICK:', '').strip().split()[0]) - 1
                        except:
                            pass
                    elif line.startswith('REASONING:'):
                        reasoning = line.replace('REASONING:', '').strip()
                    elif line.startswith('PLAN:'):
                        plan = line.replace('PLAN:', '').strip()
                    elif line.startswith('CONFIDENCE:'):
                        conf = line.replace('CONFIDENCE:', '').strip().lower()
                        if 'high' in conf:
                            confidence = 'high'
                        elif 'low' in conf:
                            confidence = 'low'
                        else:
                            confidence = 'medium'
                    # Parse runner ups like "1. 5 CALL 155 (Reason: ...)"
                    elif line.lower().startswith('1.') or line.lower().startswith('2.') or line.lower().startswith('3.') or line.lower().startswith('4.'):
                         try:
                             # Extract option index (basic heuristic)
                             parts = line.split()
                             # Try to find the option number in the string
                             for part in parts:
                                 if part.replace('.', '').isdigit():
                                     idx = int(part.replace('.', '')) - 1
                                     # Extract reason inside parens or after colon
                                     reason = ""
                                     if '(' in line and ')' in line:
                                         reason = line.split('(')[1].split(')')[0].replace('Reason:', '').strip()
                                     elif ':' in line: # Fallback if no parens
                                         reason = line.split(':')[-1].strip()
                                     runner_up_details[idx] = reason
                                     break
                         except:
                             pass

                # Get the picked option
                all_opts = calls + puts
                if pick_num is not None and 0 <= pick_num < len(all_opts):
                    recommendation = all_opts[pick_num]
                else:
                    # Fallback to highest score if parsing failed
                    recommendation = max(all_opts, key=lambda x: x.get('scalpScore', 0))
                    reasoning = reasoning or f"Selected based on highest scalp score of {recommendation.get('scalpScore')}."
                
                # Get runner-up picks (use AI suggestions if parsed, else fallback to score)
                runner_ups = []
                # If we parsed runner ups successfully, try to map them
                if runner_up_details:
                     for idx, reason in runner_up_details.items():
                         if 0 <= idx < len(all_opts) and all_opts[idx].get('contractSymbol') != recommendation.get('contractSymbol'):
                             opt = all_opts[idx]
                             runner_ups.append({
                                "ticker": opt.get('ticker'),
                                "type": opt.get('type'),
                                "strike": opt.get('strike'),
                                "expiry": opt.get('expiry'),
                                "price": opt.get('lastPrice'),
                                "scalpScore": opt.get('scalpScore'),
                                "reversalPct": opt.get('reversalPct'),
                                "reason": reason # Add the specific AI reason
                             })
                
                # Fallback if no runner ups parsed or not enough
                if len(runner_ups) < 4:
                     sorted_opts = sorted(all_opts, key=lambda x: x.get('scalpScore', 0), reverse=True)
                     for opt in sorted_opts[:8]: # Check top 8 to fill gaps
                        if len(runner_ups) >= 4: break
                        if opt.get('contractSymbol') != recommendation.get('contractSymbol') and not any(r['ticker'] == opt.get('ticker') and r['strike'] == opt.get('strike') for r in runner_ups):
                             runner_ups.append({
                                "ticker": opt.get('ticker'),
                                "type": opt.get('type'),
                                "strike": opt.get('strike'),
                                "expiry": opt.get('expiry'),
                                "price": opt.get('lastPrice'),
                                "scalpScore": opt.get('scalpScore'),
                                "reason": "High scalp score & technical alignment" # Generic fallback reason
                             })

                return {
                    "recommendation": {
                        "ticker": recommendation.get('ticker'),
                        "type": recommendation.get('type'),
                        "strike": recommendation.get('strike'),
                        "expiry": recommendation.get('expiry'),
                        "price": recommendation.get('lastPrice'),
                        "scalpScore": recommendation.get('scalpScore'),
                        "reversalPct": recommendation.get('reversalPct'),
                        "delta": recommendation.get('delta'),
                        "gamma": recommendation.get('gamma'),
                        "daysToExpiry": recommendation.get('daysToExpiry'),
                        # Add full data for profit estimator
                        "ask": recommendation.get('ask'),
                        "bid": recommendation.get('bid'),
                        "impliedVolatility": recommendation.get('impliedVolatility'),
                        "openInterest": recommendation.get('openInterest'),
                        "volume": recommendation.get('volume'),
                        "inTheMoney": recommendation.get('inTheMoney'),
                    },
                    "reasoning": reasoning,
                    "plan": plan,
                    "confidence": confidence,
                    "disclaimer": "AI-generated analysis. Not financial advice.",
                    "aiPowered": True,
                    "runnerUps": runner_ups[:4] # Return top 4
                }
                    
            except Exception as e:
                print(f"[AI] Gemini error: {e}")
                # Fall through to algorithmic fallback
        
        # Fallback: algorithmic selection
        print("[AI] Using algorithmic fallback")
        all_opts = calls + puts
        recommendation = max(all_opts, key=lambda x: x.get('scalpScore', 0))
        
        return {
            "recommendation": {
                "ticker": recommendation.get('ticker'),
                "type": recommendation.get('type'),
                "strike": recommendation.get('strike'),
                "expiry": recommendation.get('expiry'),
                "price": recommendation.get('lastPrice'),
                "scalpScore": recommendation.get('scalpScore'),
                "reversalPct": recommendation.get('reversalPct'),
                "delta": recommendation.get('delta'),
                "gamma": recommendation.get('gamma'),
            },
            "reasoning": f"This {recommendation.get('type')} on {recommendation.get('ticker')} has the highest scalp score (algrothmic fallback).",
            "plan": f"ENTRY: ~${recommendation.get('lastPrice', 0):.2f} | SL: -10% | TP: +20% (Algorithmic Estimate)",
            "confidence": "medium",
            "disclaimer": "This is algorithmic analysis, not financial advice. Always do your own research.",
            "aiPowered": False
        }
        
    except Exception as e:
        print(f"[AI] Error: {e}")
        return {"error": str(e)}

