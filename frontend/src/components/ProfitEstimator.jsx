import { useState, useMemo } from 'react'

/**
 * Proper Black-Scholes option pricing approximation
 * More conservative estimates to match broker displays
 */
function estimateOptionValue(optionType, strike, stockPrice, hoursToExpiry, iv, originalHours) {
    // Risk-free rate (approximate)
    const r = 0.05

    // Time to expiry in years (trading hours: 6.5 per day, 252 days per year)
    const T = Math.max(hoursToExpiry, 0.1) / (252 * 6.5)
    const sigma = iv / 100

    // Protect against edge cases
    if (T <= 0 || sigma <= 0 || stockPrice <= 0 || strike <= 0) {
        // At expiry, return intrinsic value only
        if (optionType === 'CALL') {
            return Math.max(0, stockPrice - strike)
        } else {
            return Math.max(0, strike - stockPrice)
        }
    }

    // Black-Scholes d1 and d2
    const sqrtT = Math.sqrt(T)
    const d1 = (Math.log(stockPrice / strike) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT)
    const d2 = d1 - sigma * sqrtT

    // Normal CDF approximation (Abramowitz and Stegun)
    const normCDF = (x) => {
        const a1 = 0.254829592
        const a2 = -0.284496736
        const a3 = 1.421413741
        const a4 = -1.453152027
        const a5 = 1.061405429
        const p = 0.3275911

        const sign = x < 0 ? -1 : 1
        x = Math.abs(x) / Math.sqrt(2)

        const t = 1.0 / (1.0 + p * x)
        const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)

        return 0.5 * (1.0 + sign * y)
    }

    const Nd1 = normCDF(d1)
    const Nd2 = normCDF(d2)
    const NNd1 = normCDF(-d1)
    const NNd2 = normCDF(-d2)

    let optionValue
    if (optionType === 'CALL') {
        optionValue = stockPrice * Nd1 - strike * Math.exp(-r * T) * Nd2
    } else {
        optionValue = strike * Math.exp(-r * T) * NNd2 - stockPrice * NNd1
    }

    // Ensure minimum value (options always have some value before expiry)
    return Math.max(0.01, optionValue)
}

// Convert days to trading hours (6.5 hours per trading day)
const TRADING_HOURS_PER_DAY = 6.5

function ProfitEstimator({ option, currentPrice, onClose }) {
    const totalHours = (option.daysToExpiry || 1) * TRADING_HOURS_PER_DAY
    const [hoursToSell, setHoursToSell] = useState(Math.floor(totalHours / 2))
    const [hoveredPrice, setHoveredPrice] = useState(null)
    const [isDragging, setIsDragging] = useState(false)

    const entryPrice = option?.ask || option?.lastPrice || 0
    const iv = option.impliedVolatility || 30
    const optionType = option.type || 'CALL'
    const strike = option.strike

    // Calculate P&L data points
    const chartData = useMemo(() => {
        if (!option || !currentPrice) return []

        // Generate price range (±15% from current price)
        const minPrice = currentPrice * 0.85
        const maxPrice = currentPrice * 1.15
        const step = (maxPrice - minPrice) / 50

        // Time REMAINING on option when you sell = total time - time until sell
        const hoursRemaining = Math.max(0, totalHours - hoursToSell)

        const data = []
        for (let price = minPrice; price <= maxPrice; price += step) {
            const estimatedValue = estimateOptionValue(
                optionType,
                strike,
                price,
                hoursRemaining,  // Use remaining time, not time to sell!
                iv,
                totalHours
            )
            const profit = (estimatedValue - entryPrice) * 100 // Per contract (100 shares)

            data.push({
                stockPrice: price,
                profit: profit,
                optionValue: estimatedValue
            })
        }

        return data
    }, [option, currentPrice, hoursToSell, entryPrice, iv, optionType, strike, totalHours])

    // Calculate profit at hovered price
    const hoveredProfit = useMemo(() => {
        if (hoveredPrice === null) return null
        const hoursRemaining = Math.max(0, totalHours - hoursToSell)
        const estimatedValue = estimateOptionValue(
            optionType, strike, hoveredPrice, hoursRemaining, iv, totalHours
        )
        return {
            price: hoveredPrice,
            optionValue: estimatedValue,
            profit: (estimatedValue - entryPrice) * 100
        }
    }, [hoveredPrice, optionType, strike, hoursToSell, iv, totalHours, entryPrice])

    // Calculate breakeven
    const breakeven = useMemo(() => {
        if (!option) return 0
        if (option.type === 'CALL' || !option.type) {
            return option.strike + entryPrice
        } else {
            return option.strike - entryPrice
        }
    }, [option, entryPrice])

    // Find max profit/loss for scaling
    const { maxProfit, maxLoss, maxY } = useMemo(() => {
        if (!chartData.length) return { maxProfit: 0, maxLoss: 0, maxY: 100 }
        const profits = chartData.map(d => d.profit)
        const max = Math.max(...profits)
        const min = Math.min(...profits)
        return {
            maxProfit: max,
            maxLoss: min,
            maxY: Math.max(Math.abs(max), Math.abs(min), 100)
        }
    }, [chartData])

    const entryCost = entryPrice * 100

    // Format hours to readable date/time (PT timezone, market 6:30am-1pm)
    // Format hours to readable date/time (PT timezone, market 6:30am-1pm)
    const formatTime = (hours) => {
        // Use a small offset to prevent exact multiples wrapping to next day start
        // e.g. 6.5 hours should be "end of day 1" (1pm), not "start of day 2" (6:30am)
        const adjustedHours = Math.max(0, hours - 0.001)

        const tradingDays = Math.floor(adjustedHours / TRADING_HOURS_PER_DAY)
        const remainingHours = hours - (tradingDays * TRADING_HOURS_PER_DAY)

        // Market hours in PT: 6:30am - 1:00pm
        const marketOpenHour = 6.5
        const timeOfDay = marketOpenHour + remainingHours
        const hour = Math.floor(timeOfDay)
        const mins = Math.round((timeOfDay - hour) * 60)
        const ampm = hour >= 12 ? 'pm' : 'am'
        const displayHour = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour)
        const timeStr = `${displayHour}:${mins.toString().padStart(2, '0')}${ampm}`

        // Calculate target day by skipping weekends
        const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
        const todayIdx = new Date().getDay() // 0-6
        let currentDayIdx = todayIdx
        let daysToAdd = tradingDays

        // If today is weekend, move to start of next week (Monday) before counting
        // (Assuming we are starting from 'now', if now is Sat/Sun, trading starts Monday)
        if (currentDayIdx === 0) { // Sunday
            currentDayIdx = 1
            // No days used yet
        } else if (currentDayIdx === 6) { // Saturday
            currentDayIdx = 1
            // No days used yet
        }

        while (daysToAdd > 0) {
            currentDayIdx = (currentDayIdx + 1) % 7
            // If it's Saturday (6) or Sunday (0), it doesn't count as a trading day
            // But we still advance the calendar day.
            // Wait, simpler: just advance calendar days until we consume 'daysToAdd' trading days
            if (currentDayIdx !== 0 && currentDayIdx !== 6) {
                daysToAdd--
            }
        }

        const dayName = dayNames[currentDayIdx]

        if (tradingDays === 0) {
            return `today ${timeStr}`
        } else if (tradingDays === 1) {
            return `tomorrow ${timeStr}`
        } else {
            return `${dayName} ${timeStr}`
        }
    }

    // Handle chart mouse interaction
    const handleChartHover = (e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        const x = e.clientX - rect.left
        const percent = x / rect.width

        if (chartData.length > 0) {
            const minP = chartData[0].stockPrice
            const maxP = chartData[chartData.length - 1].stockPrice
            const price = minP + (maxP - minP) * percent
            setHoveredPrice(price)
        }
    }

    const handleChartLeave = () => {
        if (!isDragging) {
            setHoveredPrice(null)
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="profit-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <div className="modal-title">
                        <span className={`option-type ${option.type?.toLowerCase() || 'call'}`}>
                            {option.type || 'CALL'}
                        </span>
                        <h2>{option.ticker || 'Option'} ${option.strike}</h2>
                        <span className="modal-expiry">{option.expiry}</span>
                    </div>
                    <button className="close-btn" onClick={onClose}>×</button>
                </div>

                {/* Hover info shown as simple text above chart - no container to avoid resize */}

                <div className="modal-stats">
                    <div className="stat-box">
                        <span className="stat-label">entry cost</span>
                        <span className="stat-value">${entryCost.toFixed(0)}</span>
                    </div>
                    <div className="stat-box">
                        <span className="stat-label">breakeven</span>
                        <span className="stat-value">${breakeven.toFixed(2)}</span>
                    </div>
                    <div className="stat-box">
                        <span className="stat-label">current</span>
                        <span className="stat-value">${currentPrice?.toFixed(2) || '-'}</span>
                    </div>
                    <div className="stat-box">
                        <span className="stat-label">max loss</span>
                        <span className="stat-value loss">-${entryCost.toFixed(0)}</span>
                    </div>
                </div>

                {/* Time Slider - Now in hours */}
                <div className="time-slider">
                    <div className="time-header">
                        <label>sell in <strong>{formatTime(hoursToSell)}</strong></label>
                        <span className="time-hint">
                            {hoursToSell <= TRADING_HOURS_PER_DAY / 2 ? 'morning' :
                                hoursToSell <= TRADING_HOURS_PER_DAY ? 'end of day' :
                                    hoursToSell <= TRADING_HOURS_PER_DAY * 2 ? 'tomorrow' : 'later'}
                        </span>
                    </div>
                    <input
                        type="range"
                        min="0.5"
                        max={totalHours}
                        step="0.5"
                        value={hoursToSell}
                        onChange={e => setHoursToSell(parseFloat(e.target.value))}
                    />
                    <div className="slider-labels">
                        <span>30min</span>
                        <span>1 day</span>
                        <span>expiry ({option.daysToExpiry}d)</span>
                    </div>
                </div>

                {/* Interactive P&L Chart */}
                <div className="chart-section">
                    <div className="chart-container">
                        <div className="chart-y-axis">
                            <span className="y-label profit">+${maxProfit.toFixed(0)}</span>
                            <span className="y-label zero">$0</span>
                            <span className="y-label loss">-${Math.abs(maxLoss).toFixed(0)}</span>
                        </div>
                        <div
                            className="chart"
                            onMouseMove={handleChartHover}
                            onMouseLeave={handleChartLeave}
                            onMouseDown={() => setIsDragging(true)}
                            onMouseUp={() => setIsDragging(false)}
                        >
                            {/* Zero line */}
                            <div
                                className="zero-line"
                                style={{ bottom: `${(maxY - maxLoss) / (maxY * 2) * 100}%` }}
                            />

                            {/* Current price marker */}
                            <div
                                className="marker-line current"
                                style={{
                                    left: `${((currentPrice - chartData[0]?.stockPrice) / (chartData[chartData.length - 1]?.stockPrice - chartData[0]?.stockPrice)) * 100}%`
                                }}
                            >
                                <span className="marker-label">now</span>
                            </div>

                            {/* Profit/loss bars */}
                            <div className="bars">
                                {chartData.map((d, i) => {
                                    const barHeight = Math.abs(d.profit) / maxY * 50
                                    const isProfit = d.profit >= 0
                                    return (
                                        <div
                                            key={i}
                                            className={`bar ${isProfit ? 'profit' : 'loss'}`}
                                            style={{
                                                left: `${(i / chartData.length) * 100}%`,
                                                width: `${100 / chartData.length}%`,
                                                height: `${barHeight}%`,
                                                bottom: isProfit ? '50%' : 'auto',
                                                top: isProfit ? 'auto' : '50%'
                                            }}
                                        />
                                    )
                                })}
                            </div>
                        </div>
                    </div>
                    <div className="chart-x-axis">
                        <span>${chartData[0]?.stockPrice.toFixed(0)}</span>
                        <span>${currentPrice?.toFixed(0)}</span>
                        <span>${chartData[chartData.length - 1]?.stockPrice.toFixed(0)}</span>
                    </div>
                    <div className="chart-hover-info">
                        {hoveredProfit ? (
                            <>
                                <strong>${hoveredProfit.price.toFixed(2)}</strong>
                                {' → '}
                                <strong className={hoveredProfit.profit >= 0 ? 'profit' : 'loss'}>
                                    {hoveredProfit.profit >= 0 ? '+' : ''}${hoveredProfit.profit.toFixed(0)}
                                    {' ('}{hoveredProfit.profit >= 0 ? '+' : ''}{((hoveredProfit.profit / entryCost) * 100).toFixed(0)}%{')'}
                                </strong>
                            </>
                        ) : (
                            <span className="muted">drag on chart to see P/L</span>
                        )}
                    </div>
                </div>
                {/* Quick scenarios */}
                <div className="scenarios">
                    <h3>quick scenarios</h3>
                    <div className="scenario-grid">
                        {[
                            { label: '+5%', price: currentPrice * 1.05 },
                            { label: '+10%', price: currentPrice * 1.10 },
                            { label: '-5%', price: currentPrice * 0.95 },
                            { label: 'breakeven', price: breakeven }
                        ].map((s, i) => {
                            const hoursRemaining = Math.max(0, totalHours - hoursToSell)
                            const val = estimateOptionValue(optionType, strike, s.price, hoursRemaining, iv, totalHours)
                            const profit = (val - entryPrice) * 100
                            return (
                                <div
                                    key={i}
                                    className="scenario"
                                    onMouseEnter={() => setHoveredPrice(s.price)}
                                    onMouseLeave={() => setHoveredPrice(null)}
                                >
                                    <span className="scenario-label">{s.label}</span>
                                    <span className="scenario-price">${s.price.toFixed(2)}</span>
                                    <span className={`scenario-profit ${profit >= 0 ? 'profit' : 'loss'}`}>
                                        {profit >= 0 ? '+' : ''}${profit.toFixed(0)}
                                        <span className="profit-pct">({profit >= 0 ? '+' : ''}{((profit / entryCost) * 100).toFixed(0)}%)</span>
                                    </span>
                                </div>
                            )
                        })}
                    </div>
                </div>
            </div>
        </div>
    )
}

export default ProfitEstimator
