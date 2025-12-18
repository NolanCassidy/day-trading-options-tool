"""
SQLite database service for watchlists
Stores ticker watchlist (for scanner) and option watchlist (for tracking)
"""
import sqlite3
import os
from datetime import datetime
from typing import List, Optional
from contextlib import contextmanager

# Database file path - use /data for Docker persistence, fallback to local
DATA_DIR = os.environ.get('DATA_DIR', os.path.dirname(os.path.dirname(__file__)))
DB_PATH = os.path.join(DATA_DIR, 'data', 'watchlist.db')

# Default tickers (imported from current TOP_STOCKS)
DEFAULT_TICKERS = [
    # Index ETFs
    ('SPY', 'Index ETF'), ('QQQ', 'Index ETF'), ('IWM', 'Index ETF'), ('DIA', 'Index ETF'),
    ('VOO', 'Index ETF'), ('VTI', 'Index ETF'), ('VXX', 'Index ETF'), ('UVXY', 'Index ETF'),
    ('SQQQ', 'Leveraged ETF'), ('TQQQ', 'Leveraged ETF'), ('SPXL', 'Leveraged ETF'),
    ('SPXS', 'Leveraged ETF'), ('SOXL', 'Leveraged ETF'), ('SOXS', 'Leveraged ETF'),
    ('ARKK', 'Sector ETF'), ('ARKW', 'Sector ETF'), ('ARKG', 'Sector ETF'),
    ('XLK', 'Sector ETF'), ('XLV', 'Sector ETF'), ('XLI', 'Sector ETF'),
    
    # Mega-Cap Tech
    ('AAPL', 'Mega-Cap Tech'), ('MSFT', 'Mega-Cap Tech'), ('GOOGL', 'Mega-Cap Tech'),
    ('GOOG', 'Mega-Cap Tech'), ('AMZN', 'Mega-Cap Tech'), ('META', 'Mega-Cap Tech'),
    ('TSLA', 'Mega-Cap Tech'), ('NVDA', 'Mega-Cap Tech'), ('AVGO', 'Mega-Cap Tech'),
    ('ORCL', 'Mega-Cap Tech'),
    
    # Big Tech & Cloud
    ('CRM', 'Cloud/SaaS'), ('ADBE', 'Cloud/SaaS'), ('NFLX', 'Streaming'),
    ('PYPL', 'Fintech'), ('INTC', 'Semiconductors'), ('CSCO', 'Networking'),
    ('IBM', 'Enterprise'), ('QCOM', 'Semiconductors'), ('TXN', 'Semiconductors'),
    ('NOW', 'Cloud/SaaS'), ('SNOW', 'Cloud/SaaS'), ('PLTR', 'AI/Data'),
    ('UBER', 'Rideshare'), ('ABNB', 'Travel'), ('SHOP', 'E-commerce'),
    ('SQ', 'Fintech'), ('SPOT', 'Streaming'), ('DDOG', 'Cloud/SaaS'),
    ('ZS', 'Cybersecurity'), ('CRWD', 'Cybersecurity'), ('NET', 'Cloud/CDN'),
    ('MDB', 'Cloud/SaaS'), ('PANW', 'Cybersecurity'), ('OKTA', 'Cybersecurity'),
    ('TWLO', 'Cloud/SaaS'), ('ZM', 'Cloud/SaaS'), ('DOCU', 'Cloud/SaaS'),
    ('ROKU', 'Streaming'), ('U', 'Gaming'), ('RBLX', 'Gaming'),
    
    # Semiconductors
    ('AMD', 'Semiconductors'), ('MU', 'Semiconductors'), ('MRVL', 'Semiconductors'),
    ('LRCX', 'Semiconductors'), ('KLAC', 'Semiconductors'), ('AMAT', 'Semiconductors'),
    ('ASML', 'Semiconductors'), ('TSM', 'Semiconductors'), ('ON', 'Semiconductors'),
    ('ARM', 'Semiconductors'),
    
    # Crypto
    ('MSTR', 'Crypto'), ('COIN', 'Crypto'), ('MARA', 'Crypto'), ('RIOT', 'Crypto'),
    ('CLSK', 'Crypto'), ('HUT', 'Crypto'), ('BITF', 'Crypto'), ('IBIT', 'Crypto'),
    ('GBTC', 'Crypto'), ('BITO', 'Crypto'),
    
    # Financials
    ('JPM', 'Financials'), ('BAC', 'Financials'), ('WFC', 'Financials'),
    ('GS', 'Financials'), ('MS', 'Financials'), ('C', 'Financials'),
    ('SCHW', 'Financials'), ('BLK', 'Financials'), ('AXP', 'Financials'),
    ('V', 'Financials'), ('MA', 'Financials'),
    
    # Healthcare
    ('UNH', 'Healthcare'), ('JNJ', 'Healthcare'), ('PFE', 'Biotech'),
    ('MRNA', 'Biotech'), ('ABBV', 'Pharma'), ('LLY', 'Pharma'),
    ('MRK', 'Pharma'), ('BMY', 'Pharma'), ('GILD', 'Biotech'), ('AMGN', 'Biotech'),
    
    # Consumer
    ('WMT', 'Retail'), ('COST', 'Retail'), ('TGT', 'Retail'), ('HD', 'Retail'),
    ('LOW', 'Retail'), ('NKE', 'Consumer'), ('SBUX', 'Consumer'),
    ('MCD', 'Consumer'), ('KO', 'Consumer'), ('PEP', 'Consumer'),
    
    # Industrial & Energy
    ('BA', 'Industrial'), ('CAT', 'Industrial'), ('DE', 'Industrial'),
    ('GE', 'Industrial'), ('HON', 'Industrial'), ('UPS', 'Logistics'),
    ('FDX', 'Logistics'), ('XOM', 'Energy'), ('CVX', 'Energy'), ('COP', 'Energy'),
    
    # EV & Clean Energy
    ('RIVN', 'EV'), ('LCID', 'EV'), ('NIO', 'EV'), ('LI', 'EV'), ('XPEV', 'EV'),
    ('PLUG', 'Clean Energy'), ('FSLR', 'Clean Energy'), ('ENPH', 'Clean Energy'),
    ('RUN', 'Clean Energy'), ('CHPT', 'EV'),
    
    # Meme/Retail
    ('GME', 'Meme'), ('AMC', 'Meme'), ('BBBY', 'Meme'), ('SOFI', 'Fintech'),
    ('HOOD', 'Fintech'), ('AFRM', 'Fintech'), ('UPST', 'Fintech'),
    
    # Entertainment
    ('DIS', 'Entertainment'), ('CMCSA', 'Entertainment'), ('WBD', 'Entertainment'),
    ('PARA', 'Entertainment'), ('SNAP', 'Social'), ('PINS', 'Social'), ('MTCH', 'Social'),
    
    # Sector ETFs
    ('XLF', 'Sector ETF'), ('XLE', 'Sector ETF'), ('XLP', 'Sector ETF'),
    ('XLB', 'Sector ETF'), ('XLRE', 'Sector ETF'), ('XLU', 'Sector ETF'),
    ('GLD', 'Commodity ETF'), ('SLV', 'Commodity ETF'), ('USO', 'Commodity ETF'),
    ('UNG', 'Commodity ETF'), ('TLT', 'Bond ETF'), ('HYG', 'Bond ETF'),
    ('LQD', 'Bond ETF'), ('EEM', 'Intl ETF'), ('EFA', 'Intl ETF'),
    ('FXI', 'Intl ETF'), ('KWEB', 'Intl ETF'),
]


@contextmanager
def get_db():
    """Context manager for database connections"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def init_db():
    """Initialize database and tables, seeding with default tickers if empty"""
    # Ensure data directory exists
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Create ticker_watchlist table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS ticker_watchlist (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol TEXT UNIQUE NOT NULL,
                category TEXT DEFAULT 'Other',
                support_price REAL,
                resistance_price REAL,
                added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Create option_watchlist table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS option_watchlist (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                contract_symbol TEXT UNIQUE NOT NULL,
                ticker TEXT NOT NULL,
                strike REAL NOT NULL,
                expiry TEXT NOT NULL,
                option_type TEXT NOT NULL,
                notes TEXT DEFAULT '',
                added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        conn.commit()
        
        # Seed with default tickers if table is empty
        cursor.execute('SELECT COUNT(*) FROM ticker_watchlist')
        count = cursor.fetchone()[0]
        
        if count == 0:
            print("Seeding ticker watchlist with default tickers...")
            cursor.executemany(
                'INSERT OR IGNORE INTO ticker_watchlist (symbol, category) VALUES (?, ?)',
                DEFAULT_TICKERS
            )
            conn.commit()
            print(f"Added {len(DEFAULT_TICKERS)} default tickers")


# ============== TICKER WATCHLIST OPERATIONS ==============

def get_all_tickers() -> List[dict]:
    """Get all tickers from watchlist"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT symbol, category, support_price, resistance_price, added_at FROM ticker_watchlist ORDER BY symbol')
        rows = cursor.fetchall()
        return [dict(row) for row in rows]


def get_scanner_tickers() -> List[str]:
    """Get just the ticker symbols for scanning"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT symbol FROM ticker_watchlist ORDER BY symbol')
        return [row['symbol'] for row in cursor.fetchall()]


def add_ticker(symbol: str, category: str = 'Other') -> dict:
    """Add a ticker to watchlist"""
    symbol = symbol.upper().strip()
    with get_db() as conn:
        cursor = conn.cursor()
        try:
            cursor.execute(
                'INSERT INTO ticker_watchlist (symbol, category) VALUES (?, ?)',
                (symbol, category)
            )
            conn.commit()
            return {"success": True, "symbol": symbol, "category": category}
        except sqlite3.IntegrityError:
            return {"success": False, "error": f"{symbol} already in watchlist"}


def remove_ticker(symbol: str) -> dict:
    """Remove a ticker from watchlist"""
    symbol = symbol.upper().strip()
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM ticker_watchlist WHERE symbol = ?', (symbol,))
        conn.commit()
        if cursor.rowcount > 0:
            return {"success": True, "symbol": symbol}
        return {"success": False, "error": f"{symbol} not found in watchlist"}


def update_ticker_levels(symbol: str, support_price: Optional[float] = None, resistance_price: Optional[float] = None) -> dict:
    """Update support and resistance levels for a ticker"""
    symbol = symbol.upper().strip()
    with get_db() as conn:
        cursor = conn.cursor()
        
        updates = []
        params = []
        
        if support_price is not None:
            updates.append("support_price = ?")
            params.append(support_price)
        else:
            updates.append("support_price = NULL")
            
        if resistance_price is not None:
            updates.append("resistance_price = ?")
            params.append(resistance_price)
        else:
            updates.append("resistance_price = NULL")
            
        if not updates:
            return {"success": False, "error": "No updates provided"}
            
        params.append(symbol)
        query = f"UPDATE ticker_watchlist SET {', '.join(updates)} WHERE symbol = ?"
        
        cursor.execute(query, params)
        conn.commit()
        
        if cursor.rowcount > 0:
            return {"success": True, "symbol": symbol, "support_price": support_price, "resistance_price": resistance_price}
        return {"success": False, "error": f"{symbol} not found in watchlist"}


def get_ticker_levels(symbol: str) -> dict:
    """Get support and resistance levels for a ticker"""
    symbol = symbol.upper().strip()
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT support_price, resistance_price FROM ticker_watchlist WHERE symbol = ?', (symbol,))
        row = cursor.fetchone()
        if row:
            return dict(row)
        return {"support_price": None, "resistance_price": None}


# ============== OPTION WATCHLIST OPERATIONS ==============

def get_all_options() -> List[dict]:
    """Get all options from watchlist"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT contract_symbol, ticker, strike, expiry, option_type, notes, added_at 
            FROM option_watchlist 
            ORDER BY added_at DESC
        ''')
        rows = cursor.fetchall()
        return [dict(row) for row in rows]


def add_option(contract_symbol: str, ticker: str, strike: float, 
               expiry: str, option_type: str, notes: str = '') -> dict:
    """Add an option to watchlist"""
    with get_db() as conn:
        cursor = conn.cursor()
        try:
            cursor.execute('''
                INSERT INTO option_watchlist 
                (contract_symbol, ticker, strike, expiry, option_type, notes) 
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (contract_symbol, ticker.upper(), strike, expiry, option_type.upper(), notes))
            conn.commit()
            return {"success": True, "contract_symbol": contract_symbol}
        except sqlite3.IntegrityError:
            return {"success": False, "error": f"{contract_symbol} already in watchlist"}


def remove_option(contract_symbol: str) -> dict:
    """Remove an option from watchlist"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM option_watchlist WHERE contract_symbol = ?', (contract_symbol,))
        conn.commit()
        if cursor.rowcount > 0:
            return {"success": True, "contract_symbol": contract_symbol}
        return {"success": False, "error": f"{contract_symbol} not found in watchlist"}


def is_option_in_watchlist(contract_symbol: str) -> bool:
    """Check if an option is in the watchlist"""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT 1 FROM option_watchlist WHERE contract_symbol = ?', (contract_symbol,))
        return cursor.fetchone() is not None
