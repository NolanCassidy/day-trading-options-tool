import yfinance as yf
from services.options import get_robust_stock_data

def check_fix():
    print("Testing get_robust_stock_data with SPY...")
    spy = yf.Ticker("SPY")
    
    # 1. Normal fetch
    print("\n--- Normal Fetch ---")
    data = get_robust_stock_data(spy)
    print(f"Current Price: {data['current_price']}")
    print(f"Day High: {data['day_high']}")
    print(f"Day Low: {data['day_low']}")
    
    # 2. Simulated failure (mocking)
    print("\n--- Simulated FastInfo Failure ---")
    # We can't easily mock internal yfinance properties on an instance without a mocking lib or subclassing
    # But we can create a dummy object that fails access
    
    class BrokenTicker:
        def __init__(self, ticker):
            self.ticker = ticker
            self.real = yf.Ticker(ticker)
        
        @property
        def fast_info(self):
            raise Exception("Fast info broken")
            
        @property
        def info(self):
            # Return partial info
            return {'symbol': 'SPY'}
            
        def history(self, **kwargs):
            print(f"Calling history with {kwargs}")
            return self.real.history(**kwargs)

    broken_spy = BrokenTicker("SPY")
    data_broken = get_robust_stock_data(broken_spy)
    print(f"Current Price (Fallback): {data_broken['current_price']}")
    print(f"Day High (Fallback): {data_broken['day_high']}")
    print(f"Day Low (Fallback): {data_broken['day_low']}")
    
    # Verify values are reasonable (SPY is ~500-700)
    if data['day_high'] > 100 and data['day_low'] > 100:
        print("\nSUCCESS: Normal fetch returned reasonable values.")
    else:
        print("\nFAILURE: Normal fetch returned suspicious values.")

    # Verify fallback worked
    if data_broken['day_high'] > 100 and data_broken['day_low'] > 100:
        print("SUCCESS: Fallback returned reasonable values.")
    else:
        print("FAILURE: Fallback returned suspicious values.")
        
if __name__ == "__main__":
    check_fix()
