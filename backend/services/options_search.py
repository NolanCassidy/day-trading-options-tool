"""
Service for searching best options based on user thesis (Target/Stop Loss/Date).
"""
import math
from datetime import datetime, timedelta
import pandas as pd
from .options import get_stock_quote, calculate_option_price, get_robust_stock_data, cached_ticker

# Constants
RISK_FREE_RATE = 0.05
MIN_VOLUME = 1  # Minimum volume to consider
MIN_OI = 1      # Minimum Open Interest to consider

def find_best_options(ticker: str, target_price: float, stop_loss: float, 
                      target_date_str: str, option_type: str) -> dict:
    """
    Find best options based on Risk:Reward ratio given a price target and date.
    
    Args:
        ticker: Stock symbol
        target_price: Expected stock price at target date
        stop_loss: Price at which to exit if thesis is wrong
        target_date_str: Date by which target is expected (YYYY-MM-DD)
        option_type: 'CALL' or 'PUT'
        
    Returns:
        Dict with list of options sorted by R:R
    """
    try:
        # 1. Validate inputs
        stock = cached_ticker(ticker)
        
        # Get current price
        try:
             data = get_robust_stock_data(stock)
             current_stock_price = data['current_price'] or target_price # Fallback
        except:
             current_stock_price = 0
             
        if not current_stock_price:
            return {"error": "Could not fetch current stock price"}

        # Parse target date
        try:
            target_date = datetime.strptime(target_date_str, '%Y-%m-%d')
            now = datetime.now()
            # Calculate time to target in years (for projection)
            days_to_target = (target_date - now).days + 1 # Include target day
            time_to_target = max(days_to_target, 0.5) / 365.0
        except ValueError:
             return {"error": "Invalid date format"}

        # 2. Get Expirations
        expirations = stock.options
        if not expirations:
             return {"error": "No options available"}

        # 3. Filter suitable expirations (must be >= target_date)
        valid_expirations = []
        target_date_date = target_date.date()
        
        for exp in expirations:
            exp_date = datetime.strptime(exp, '%Y-%m-%d').date()
            if exp_date >= target_date_date:
                valid_expirations.append(exp)
                if len(valid_expirations) >= 4: # Checking top 4 valid expirations
                    break
        
        if not valid_expirations:
             # Just return the last available expiry if none are after target date?
             # No, strict requirement for target date logic.
             return {
                 "options": [], 
                 "message": f"No expirations found on or after {target_date_str}. Try an earlier date."
             }

        results = []

        # 4. Search Options
        for expiry in valid_expirations:
            try:
                # Calculate time to expiry from NOW
                expiry_dt = datetime.strptime(expiry, '%Y-%m-%d')
                days_to_expiry_total = (expiry_dt - now).days
                time_to_expiry_now = max(days_to_expiry_total, 0.5) / 365.0
                
                # Calculate time remaining at Target Date (T - t_target)
                time_remaining_at_target = max(time_to_expiry_now - time_to_target, 0.001)

                # Fetch chain
                chain = stock.option_chain(expiry)
                opts = chain.calls if option_type == 'CALL' else chain.puts
                
                # Filter basic liquidity
                opts = opts[
                    (opts['volume'].fillna(0) >= MIN_VOLUME) | 
                    (opts['openInterest'].fillna(0) >= MIN_OI)
                ]
                
                # Filter strikes:
                # Broad filter to reduce computation
                if option_type == 'CALL':
                    # Allow anything from 50% to 200% of target/current
                    opts = opts[opts['strike'] < target_price * 2.0]
                    opts = opts[opts['strike'] > current_stock_price * 0.5]
                else:
                    opts = opts[opts['strike'] > target_price * 0.5]
                    opts = opts[opts['strike'] < current_stock_price * 2.0]

                for _, row in opts.iterrows():
                    strike = float(row['strike'])
                    bid = float(row['bid'])
                    ask = float(row['ask'])
                    last = float(row['lastPrice'])
                    
                    # Estimate entry price (ask or last if bid/ask wide/missing)
                    # Using Ask is conservative (buying).
                    entry_cost = ask if ask > 0 else last
                    
                    if entry_cost <= 0: continue
                    
                    iv = float(row['impliedVolatility'])
                    if iv <= 0 or pd.isna(iv): continue

                    # --- CORE LOGIC: Project Prices ---
                    
                    # 1. Reward Scenario: Stock hits Target Price at Target Date
                    # Value of option with `time_remaining_at_target` and stock = target_price
                    projected_reward_price = calculate_option_price(
                        option_type.lower(), 
                        target_price, 
                        strike, 
                        time_remaining_at_target, 
                        iv
                    )
                    
                    # Profit = Projected Value - Entry Cost
                    profit = projected_reward_price - entry_cost

                    # 2. Risk Scenario: Stock hits Stop Loss at Target Date
                    # Note: Worst case reasoning could also be: Stock hits SL *tomorrow*.
                    # But user prompt implies "worst case i think itll hit that target" implies holding until date?
                    # Actually user said "worst case i think itll hit that target". Usually SL is hit BEFORE target.
                    # But for R:R calc, standard is "Exit at Target vs Exit at SL".
                    # We assume we hold untill Target Date? Or we assume we hit SL *at* Target Date (worst timing for SL usually is immediate, but theta decay hurts more later).
                    # Let's align with the prompt: "assuming the target price is reached by the specified date".
                    # Implementation plan: "Projected Option Price at Stop Loss [at Target Date]"
                    # This is slightly optimistic for Risk (theta helps shorts, hurts longs). 
                    # If we hold long, theta decay hurts. So calculating at Target Date is actually conservative for Risk (more time decay).
                    # Wait, if I hold a call, and price drops to SL at Day 0, I lose Delta. if it drops to SL at Day N, I lose Delta + Theta.
                    # So calculating risk at Target Date is the "Max Loss if I hold until date and it's at SL". 
                    # If SL is hit earlier, loss might be LESS (more time value left).
                    # So calculating at Target Date is good conservative estimate for "Loss if wrong by date".
                    
                    projected_risk_price = calculate_option_price(
                        option_type.lower(), 
                        stop_loss, 
                        strike, 
                        time_remaining_at_target, 
                        iv
                    )
                    
                    # Loss = Entry Cost - Projected Value
                    # (Signed: Risk is usually negative number in my other tool, but here lets make it amount lost)
                    loss = entry_cost - projected_risk_price 
                    
                    if loss <= 0:
                        # Should not happen for long options unless projected price > entry (which means SL > current for calls? impossible if SL < current)
                        # If SL is "tight" and stock moves favorably? 
                        loss = 0.01 # Avoid div by zero

                    rr_ratio = profit / loss

                    # Always append (user wants result no matter what)
                    results.append({
                         "expiry": expiry,
                         "daysToExpiry": days_to_expiry_total,
                         "strike": strike,
                         "contractSymbol": row['contractSymbol'],
                         "ask": entry_cost,
                         "projectedReward": profit,
                         "projectedRisk": -loss, # Display as negative
                         "riskRewardRatio": rr_ratio,
                         "type": option_type,
                         "iv": iv
                    })

            except Exception as e:
                print(f"Error processing {expiry}: {e}")
                continue

        # Sort by R:R descending
        results.sort(key=lambda x: x['riskRewardRatio'], reverse=True)
        
        # Return top 20
        return {"options": results[:20]}

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"error": str(e)}
