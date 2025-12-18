
import math
from scipy.stats import norm

def calculate_option_price(option_type: str, stock_price: float, strike: float, 
                          time_to_expiry: float, iv: float, risk_free_rate: float = 0.05) -> float:
    if time_to_expiry <= 0:
        if option_type.lower() == 'call':
            return max(0.0, stock_price - strike)
        else:
            return max(0.0, strike - stock_price)

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
    
    return max(0.01, price)

# Case: Stock is 100, Support is 95. Call Strike 100.
# Current market price (mid_price) is 0.50 (maybe market is cheap)
# IV is reported as 1.0 (100%)
current_s = 100
low_s = 95
strike = 100
iv = 1.0
mid_price = 0.50
time_now = 2/365 # 2 days left
time_target = 1.5/365 # 1.5 days left (target exit tomorrow)

price_now_theo = calculate_option_price('call', current_s, strike, time_now, iv)
price_target_theo = calculate_option_price('call', low_s, strike, time_target, iv)

print(f"Current Price (Theo): {price_now_theo:.4f}")
print(f"Current Price (Market): {mid_price:.4f}")
print(f"Target Price at Support (Theo): {price_target_theo:.4f}")

pct_gain = (price_target_theo - mid_price) / mid_price * 100
print(f"Calculated % Gain/Loss: {pct_gain:.1f}%")

if pct_gain > 0:
    print("BUG CONFIRMED: Stock dropped but code shows GAIN because theoretical price > current market price.")
else:
    print("Logic held up in this specific case.")
