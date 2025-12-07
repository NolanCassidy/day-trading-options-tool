from services.options import calculate_option_price
import math

def test_bs_price():
    print("Testing Black-Scholes Price Calculation & R:R")
    
    # Example Parameters (similar to the SPY case)
    # Stock: 685.69
    # High: 688.39
    # Low: 684.58
    # Strike: 685 (Call)
    # Expiry: ~1 day (0.0027 years)
    # IV: 18% (0.18)
    
    stock_price = 685.69
    day_high = 688.39
    day_low = 684.58
    strike = 685
    time_to_expiry = 1 / 365 # 1 day
    iv = 0.18
    r = 0.05
    
    # 1. Calculate Option Price at Current
    current_opt = calculate_option_price('call', stock_price, strike, time_to_expiry, iv, r)
    print(f"Option Price @ Current ({stock_price}): ${current_opt:.2f}")
    
    # 2. Calculate Option Price at High
    high_opt = calculate_option_price('call', day_high, strike, time_to_expiry, iv, r)
    print(f"Option Price @ High ({day_high}): ${high_opt:.2f}")
    
    # 3. Calculate Option Price at Low
    low_opt = calculate_option_price('call', day_low, strike, time_to_expiry, iv, r)
    print(f"Option Price @ Low ({day_low}): ${low_opt:.2f}")
    
    # 4. Calculate R:R
    reward = high_opt - current_opt
    risk = low_opt - current_opt # Negative
    
    print(f"\nReward: ${reward:.2f}")
    print(f"Risk: ${risk:.2f}")
    
    if risk >= 0:
        print("R:R: Infinite")
    elif reward <= 0:
        print("R:R: 0.00")
    else:
        rr = reward / abs(risk)
        print(f"R:R: {rr:.2f}")
        
    # Expected: ~1.17 based on user screenshot (119/102)
    # Note: Our inputs are approximate so result might vary slightly but should be close.
    # The previous linear method would have given ~2.44
    
    if 1.0 < rr < 1.5:
        print("\nSUCCESS: R:R is in the expected range for Option P/L.")
    elif rr > 2.0:
        print("\nFAILURE: R:R is too high (likely still reflecting stock R:R).")
    else:
        print(f"\nWARNING: R:R {rr} is outside expected range, verify inputs.")

if __name__ == "__main__":
    test_bs_price()
