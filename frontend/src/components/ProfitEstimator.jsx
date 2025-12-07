import { useState, useMemo, useEffect, useRef } from 'react'
import { createChart, AreaSeries } from 'lightweight-charts'
import StockChart from './StockChart'

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

const API_BASE = 'http://localhost:8000'

function OptionHistoryChart({ contractSymbol, onBack, embedded = false }) {
    const chartContainerRef = useRef(null)
    const chartRef = useRef(null)
    const [period, setPeriod] = useState('5d')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [candles, setCandles] = useState([])

    useEffect(() => {
        const fetchHistory = async () => {
            setLoading(true)
            setError(null)
            try {
                // yfinance: 1m works for up to 7 days, 2m for up to 60 days
                // IMPORTANT: period='1d' returns NO DATA for options, so use 5d as minimum
                let yfPeriod = '5d'  // Always fetch at least 5d
                let interval = '1m'

                if (period === '1mo') {
                    yfPeriod = '1mo'
                    interval = '2m'
                } else if (period === '3mo') {
                    yfPeriod = '3mo'
                    interval = '2m'
                }

                const res = await fetch(`${API_BASE}/api/option-history/${contractSymbol}?period=${yfPeriod}&interval=${interval}`)
                const json = await res.json()

                if (json.error || !json.candles || json.candles.length === 0) {
                    setError(json.error || 'No data available')
                    setCandles([])
                } else {
                    let data = json.candles

                    // Filter for custom periods (1h, 4h, 1d) since we fetch 5d minimum
                    if (data.length > 0) {
                        const lastTime = data[data.length - 1].time
                        if (period === '1h') {
                            data = data.filter(c => c.time >= lastTime - 3600)
                        } else if (period === '4h') {
                            data = data.filter(c => c.time >= lastTime - 14400)
                        } else if (period === '1d') {
                            data = data.filter(c => c.time >= lastTime - 86400)
                        }
                    }

                    setCandles(data)
                }
            } catch (e) {
                console.error(e)
                setError('Failed to load history')
            } finally {
                setLoading(false)
            }
        }

        if (contractSymbol) fetchHistory()
    }, [contractSymbol, period])

    useEffect(() => {
        if (!chartContainerRef.current || candles.length === 0) return

        const handleResize = () => {
            if (chartRef.current && chartContainerRef.current) {
                chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth })
            }
        }

        if (chartRef.current) {
            chartRef.current.remove()
        }

        const chart = createChart(chartContainerRef.current, {
            layout: { background: { color: 'transparent' }, textColor: '#ccc' },
            grid: { vertLines: { color: '#333' }, horzLines: { color: '#333' } },
            width: chartContainerRef.current.clientWidth,
            height: embedded ? 180 : 250,
            timeScale: {
                timeVisible: true,
                borderColor: '#444',
                // Format time better for intraday
                tickMarkFormatter: (time, tickMarkType, locale) => {
                    const date = new Date(time * 1000)
                    if (period === '1d') return date.toLocaleTimeString(locale, { hour: 'numeric', minute: 'numeric' })
                    if (period === '5d') return date.toLocaleDateString(locale, { weekday: 'short', hour: 'numeric' })
                    return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
                }
            },
            rightPriceScale: { borderColor: '#444' },
        })
        chartRef.current = chart

        const series = chart.addSeries(AreaSeries, {
            lineColor: '#2962FF',
            topColor: 'rgba(41, 98, 255, 0.3)',
            bottomColor: 'rgba(41, 98, 255, 0)',
        })

        series.setData(candles.map(c => ({
            time: c.time,
            value: c.close
        })))

        chart.timeScale().fitContent()

        window.addEventListener('resize', handleResize)
        return () => {
            window.removeEventListener('resize', handleResize)
            if (chartRef.current) {
                chartRef.current.remove()
                chartRef.current = null
            }
        }
    }, [candles, period, embedded])

    return (
        <div className={`history-view ${embedded ? 'embedded' : ''}`}>
            <div className="history-header">
                {!embedded && <button className="back-btn" onClick={onBack}>← Back</button>}
                <div className="tf-toggles">
                    {['1h', '4h', '1d', '5d', '1mo'].map(p => (
                        <button
                            key={p}
                            className={period === p ? 'active' : ''}
                            onClick={() => setPeriod(p)}
                        >
                            {p.toUpperCase()}
                        </button>
                    ))}
                </div>
            </div>
            <div className="history-chart-container" ref={chartContainerRef}>
                {loading && <div className="loader">Loading...</div>}
                {error && <div className="error">{error}</div>}
            </div>
        </div>
    )
}

// Helper for clickable axis labels
const EditableAxisLabel = ({ value, onSave }) => {
    const [isEditing, setIsEditing] = useState(false)
    const [tempValue, setTempValue] = useState(value)

    useEffect(() => setTempValue(value), [value])

    if (isEditing) {
        return (
            <input
                autoFocus
                type="number"
                value={tempValue}
                onChange={e => setTempValue(e.target.value)}
                onBlur={() => { setIsEditing(false); onSave(Number(tempValue)) }}
                onKeyDown={e => { if (e.key === 'Enter') { e.target.blur() } }}
                style={{
                    width: '50px',
                    background: '#111',
                    border: '1px solid #444',
                    color: '#fff',
                    padding: '0 4px',
                    fontSize: '12px',
                    borderRadius: '4px'
                }}
            />
        )
    }

    return (
        <span
            onClick={() => setIsEditing(true)}
            style={{ cursor: 'pointer', borderBottom: '1px dashed #666' }}
            title="Click to adjust range"
        >
            ${value?.toFixed(0)}
        </span>
    )
}

function ProfitEstimator({ option, currentPrice, onClose, onNavigate }) {
    const totalHours = (option.daysToExpiry || 1) * TRADING_HOURS_PER_DAY

    // Calculate initial time: closest future 30 min interval
    const getInitialHoursToSell = () => {
        const now = new Date()
        const day = now.getDay()
        const hours = now.getHours() + now.getMinutes() / 60
        const marketOpen = 6.5 // 6:30 AM
        const marketClose = 13.0 // 1:00 PM

        // If Weekend (Sat/Sun), default to Start of Day 1 + 30m (0.5)
        if (day === 0 || day === 6) return 0.5

        // If Before Market Open, default to Start of Day 1 + 30m (0.5)
        if (hours < marketOpen) return 0.5

        // If After Market Close, default to Start of Day 2 + 30m (6.5 + 0.5 = 7.0)
        // (Assuming 1 day passed)
        if (hours >= marketClose) return TRADING_HOURS_PER_DAY + 0.5

        // If During Market Hours
        const elapsed = hours - marketOpen
        // Round up to next 0.5 interval
        // e.g. 0.1 -> 0.5, 0.5 -> 1.0 (if we want STRICTLY future?), user said "if 2:35 go to 3"
        // 2:35 is 2.58. Ceil(2.58 * 2) / 2 = 3.0. Correct.
        let nextInterval = Math.ceil(elapsed * 2) / 2
        if (nextInterval === elapsed) nextInterval += 0.5 // Ensure it moves forward if exactly on dot?

        return Math.max(0.5, nextInterval)
    }

    const [hoursToSell, setHoursToSell] = useState(getInitialHoursToSell)
    const [isDragging, setIsDragging] = useState(false)
    const [liveCurrentPrice, setLiveCurrentPrice] = useState(currentPrice)
    const [chartRange, setChartRange] = useState({ min: null, max: null })
    const [liveDayHigh, setLiveDayHigh] = useState(option.dayHigh || 0)
    const [liveDayLow, setLiveDayLow] = useState(option.dayLow || 0)
    const [refreshing, setRefreshing] = useState(false)
    const [lastRefresh, setLastRefresh] = useState(null)

    // Use refs for hover to avoid re-renders that cause scroll jump
    const hoverLineRef = useRef(null)
    const hoverInfoRef = useRef(null)
    const hoveredPriceRef = useRef(null)

    // Lock body scroll when mounted (save scroll position)
    useEffect(() => {
        const scrollY = window.scrollY
        document.body.style.position = 'fixed'
        document.body.style.top = `-${scrollY}px`
        document.body.style.left = '0'
        document.body.style.right = '0'
        return () => {
            document.body.style.position = ''
            document.body.style.top = ''
            document.body.style.left = ''
            document.body.style.right = ''
            window.scrollTo(0, scrollY)
        }
    }, [])

    // Refresh price function
    const refreshPrice = async () => {
        if (!option.ticker || refreshing) return
        setRefreshing(true)
        try {
            const res = await fetch(`${API_BASE}/api/quote-lite/${option.ticker}`)
            if (res.ok) {
                const data = await res.json()
                if (!data.error && data.price) {
                    setLiveCurrentPrice(data.price)
                    if (data.dayHigh) setLiveDayHigh(data.dayHigh)
                    if (data.dayLow) setLiveDayLow(data.dayLow)
                    setLastRefresh(new Date())
                }
            }
        } catch (e) {
            console.error('Price refresh failed:', e)
        } finally {
            setRefreshing(false)
        }
    }

    // Auto-refresh if High/Low data is missing (e.g. from old scan or weekends)
    useEffect(() => {
        if ((!option.dayHigh || !option.dayLow) && option.ticker) {
            refreshPrice()
        }
    }, [option.dayHigh, option.dayLow, option.ticker])

    // Use Mid Price for entry to match backend R:R logic
    const midPrice = (option.bid && option.ask) ? (option.bid + option.ask) / 2 : option.lastPrice
    // Fallback to Ask if available and Mid is 0? No, mid is better. 
    // Backend: mid_price = (bid + ask) / 2 if bid and ask else last_price

    // So entry price for P/L calcs (assuming we buy at mid/market)
    // Ideally we buy at Ask, but for R:R "fair value" estimtation we use Mid.
    // The user's screenshot implies Screener R:R is better (higher) than Estimator (lower cost basis?).
    // Screener R:R = 2.43. Estimator R:R = 2.07.
    // If Reward is same, and R:R is higher, Risk (Cost) must be lower.
    // Screener uses Mid. Estimator used Ask (Entry Cost $152 vs Last $1.51).
    // Ask is usually > Mid. So Cost is higher, R:R is lower.
    // Switching to Mid will lower cost, raising R:R to match.
    const entryPrice = midPrice || option.lastPrice || 0

    const iv = option.impliedVolatility || 30
    const optionType = option.type || 'CALL'
    const strike = option.strike

    // Use live values if available, otherwise fallback to prop, otherwise calculate fallback
    const dayHigh = liveDayHigh || option.dayHigh || liveCurrentPrice * 1.01
    const dayLow = liveDayLow || option.dayLow || liveCurrentPrice * 0.99

    // Initialize chart range (default 5% buffer around High/Low)
    useEffect(() => {
        if (liveCurrentPrice && chartRange.min === null) {
            // Default: 5% below Low and 5% above High
            // If High/Low not available yet, fallback to ±10% of current
            const min = dayLow ? dayLow * 0.95 : liveCurrentPrice * 0.9
            const max = dayHigh ? dayHigh * 1.05 : liveCurrentPrice * 1.1
            setChartRange({ min, max })
        }
    }, [liveCurrentPrice, dayHigh, dayLow])

    // Calculate P&L data points
    const chartData = useMemo(() => {
        if (!option || !liveCurrentPrice) return []

        // Generate price range based on custom bounds or defaults
        const minPrice = chartRange.min || (dayLow ? dayLow * 0.95 : liveCurrentPrice * 0.9)
        const maxPrice = chartRange.max || (dayHigh ? dayHigh * 1.05 : liveCurrentPrice * 1.1)
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
    }, [option, liveCurrentPrice, chartRange, hoursToSell, entryPrice, iv, optionType, strike, totalHours])

    // hoveredProfit is now calculated directly in handleChartHover to avoid re-renders

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

    // Calculate P/L at daily high and low
    const profitAtHigh = useMemo(() => {
        if (!dayHigh) return null
        const hoursRemaining = Math.max(0, totalHours - hoursToSell)
        const val = estimateOptionValue(optionType, strike, dayHigh, hoursRemaining, iv, totalHours)
        return (val - entryPrice) * 100
    }, [dayHigh, optionType, strike, hoursToSell, iv, totalHours, entryPrice])

    const profitAtLow = useMemo(() => {
        if (!dayLow) return null
        const hoursRemaining = Math.max(0, totalHours - hoursToSell)
        const val = estimateOptionValue(optionType, strike, dayLow, hoursRemaining, iv, totalHours)
        return (val - entryPrice) * 100
    }, [dayLow, optionType, strike, hoursToSell, iv, totalHours, entryPrice])

    // Calculate dynamic Option R:R based on P/L at High vs Low
    const dynamicRR = useMemo(() => {
        if (profitAtHigh === null || profitAtLow === null) return null

        let reward, risk
        if (optionType === 'CALL') {
            reward = profitAtHigh
            risk = profitAtLow
        } else {
            reward = profitAtLow
            risk = profitAtHigh
        }

        // Risk is usually negative (a loss). treat it as absolute cost.
        // If risk is positive (profit in both scenarios), R:R is infinite/undefined (great trade!)
        if (risk >= 0) return '∞'

        // If reward is negative (loss in both scenarios), R:R is 0
        if (reward <= 0) return '0.00'

        const ratio = reward / Math.abs(risk)
        return ratio.toFixed(2)
    }, [profitAtHigh, profitAtLow, optionType])

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

        // Calculate actual date by adding calendar days until we satisfy trading days
        // AND skipping weekends if we haven't started yet (e.g. valid today is Sunday)
        const targetDate = new Date()

        // 1. If today is weekend, advance to Monday first as "Day 0"
        while (targetDate.getDay() === 0 || targetDate.getDay() === 6) {
            targetDate.setDate(targetDate.getDate() + 1)
        }

        // 2. Add trading days (skipping weekends)
        let daysToAdd = tradingDays
        while (daysToAdd > 0) {
            targetDate.setDate(targetDate.getDate() + 1)
            if (targetDate.getDay() !== 0 && targetDate.getDay() !== 6) {
                daysToAdd--
            }
        }

        // 3. Format Date
        const dayIdx = targetDate.getDay()
        const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
        const dayName = dayNames[dayIdx]
        const month = targetDate.getMonth() + 1
        const day = targetDate.getDate()
        const year = targetDate.getFullYear().toString().slice(-2)
        const dateStr = `${month}/${day}/${year}`

        // 4. Format Label
        const now = new Date()
        const isToday = targetDate.getDate() === now.getDate() && targetDate.getMonth() === now.getMonth()
        const isTomorrow = targetDate.getDate() === now.getDate() + 1 // Simple check (issues with month end but ok for now)

        if (isToday) {
            return `today ${timeStr} (${dateStr})`
        } else if (isTomorrow) {
            return `tomorrow ${timeStr} (${dateStr})`
        } else {
            return `${dayName} ${timeStr} (${dateStr})`
        }
    }

    // Handle chart mouse interaction - use direct DOM manipulation to avoid re-renders
    const handleChartHover = (e) => {
        e.preventDefault()
        e.stopPropagation()
        const rect = e.currentTarget.getBoundingClientRect()
        const x = e.clientX - rect.left
        const percent = Math.max(0, Math.min(1, x / rect.width))

        if (chartData.length > 0 && hoverLineRef.current && hoverInfoRef.current) {
            const minP = chartData[0].stockPrice
            const maxP = chartData[chartData.length - 1].stockPrice
            const price = minP + (maxP - minP) * percent
            hoveredPriceRef.current = price

            // Calculate profit at this price
            const hoursRemaining = Math.max(0, totalHours - hoursToSell)
            const estimatedValue = estimateOptionValue(
                optionType, strike, price, hoursRemaining, iv, totalHours
            )
            const profit = (estimatedValue - entryPrice) * 100

            // Update hover line position directly
            hoverLineRef.current.style.left = `${percent * 100}%`
            hoverLineRef.current.style.opacity = '1'

            // Update hover info text directly
            const profitStr = profit >= 0 ? `+$${profit.toFixed(0)}` : `-$${Math.abs(profit).toFixed(0)}`
            const pctStr = profit >= 0 ? `+${((profit / entryCost) * 100).toFixed(0)}%` : `${((profit / entryCost) * 100).toFixed(0)}%`
            hoverInfoRef.current.innerHTML = `<strong>$${price.toFixed(2)}</strong> → <strong class="${profit >= 0 ? 'profit' : 'loss'}">${profitStr} (${pctStr})</strong>`
        }
    }

    const handleChartLeave = (e) => {
        e.preventDefault()
        if (!isDragging && hoverLineRef.current && hoverInfoRef.current) {
            hoveredPriceRef.current = null
            hoverLineRef.current.style.opacity = '0'
            hoverInfoRef.current.innerHTML = '<span class="muted">drag on chart to see P/L</span>'
        }
    }

    return (
        <div className="estimator-page">
            <div className="estimator-header">
                <button className="back-btn" onClick={onClose}>← Back to Scanner</button>
                <div className="option-info">
                    <span className={`option-type ${option.type?.toLowerCase() || 'call'}`}>
                        {option.type || 'CALL'}
                    </span>
                    <h2>
                        <span
                            className="ticker-link"
                            onClick={() => {
                                if (onNavigate && option.ticker) {
                                    onNavigate(option.ticker)
                                    onClose()
                                }
                            }}
                            style={{ cursor: option.ticker ? 'pointer' : 'default' }}
                        >
                            {option.ticker || 'Option'}
                        </span>
                        {' '}${option.strike}
                    </h2>
                    <span className="expiry-info">{option.expiry} ({option.daysToExpiry}d)</span>
                </div>
                <div className="refresh-group">
                    <button
                        className="refresh-btn"
                        onClick={refreshPrice}
                        disabled={refreshing}
                        title="Refresh price data"
                    >
                        ↻ Refresh
                    </button>
                    {lastRefresh && (
                        <span className="last-refresh">
                            {lastRefresh.toLocaleTimeString()}
                        </span>
                    )}
                </div>
            </div>

            <div className="estimator-content">
                {/* Left Column - P&L Chart and Controls */}
                <div className="estimator-main">
                    {/* Stats Row */}
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
                            <span className="stat-value">${liveCurrentPrice?.toFixed(2) || '-'}</span>
                        </div>
                        <div className="stat-box">
                            <span className="stat-label">max loss</span>
                            <span className="stat-value loss">-${entryCost.toFixed(0)}</span>
                        </div>
                        {option.reversalPct > 0 && (
                            <div className="stat-box">
                                <span className="stat-label">rev%</span>
                                <span className="stat-value profit">+{option.reversalPct}%</span>
                            </div>
                        )}

                        <div className="stat-box">
                            <span className="stat-label">R:R</span>
                            <span className="stat-value">{dynamicRR || '-'}</span>
                        </div>
                    </div>
                </div>

                {/* Time Slider */}
                <div className="time-slider">
                    <div className="time-header">
                        <label>sell in <strong>{formatTime(hoursToSell)}</strong> <span className="tz-label">PT</span></label>
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
                        <span>now</span>
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

                            {/* Hover price marker - controlled by ref */}
                            <div
                                ref={hoverLineRef}
                                className="marker-line hover"
                                style={{
                                    left: '50%',
                                    opacity: 0,
                                    pointerEvents: 'none'
                                }}
                            />

                            {/* Current price marker */}
                            <div
                                className="marker-line current"
                                style={{
                                    left: `${((liveCurrentPrice - chartData[0]?.stockPrice) / (chartData[chartData.length - 1]?.stockPrice - chartData[0]?.stockPrice)) * 100}%`
                                }}
                            >
                                <span className="marker-label">now</span>
                            </div>

                            {/* Daily High marker */}
                            {dayHigh && dayHigh >= chartData[0]?.stockPrice && dayHigh <= chartData[chartData.length - 1]?.stockPrice && (
                                <div
                                    className="marker-line high"
                                    style={{
                                        left: `${((dayHigh - chartData[0]?.stockPrice) / (chartData[chartData.length - 1]?.stockPrice - chartData[0]?.stockPrice)) * 100}%`
                                    }}
                                />
                            )}

                            {/* Daily Low marker */}
                            {dayLow && dayLow >= chartData[0]?.stockPrice && dayLow <= chartData[chartData.length - 1]?.stockPrice && (
                                <div
                                    className="marker-line low"
                                    style={{
                                        left: `${((dayLow - chartData[0]?.stockPrice) / (chartData[chartData.length - 1]?.stockPrice - chartData[0]?.stockPrice)) * 100}%`
                                    }}
                                />
                            )}

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
                        <EditableAxisLabel
                            value={chartData[0]?.stockPrice}
                            onSave={val => setChartRange(prev => ({ ...prev, min: val }))}
                        />
                        {dayLow && dayLow >= chartData[0]?.stockPrice && dayLow <= chartData[chartData.length - 1]?.stockPrice && (
                            <span className="x-label-low">${dayLow.toFixed(0)} <small>low</small></span>
                        )}
                        <span>${liveCurrentPrice?.toFixed(0)}</span>
                        {dayHigh && dayHigh >= chartData[0]?.stockPrice && dayHigh <= chartData[chartData.length - 1]?.stockPrice && (
                            <span className="x-label-high">${dayHigh.toFixed(0)} <small>high</small></span>
                        )}
                        <EditableAxisLabel
                            value={chartData[chartData.length - 1]?.stockPrice}
                            onSave={val => setChartRange(prev => ({ ...prev, max: val }))}
                        />
                    </div>
                    {/* Y-axis labels for high/low P/L */}
                    {(profitAtHigh !== null || profitAtLow !== null) && (
                        <div className="high-low-pnl">
                            {profitAtLow !== null && (
                                <span className={profitAtLow >= 0 ? 'profit' : 'loss'}>
                                    @ low: {profitAtLow >= 0 ? '+' : ''}${profitAtLow.toFixed(0)} ({profitAtLow >= 0 ? '+' : ''}{((profitAtLow / entryCost) * 100).toFixed(0)}%)
                                </span>
                            )}
                            {profitAtHigh !== null && (
                                <span className={profitAtHigh >= 0 ? 'profit' : 'loss'}>
                                    @ high: {profitAtHigh >= 0 ? '+' : ''}${profitAtHigh.toFixed(0)} ({profitAtHigh >= 0 ? '+' : ''}{((profitAtHigh / entryCost) * 100).toFixed(0)}%)
                                </span>
                            )}
                        </div>
                    )}
                    <div className="chart-hover-info" ref={hoverInfoRef}>
                        <span className="muted">drag on chart to see P/L</span>
                    </div>
                </div>
                {/* Option History Chart */}
                <div className="history-section">
                    <h3>option price history</h3>
                    <OptionHistoryChart
                        contractSymbol={option.contractSymbol}
                        onBack={() => { }}
                        embedded={true}
                    />
                </div>
                {/* Stock Price Chart */}
                {option.ticker && (
                    <div className="history-section">
                        <h3>{option.ticker} stock chart</h3>
                        <div className="embedded-stock-chart">
                            <StockChart ticker={option.ticker} strikes={[option.strike]} defaultPeriod="1m" />
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

export default ProfitEstimator
