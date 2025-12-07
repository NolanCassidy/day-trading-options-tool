import yfinance as yf
from services.options import get_quote_lite
import json

def check_quote_lite():
    print("Testing get_quote_lite('SPY')...")
    data = get_quote_lite("SPY")
    print(json.dumps(data, indent=2))
    
    if data.get('dayHigh', 0) > 100:
        print("SUCCESS: dayHigh is valid.")
    else:
        print("FAILURE: dayHigh is 0 or missing.")

if __name__ == "__main__":
    check_quote_lite()
