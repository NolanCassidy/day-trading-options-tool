"""
Alpaca Markets API client for options data.
Provides historical option bars with better granularity than yfinance.

API Documentation: https://docs.alpaca.markets/reference/optionbars
Rate Limit: 200 calls/minute on basic plan
"""
import os
import requests
from datetime import datetime, timedelta
from typing import Optional, List, Dict
from dotenv import load_dotenv

# Load environment variables
load_dotenv(override=True)

# Rate limit tracking (simple counter, resets wouldn't persist across restarts)
_call_count = 0
_last_reset = datetime.now()
MAX_CALLS_PER_MINUTE = 200


def _get_credentials():
    """Get Alpaca API credentials dynamically."""
    return (
        os.getenv('ALPACA_API_KEY', ''),
        os.getenv('ALPACA_API_SECRET', ''),
        os.getenv('ALPACA_DATA_URL', 'https://data.alpaca.markets')
    )


def _get_headers() -> Dict[str, str]:
    """Get authentication headers for Alpaca API."""
    api_key, api_secret, _ = _get_credentials()
    return {
        'APCA-API-KEY-ID': api_key,
        'APCA-API-SECRET-KEY': api_secret,
        'Accept': 'application/json'
    }


def _check_rate_limit() -> bool:
    """Check if we're within rate limits. Returns True if OK to proceed."""
    global _call_count, _last_reset
    
    now = datetime.now()
    # Reset counter every minute
    if (now - _last_reset).total_seconds() >= 60:
        _call_count = 0
        _last_reset = now
    
    if _call_count >= MAX_CALLS_PER_MINUTE:
        print(f"[Alpaca] Rate limit reached: {_call_count}/{MAX_CALLS_PER_MINUTE} calls/min")
        return False
    
    return True


def _increment_call_count():
    """Increment the API call counter."""
    global _call_count
    _call_count += 1


def _map_period_to_dates(period: str) -> tuple:
    """
    Convert yfinance-style period to start/end dates.
    Returns (start_date, end_date) as ISO format strings.
    """
    now = datetime.now()
    end = now  # Include today's data
    
    period_map = {
        '1h': timedelta(hours=1),
        '4h': timedelta(hours=4),
        '1d': timedelta(days=1),
        '5d': timedelta(days=5),
        '1mo': timedelta(days=30),
        '3mo': timedelta(days=90),
    }
    
    delta = period_map.get(period, timedelta(days=5))
    start = now - delta
    
    return start.strftime('%Y-%m-%d'), end.strftime('%Y-%m-%d')


def _map_interval_to_timeframe(interval: str) -> str:
    """
    Convert yfinance-style interval to Alpaca timeframe format.
    Alpaca supports: 1Min, 5Min, 15Min, 30Min, 1Hour, 1Day, 1Week, 1Month
    """
    interval_map = {
        '1m': '1Min',
        '2m': '2Min',
        '5m': '5Min', 
        '15m': '15Min',
        '30m': '30Min',
        '1h': '1Hour',
        '60m': '1Hour',
        '1d': '1Day',
        '1wk': '1Week',
        '1mo': '1Month',
    }
    
    return interval_map.get(interval, '1Day')


def get_alpaca_option_bars(
    contract_symbol: str, 
    period: str = "5d", 
    interval: str = "1m"
) -> Optional[Dict]:
    """
    Fetch historical option bars from Alpaca.
    
    Args:
        contract_symbol: OCC-format option symbol (e.g., SPY251219C00600000)
        period: Time period (1h, 4h, 1d, 5d, 1mo, 3mo)
        interval: Bar interval (1m, 5m, 15m, 1h, 1d)
    
    Returns:
        Dict with 'candles' list or None if failed
    """
    # Get credentials dynamically
    api_key, api_secret, data_url = _get_credentials()
    
    # Check credentials
    if not api_key or not api_secret:
        print("[Alpaca] Missing API credentials")
        return None
    
    # Check rate limit
    if not _check_rate_limit():
        return None
    
    try:
        # Map parameters - only use start date, let Alpaca default end to now
        start_date, _ = _map_period_to_dates(period)
        timeframe = _map_interval_to_timeframe(interval)
        
        # Build URL - using v1beta1 options endpoint
        url = f"{data_url}/v1beta1/options/bars"
        
        # Note: Don't specify 'end' date - Alpaca defaults to 'now' without OPRA restriction
        params = {
            'symbols': contract_symbol,
            'timeframe': timeframe,
            'start': start_date,
            'limit': 10000,  # Maximum allowed
        }
        
        print(f"[Alpaca] Fetching bars for {contract_symbol}: {start_date} to now, {timeframe}")
        
        response = requests.get(url, headers=_get_headers(), params=params, timeout=10)
        _increment_call_count()
        
        if response.status_code == 429:
            print("[Alpaca] Rate limited by server (429)")
            return None
        
        if response.status_code != 200:
            print(f"[Alpaca] API error: {response.status_code} - {response.text}")
            return None
        
        data = response.json()
        
        # Alpaca returns: {"bars": {"SYMBOL": [...]}, "next_page_token": ...}
        bars_by_symbol = data.get('bars', {})
        
        # Get bars for our symbol (key might be exact or need matching)
        bars = bars_by_symbol.get(contract_symbol, [])
        
        if not bars:
            # Try uppercase version
            bars = bars_by_symbol.get(contract_symbol.upper(), [])
        
        if not bars:
            print(f"[Alpaca] No bars found for {contract_symbol}")
            return None
        
        # Convert to our candle format
        candles = []
        for bar in bars:
            try:
                # Alpaca bar format: {"t": "2024-01-15T09:30:00Z", "o": 1.5, "h": 1.6, ...}
                timestamp_str = bar.get('t', '')
                if timestamp_str:
                    # Parse ISO timestamp
                    dt = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                    timestamp = int(dt.timestamp())
                else:
                    continue
                
                candles.append({
                    "time": timestamp,
                    "open": round(float(bar.get('o', 0)), 2),
                    "high": round(float(bar.get('h', 0)), 2),
                    "low": round(float(bar.get('l', 0)), 2),
                    "close": round(float(bar.get('c', 0)), 2),
                    "volume": int(bar.get('v', 0)),
                })
            except Exception as e:
                print(f"[Alpaca] Error parsing bar: {e}")
                continue
        
        if not candles:
            return None
        
        # Sort by time just in case
        candles.sort(key=lambda x: x['time'])
        
        # --- GAP FILLING LOGIC ---
        # If there are gaps between trade bars, fill them with 'flattop' candles 
        # using the last known price. This makes the chart look smooth.
        filled_candles = []
        if candles:
            interval_sec = 60 # Default to 1 min
            if timeframe == '5Min': interval_sec = 300
            elif timeframe == '15Min': interval_sec = 900
            elif timeframe == '1Hour': interval_sec = 3600
            
            for i in range(len(candles)):
                curr_c = candles[i]
                filled_candles.append(curr_c)
                
                if i < len(candles) - 1:
                    next_c = candles[i+1]
                    gap = next_c['time'] - curr_c['time']
                    
                    # If gap is more than 1.5x interval and less than 4 hours (overnight/closed)
                    # Use 4 hours as a heuristic for intraday gaps vs market closed
                    if gap > (interval_sec * 1.5) and gap < 14400:
                        num_fill = int(gap // interval_sec) - 1
                        last_close = curr_c['close']
                        
                        for j in range(1, num_fill + 1):
                            fill_time = curr_c['time'] + (j * interval_sec)
                            filled_candles.append({
                                "time": fill_time,
                                "open": last_close,
                                "high": last_close,
                                "low": last_close,
                                "close": last_close,
                                "volume": 0,
                                "filled": True # Mark for debugging if needed
                            })
            
            # Sort again just to be 100% sure
            filled_candles.sort(key=lambda x: x['time'])
            candles = filled_candles

        print(f"[Alpaca] Fetched {len(candles)} candles (incl. gaps) for {contract_symbol}")
        
        return {
            "symbol": contract_symbol,
            "period": period,
            "interval": interval,
            "candles": candles,
            "source": "alpaca"
        }
        
    except requests.exceptions.Timeout:
        print("[Alpaca] Request timeout")
        return None
    except requests.exceptions.RequestException as e:
        print(f"[Alpaca] Request error: {e}")
        return None
    except Exception as e:
        print(f"[Alpaca] Unexpected error: {e}")
        return None


def get_alpaca_stock_bars(
    symbol: str,
    period: str = "1d",
    interval: str = "1m"
) -> Optional[Dict]:
    """
    Fetch historical stock bars from Alpaca (for future use).
    Uses the v2 stocks endpoint.
    
    Args:
        symbol: Stock ticker (e.g., SPY)
        period: Time period
        interval: Bar interval
    
    Returns:
        Dict with 'candles' list or None if failed
    """
    if not ALPACA_API_KEY or not ALPACA_API_SECRET:
        return None
    
    if not _check_rate_limit():
        return None
    
    try:
        start_date, end_date = _map_period_to_dates(period)
        timeframe = _map_interval_to_timeframe(interval)
        
        url = f"{ALPACA_DATA_URL}/v2/stocks/{symbol}/bars"
        
        params = {
            'timeframe': timeframe,
            'start': start_date,
            'end': end_date,
            'limit': 10000,
            'adjustment': 'split',  # Adjust for stock splits
        }
        
        response = requests.get(url, headers=_get_headers(), params=params, timeout=10)
        _increment_call_count()
        
        if response.status_code != 200:
            return None
        
        data = response.json()
        bars = data.get('bars', [])
        
        candles = []
        for bar in bars:
            try:
                timestamp_str = bar.get('t', '')
                if timestamp_str:
                    dt = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                    timestamp = int(dt.timestamp())
                else:
                    continue
                
                candles.append({
                    "time": timestamp,
                    "open": round(float(bar.get('o', 0)), 2),
                    "high": round(float(bar.get('h', 0)), 2),
                    "low": round(float(bar.get('l', 0)), 2),
                    "close": round(float(bar.get('c', 0)), 2),
                    "volume": int(bar.get('v', 0)),
                })
            except Exception:
                continue
        
        if not candles:
            return None
        
        return {
            "symbol": symbol,
            "period": period,
            "interval": interval,
            "candles": candles,
            "source": "alpaca"
        }
        
    except Exception as e:
        print(f"[Alpaca] Stock bars error: {e}")
        return None


# Test function
if __name__ == "__main__":
    # Test with a sample option symbol
    result = get_alpaca_option_bars("SPY251219C00600000", period="5d", interval="1m")
    if result:
        print(f"Success! Got {len(result['candles'])} candles")
        if result['candles']:
            print(f"First candle: {result['candles'][0]}")
            print(f"Last candle: {result['candles'][-1]}")
    else:
        print("Failed to fetch data")
