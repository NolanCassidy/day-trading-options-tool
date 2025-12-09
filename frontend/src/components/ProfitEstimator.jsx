import { useState, useMemo, useEffect, useRef } from 'react'
import { createChart, AreaSeries } from 'lightweight-charts'
import StockChart from './StockChart'
import { API_BASE } from '../config'

/**
 * Enhanced Black-Scholes option pricing with realistic adjustments
 * Designed to match broker displays (Robinhood, etc.) more closely
 * 
 * Key improvements:
 * 1. Probability-weighted OTM discount (options lose value faster when OTM)
 * 2. Accelerated theta decay near expiry
 * 3. Bid-ask spread simulation for OTM options
 * 4. Faster convergence to intrinsic value
 */
function estimateOptionValue(optionType, strike, stockPrice, hoursToExpiry, iv, originalHours) {
    // Risk-free rate (approximate)
    const r = 0.05

    // Time to expiry in years (trading hours: 6.5 per day, 252 days per year)
    const T = Math.max(hoursToExpiry, 0.01) / (252 * 6.5)
    const sigma = iv / 100

    // Calculate intrinsic value
    let intrinsicValue
    if (optionType === 'CALL') {
        intrinsicValue = Math.max(0, stockPrice - strike)
    } else {
        intrinsicValue = Math.max(0, strike - stockPrice)
    }

    // At or very near expiry, return intrinsic value only
    if (T <= 0.0001 || sigma <= 0 || stockPrice <= 0 || strike <= 0) {
        return Math.max(0, intrinsicValue)
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

    // Raw Black-Scholes value
    let bsValue
    if (optionType === 'CALL') {
        bsValue = stockPrice * Nd1 - strike * Math.exp(-r * T) * Nd2
    } else {
        bsValue = strike * Math.exp(-r * T) * NNd2 - stockPrice * NNd1
    }

    // --- REALISTIC ADJUSTMENTS ---

    // 1. Calculate "moneyness" - how far ITM or OTM the option is
    const moneyness = optionType === 'CALL'
        ? (stockPrice - strike) / strike
        : (strike - stockPrice) / strike

    // Delta (probability of being ITM at expiry, roughly)
    const delta = optionType === 'CALL' ? Nd1 : -NNd1
    const absDelta = Math.abs(delta)

    // 2. OTM Discount: Options that are OTM should lose value VERY fast
    // This creates the "hockey stick" loss curve seen in Robinhood
    let otmDiscount = 1.0
    if (moneyness < 0) {
        // Option is OTM
        const otmPercent = Math.abs(moneyness)

        // AGGRESSIVE exponential discount for OTM options
        // At 1% OTM: ~22% discount, at 2% OTM: ~45% discount, at 3% OTM: ~64% discount
        // At 5% OTM: ~86% discount (nearly worthless time value)
        otmDiscount = Math.exp(-otmPercent * 15)

        // Hard cliff: once more than 3% OTM, time value collapses to near-zero
        if (otmPercent > 0.03) {
            otmDiscount *= 0.2 // Additional 80% haircut
        }

        // At 5%+ OTM, option is essentially at intrinsic value only
        if (otmPercent > 0.05) {
            otmDiscount = 0.01 // Near-zero time value
        }
    }

    // 3. Time decay acceleration near expiry
    // Options lose value much faster in the final hours/day
    const hoursRemaining = hoursToExpiry
    let thetaMultiplier = 1.0
    if (hoursRemaining < 6.5) {
        // Last trading day: accelerate decay significantly
        // Linear ramp from 1.0 at 6.5 hours to 3x at 0 hours
        thetaMultiplier = 1.0 + (2.0 * (1 - hoursRemaining / 6.5))
    } else if (hoursRemaining < 13) {
        // Last 2 days: moderate acceleration
        thetaMultiplier = 1.0 + (0.5 * (1 - hoursRemaining / 13))
    }

    // 4. Calculate time value and apply adjustments
    const timeValue = Math.max(0, bsValue - intrinsicValue)
    const adjustedTimeValue = timeValue * otmDiscount / thetaMultiplier

    // 5. Final option value = intrinsic + adjusted time value
    let optionValue = intrinsicValue + adjustedTimeValue

    // 6. Apply a "bid-ask simulation" discount for OTM options
    // Real markets have much wider spreads for OTM options
    if (moneyness < -0.01) {
        // More than 1% OTM: apply spread discount that scales with OTM-ness
        const spreadDiscount = 0.92 - (Math.abs(moneyness) * 2) // Steeper discount
        optionValue *= Math.max(0.70, spreadDiscount)
    }

    // 7. Ensure we don't go below intrinsic value (arbitrage floor)
    optionValue = Math.max(optionValue, intrinsicValue)

    // 8. Minimum value floor (penny options)
    // If very far OTM with little time, floor at near-zero
    if (optionValue < 0.01 && intrinsicValue === 0) {
        return 0.01
    }

    return Math.max(0.01, optionValue)
}

// Convert days to trading hours (6.5 hours per trading day)
const TRADING_HOURS_PER_DAY = 6.5

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

// Options Calculator Matrix - shows P/L percentage at various stock prices and dates
function OptionsMatrix({ option, currentPrice, entryPrice, iv, optionType, strike, totalHours, expiryDate }) {
    const [priceRange, setPriceRange] = useState({ min: null, max: null })
    const [numRows, setNumRows] = useState(20)
    const [numCols, setNumCols] = useState(12)

    // Initialize price range based on current price
    useEffect(() => {
        if (currentPrice && priceRange.min === null) {
            const range = currentPrice * 0.10 // ±10% range
            setPriceRange({
                min: Math.floor(currentPrice - range),
                max: Math.ceil(currentPrice + range)
            })
        }
    }, [currentPrice])

    // Generate matrix data
    const matrixData = useMemo(() => {
        if (!option || !entryPrice || !currentPrice || !priceRange.min || !priceRange.max) return null

        const rows = []
        const priceStep = (priceRange.max - priceRange.min) / (numRows - 1)

        // Generate column dates (from now to expiry)
        const now = new Date()
        const columnDates = []
        const totalMs = expiryDate.getTime() - now.getTime()

        for (let i = 0; i < numCols; i++) {
            const ms = now.getTime() + (totalMs * i / (numCols - 1))
            columnDates.push(new Date(ms))
        }

        // Calculate hours remaining for each column
        const columnHours = columnDates.map((date, idx) => {
            if (idx === numCols - 1) return 0.01 // Expiry
            const pct = 1 - (idx / (numCols - 1))
            return Math.max(0.01, totalHours * pct)
        })

        // CALIBRATION: Calculate what BS says at CURRENT price with CURRENT time remaining
        const bsAtCurrentPrice = estimateOptionValue(
            optionType, strike, currentPrice, totalHours, iv, totalHours
        )

        // Generate rows (from high price to low - descending)
        for (let r = numRows - 1; r >= 0; r--) {
            const stockPrice = priceRange.min + (priceStep * r)
            const row = {
                stockPrice,
                cells: []
            }

            // Generate cells for each date column
            for (let c = 0; c < numCols; c++) {
                const hoursRemaining = columnHours[c]
                const timeProgress = 1 - (hoursRemaining / Math.max(1, totalHours))

                // Apply calibration (more at now, less at expiry)
                const calibrationFactor = bsAtCurrentPrice > 0.01
                    ? (entryPrice / bsAtCurrentPrice) * (1 - timeProgress) + 1 * timeProgress
                    : 1

                const rawValue = estimateOptionValue(
                    optionType, strike, stockPrice, hoursRemaining, iv, totalHours
                )
                const estimatedValue = rawValue * calibrationFactor
                const profit = (estimatedValue - entryPrice) * 100
                const pctOfRisk = (profit / (entryPrice * 100)) * 100

                row.cells.push({
                    profit,
                    pctOfRisk,
                    date: columnDates[c]
                })
            }
            rows.push(row)
        }

        return { rows, columnDates }
    }, [option, currentPrice, entryPrice, priceRange, numRows, numCols, totalHours, iv, optionType, strike, expiryDate])

    // Get color based on percentage
    const getCellColor = (pct) => {
        if (pct >= 100) return 'rgba(0, 180, 80, 0.95)'
        if (pct >= 50) return 'rgba(0, 160, 70, 0.85)'
        if (pct >= 25) return 'rgba(0, 140, 60, 0.75)'
        if (pct >= 10) return 'rgba(0, 120, 50, 0.65)'
        if (pct >= 0) return 'rgba(0, 100, 40, 0.45)'
        if (pct >= -25) return 'rgba(200, 60, 60, 0.5)'
        if (pct >= -50) return 'rgba(200, 50, 50, 0.65)'
        if (pct >= -75) return 'rgba(180, 40, 40, 0.8)'
        return 'rgba(160, 30, 30, 0.9)'
    }

    // Format date for column header
    const formatDateHeader = (date, idx, total) => {
        if (idx === 0) return 'Now'
        if (idx === total - 1) return 'Exp'

        const month = date.getMonth() + 1
        const day = date.getDate()
        return `${month}/${day}`
    }

    if (!matrixData) {
        return <div className="options-matrix-loading">Loading matrix...</div>
    }

    return (
        <div className="options-matrix">
            <div className="matrix-controls">
                <div className="matrix-range-control">
                    <label>Price Range:</label>
                    <input
                        type="number"
                        value={priceRange.min || ''}
                        onChange={e => setPriceRange(prev => ({ ...prev, min: Number(e.target.value) }))}
                        className="matrix-range-input"
                    />
                    <span>to</span>
                    <input
                        type="number"
                        value={priceRange.max || ''}
                        onChange={e => setPriceRange(prev => ({ ...prev, max: Number(e.target.value) }))}
                        className="matrix-range-input"
                    />
                </div>
            </div>
            <div className="matrix-scroll-container">
                <table className="matrix-table">
                    <thead>
                        <tr>
                            <th className="matrix-corner">Price</th>
                            {matrixData.columnDates.map((date, idx) => (
                                <th key={idx} className="matrix-date-header">
                                    {formatDateHeader(date, idx, matrixData.columnDates.length)}
                                </th>
                            ))}
                            <th className="matrix-corner">+/-</th>
                        </tr>
                    </thead>
                    <tbody>
                        {matrixData.rows.map((row, rIdx) => {
                            const isCurrentRow = Math.abs(row.stockPrice - currentPrice) <
                                ((priceRange.max - priceRange.min) / numRows / 2)
                            return (
                                <tr key={rIdx} className={isCurrentRow ? 'matrix-current-row' : ''}>
                                    <td className="matrix-price-label">
                                        ${row.stockPrice.toFixed(0)}
                                    </td>
                                    {row.cells.map((cell, cIdx) => (
                                        <td
                                            key={cIdx}
                                            className="matrix-cell"
                                            style={{ backgroundColor: getCellColor(cell.pctOfRisk) }}
                                            title={`$${row.stockPrice.toFixed(1)} @ ${cell.date.toLocaleDateString()}: ${cell.pctOfRisk >= 0 ? '+' : ''}${cell.pctOfRisk.toFixed(0)}%`}
                                        >
                                            <span className={cell.pctOfRisk >= 0 ? 'profit' : 'loss'}>
                                                {cell.pctOfRisk >= 0 ? '+' : ''}{cell.pctOfRisk.toFixed(0)}%
                                            </span>
                                        </td>
                                    ))}
                                    <td className="matrix-pnl-summary">
                                        {row.cells[row.cells.length - 1].pctOfRisk >= 0 ? '+' : ''}
                                        {row.cells[row.cells.length - 1].pctOfRisk.toFixed(0)}%
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
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
    const totalHours = ((option.daysToExpiry || 0) + 1) * TRADING_HOURS_PER_DAY

    // Calculate expiry date once for use throughout
    const expiryDate = useMemo(() => {
        if (option.expiry) {
            const parts = option.expiry.split('-')
            return new Date(parts[0], parts[1] - 1, parts[2], 13, 0) // 1pm PT on expiry
        } else {
            const d = new Date()
            d.setDate(d.getDate() + (option.daysToExpiry || 0))
            d.setHours(13, 0, 0, 0)
            return d
        }
    }, [option.expiry, option.daysToExpiry])

    // Store actual target date instead of percentage for precision
    const [targetSellDate, setTargetSellDate] = useState(null) // null = now

    // Derive percentage and hours from target date
    const { sliderPercent, hoursToSell } = useMemo(() => {
        if (!targetSellDate) return { sliderPercent: 0, hoursToSell: 0 }
        const now = new Date()
        const totalMs = expiryDate.getTime() - now.getTime()
        const selectedMs = targetSellDate.getTime() - now.getTime()
        const percent = totalMs > 0 ? Math.max(0, Math.min(100, (selectedMs / totalMs) * 100)) : 0
        const hours = (percent / 100) * totalHours
        return { sliderPercent: percent, hoursToSell: hours }
    }, [targetSellDate, expiryDate, totalHours])
    const [isDragging, setIsDragging] = useState(false)
    const [liveCurrentPrice, setLiveCurrentPrice] = useState(currentPrice)
    const [chartRange, setChartRange] = useState({ min: null, max: null })
    const [liveDayHigh, setLiveDayHigh] = useState(option.dayHigh || 0)
    const [liveDayLow, setLiveDayLow] = useState(option.dayLow || 0)
    const [refreshing, setRefreshing] = useState(false)
    const [lastRefresh, setLastRefresh] = useState(null)
    const [inWatchlist, setInWatchlist] = useState(false)
    const [watchlistLoading, setWatchlistLoading] = useState(false)

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

    // Check if option is in watchlist on mount
    useEffect(() => {
        const checkWatchlist = async () => {
            if (!option.contractSymbol) return
            try {
                const res = await fetch(`${API_BASE}/api/watchlist/options/check/${encodeURIComponent(option.contractSymbol)}`)
                if (res.ok) {
                    const data = await res.json()
                    setInWatchlist(data.inWatchlist)
                }
            } catch (e) {
                console.error('Failed to check watchlist:', e)
            }
        }
        checkWatchlist()
    }, [option.contractSymbol])

    // Toggle watchlist status
    const toggleWatchlist = async () => {
        if (!option.contractSymbol || watchlistLoading) return
        setWatchlistLoading(true)
        try {
            if (inWatchlist) {
                // Remove from watchlist
                const res = await fetch(`${API_BASE}/api/watchlist/options/${encodeURIComponent(option.contractSymbol)}`, {
                    method: 'DELETE'
                })
                if (res.ok) setInWatchlist(false)
            } else {
                // Add to watchlist
                const res = await fetch(`${API_BASE}/api/watchlist/options`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contractSymbol: option.contractSymbol,
                        ticker: option.ticker,
                        strike: option.strike,
                        expiry: option.expiry,
                        optionType: option.type || 'CALL',
                        notes: ''
                    })
                })
                if (res.ok) setInWatchlist(true)
            }
        } catch (e) {
            console.error('Failed to toggle watchlist:', e)
        } finally {
            setWatchlistLoading(false)
        }
    }

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

    // Initialize chart range (default symmetric range based on max deviation)
    useEffect(() => {
        if (liveCurrentPrice && chartRange.min === null) {
            // Logic: find max % deviation from current to high or low
            // Double it to get the range on EACH side
            const highDist = dayHigh ? (dayHigh - liveCurrentPrice) / liveCurrentPrice : 0.05
            const lowDist = dayLow ? (liveCurrentPrice - dayLow) / liveCurrentPrice : 0.05

            // Should be positive distances
            const maxDist = Math.max(Math.abs(highDist), Math.abs(lowDist))
            // Minimum 1% range to prevent zero-range, but allow tight zoom for low vol stocks
            const rangePct = Math.max(0.01, maxDist * 2)

            const min = liveCurrentPrice * (1 - rangePct)
            const max = liveCurrentPrice * (1 + rangePct)
            setChartRange({ min, max })
        }
    }, [liveCurrentPrice, dayHigh, dayLow])

    // Calculate P&L data points
    const chartData = useMemo(() => {
        if (!option || !liveCurrentPrice) return []

        // Generate price range based on custom bounds or defaults
        // Fallback calculation mirrors useEffect logic
        // This is a bit redundant but standard for this pattern
        let minPrice = chartRange.min
        let maxPrice = chartRange.max

        if (!minPrice || !maxPrice) {
            const highDist = dayHigh ? (dayHigh - liveCurrentPrice) / liveCurrentPrice : 0.05
            const lowDist = dayLow ? (liveCurrentPrice - dayLow) / liveCurrentPrice : 0.05
            const maxDist = Math.max(Math.abs(highDist), Math.abs(lowDist))
            const rangePct = Math.max(0.01, maxDist * 2)

            minPrice = liveCurrentPrice * (1 - rangePct)
            maxPrice = liveCurrentPrice * (1 + rangePct)
        }
        const step = (maxPrice - minPrice) / 50

        // Time REMAINING on option when you sell = total time - time until sell
        const hoursRemaining = Math.max(0.01, totalHours - hoursToSell)

        // CALIBRATION: Calculate what BS says at CURRENT price with CURRENT time remaining
        // Then scale all values so that at now (hoursToSell=0), current price = entryPrice
        const bsAtCurrentPrice = estimateOptionValue(
            optionType, strike, liveCurrentPrice, totalHours, iv, totalHours
        )
        // If we're at full time (slider=0), calibrate to market price
        // As slider moves, blend towards raw BS (less calibration needed)
        const timeProgress = hoursToSell / Math.max(1, totalHours) // 0 = now, 1 = expiry
        const calibrationFactor = bsAtCurrentPrice > 0.01
            ? (entryPrice / bsAtCurrentPrice) * (1 - timeProgress) + 1 * timeProgress
            : 1

        const data = []
        for (let price = minPrice; price <= maxPrice; price += step) {
            const rawValue = estimateOptionValue(
                optionType,
                strike,
                price,
                hoursRemaining,
                iv,
                totalHours
            )
            // Apply calibration (more at slider=0, less as we approach expiry)
            const estimatedValue = rawValue * calibrationFactor
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

    // Calculate P/L at daily high and low (with calibration)
    const profitAtHigh = useMemo(() => {
        if (!dayHigh) return null
        const hoursRemaining = Math.max(0.01, totalHours - hoursToSell)
        const rawVal = estimateOptionValue(optionType, strike, dayHigh, hoursRemaining, iv, totalHours)
        // Apply same calibration as chart
        const bsAtCurrentPrice = estimateOptionValue(optionType, strike, liveCurrentPrice, totalHours, iv, totalHours)
        const timeProgress = hoursToSell / Math.max(1, totalHours)
        const calibrationFactor = bsAtCurrentPrice > 0.01
            ? (entryPrice / bsAtCurrentPrice) * (1 - timeProgress) + 1 * timeProgress
            : 1
        const val = rawVal * calibrationFactor
        return (val - entryPrice) * 100
    }, [dayHigh, optionType, strike, hoursToSell, iv, totalHours, entryPrice, liveCurrentPrice])

    const profitAtLow = useMemo(() => {
        if (!dayLow) return null
        const hoursRemaining = Math.max(0.01, totalHours - hoursToSell)
        const rawVal = estimateOptionValue(optionType, strike, dayLow, hoursRemaining, iv, totalHours)
        // Apply same calibration as chart
        const bsAtCurrentPrice = estimateOptionValue(optionType, strike, liveCurrentPrice, totalHours, iv, totalHours)
        const timeProgress = hoursToSell / Math.max(1, totalHours)
        const calibrationFactor = bsAtCurrentPrice > 0.01
            ? (entryPrice / bsAtCurrentPrice) * (1 - timeProgress) + 1 * timeProgress
            : 1
        const val = rawVal * calibrationFactor
        return (val - entryPrice) * 100
    }, [dayLow, optionType, strike, hoursToSell, iv, totalHours, entryPrice, liveCurrentPrice])

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

    // Format time display - use slider percentage to interpolate between now and expiry
    const formatTime = (hours) => {
        // Calculate what percentage of total time this represents
        const percent = totalHours > 0 ? (hours / totalHours) * 100 : 0

        if (percent === 0) return 'now'

        // Parse option expiry date (format: YYYY-MM-DD)
        let expiryDate
        if (option.expiry) {
            const parts = option.expiry.split('-')
            expiryDate = new Date(parts[0], parts[1] - 1, parts[2], 13, 0) // 1pm PT on expiry
        } else {
            // Fallback: calculate from daysToExpiry
            expiryDate = new Date()
            expiryDate.setDate(expiryDate.getDate() + (option.daysToExpiry || 0))
            expiryDate.setHours(13, 0, 0, 0)
        }

        const now = new Date()
        const totalMs = expiryDate.getTime() - now.getTime()
        const targetMs = now.getTime() + (totalMs * percent / 100)
        const targetDate = new Date(targetMs)

        // Format the date nicely
        const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
        const dayName = dayNames[targetDate.getDay()]
        const month = targetDate.getMonth() + 1
        const day = targetDate.getDate()
        const year = targetDate.getFullYear().toString().slice(-2)

        const hour = targetDate.getHours()
        const mins = targetDate.getMinutes()
        const ampm = hour >= 12 ? 'pm' : 'am'
        const displayHour = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour)
        const timeStr = `${displayHour}:${mins.toString().padStart(2, '0')}${ampm}`

        // Check if it's today or tomorrow
        const isToday = targetDate.toDateString() === now.toDateString()
        const tomorrow = new Date(now)
        tomorrow.setDate(tomorrow.getDate() + 1)
        const isTomorrow = targetDate.toDateString() === tomorrow.toDateString()

        if (isToday) {
            return `today ${timeStr}`
        } else if (isTomorrow) {
            return `tomorrow ${timeStr}`
        } else {
            return `${dayName} ${month}/${day}/${year} ${timeStr}`
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

            // Calculate profit at this price (with calibration)
            const hoursRemaining = Math.max(0.01, totalHours - hoursToSell)
            const rawValue = estimateOptionValue(
                optionType, strike, price, hoursRemaining, iv, totalHours
            )
            // Apply same calibration
            const bsAtCurrentPrice = estimateOptionValue(optionType, strike, liveCurrentPrice, totalHours, iv, totalHours)
            const timeProgress = hoursToSell / Math.max(1, totalHours)
            const calibrationFactor = bsAtCurrentPrice > 0.01
                ? (entryPrice / bsAtCurrentPrice) * (1 - timeProgress) + 1 * timeProgress
                : 1
            const estimatedValue = rawValue * calibrationFactor
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

    // --- Break-Even Curve Calculation ---

    const findBreakevenPriceForTime = (targetOptionValue, timeRemaining, volatility, totalTime, isCall, strikePrice, initialCalibration) => {
        // If very close to expiry (< 1 hour), use Intrinsic Value approximation for stability
        if (timeRemaining < 1.0) {
            return isCall ? strikePrice + targetOptionValue : strikePrice - targetOptionValue
        }

        // Binary search for StockPrice where EstimateOptionValue(...) ~= targetOptionValue
        // For CALLs: higher stock price = higher option value
        // For PUTs: lower stock price = higher option value

        let low = strikePrice * 0.3
        let high = strikePrice * 2.0
        let iterations = 0

        const getVal = (price) => {
            const rawVal = estimateOptionValue(isCall ? 'CALL' : 'PUT', strikePrice, price, timeRemaining, volatility, totalTime)
            if (initialCalibration) {
                const timeProgress = 1 - (timeRemaining / Math.max(1, totalTime))
                const currentCalibration = initialCalibration * (1 - timeProgress) + 1 * timeProgress
                return rawVal * currentCalibration
            }
            return rawVal
        }

        // Expand search range if needed
        const lowVal = getVal(low)
        const highVal = getVal(high)

        while (getVal(low) > targetOptionValue && iterations < 15) {
            low *= 0.7
            iterations++
        }
        iterations = 0
        while (getVal(high) < targetOptionValue && iterations < 15) {
            high *= 1.5
            iterations++
        }

        // Binary search - for CALLs, option value increases with stock price
        // So if current value is less than target, we need to go higher
        for (let i = 0; i < 30; i++) {
            const mid = (low + high) / 2
            const val = getVal(mid)

            if (Math.abs(val - targetOptionValue) < 0.005) return mid

            if (isCall) {
                // CALL: value increases as stock increases
                if (val < targetOptionValue) {
                    low = mid  // Need higher price for higher value
                } else {
                    high = mid // Need lower price for lower value
                }
            } else {
                // PUT: value increases as stock decreases
                if (val < targetOptionValue) {
                    high = mid // Need lower price for higher value
                } else {
                    low = mid  // Need higher price for lower value
                }
            }
        }
        return (low + high) / 2
    }

    const roiCurves = useMemo(() => {
        if (!option || !entryPrice) return {}

        const now = new Date()
        const isCall = optionType === 'CALL'

        // Calculate initial calibration (force model to match entry price at current stock price)
        // This ensures curves start at the correct P/Lv level relative to current market
        const bsAtCurrentPrice = estimateOptionValue(optionType, strike, liveCurrentPrice, totalHours, iv, totalHours)
        const initialCalibration = bsAtCurrentPrice > 0.01 ? entryPrice / bsAtCurrentPrice : 1.0

        const generateCurve = (targetValue) => {
            const points = []
            const hoursLeft = totalHours // Start from now (full time remaining)
            if (hoursLeft <= 0) return []

            const numPoints = 20
            const stepHours = hoursLeft / numPoints

            let currentUnix = Math.floor(now.getTime() / 1000)

            for (let i = 0; i <= numPoints; i++) {
                const tRemaining = hoursLeft - (i * stepHours)
                const price = findBreakevenPriceForTime(targetValue, Math.max(0.01, tRemaining), iv, totalHours, isCall, strike, initialCalibration)

                const realSecondsToAdd = (stepHours / 6.5) * 24 * 3600

                points.push({
                    time: currentUnix + Math.round(i * realSecondsToAdd),
                    value: price
                })
            }
            return points
        }

        return {
            zero: generateCurve(entryPrice),
            p25: generateCurve(entryPrice * 1.25),
            p50: generateCurve(entryPrice * 1.50),
            p100: generateCurve(entryPrice * 2.00),
            l25: generateCurve(entryPrice * 0.75),
            l50: generateCurve(entryPrice * 0.50),
            l100: generateCurve(entryPrice * 0.01), // Near $0 option value = 100% loss
        }
    }, [option, entryPrice, totalHours, iv, optionType, strike])

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
                <button
                    className={`watchlist-btn ${inWatchlist ? 'active' : ''}`}
                    onClick={toggleWatchlist}
                    disabled={watchlistLoading}
                    title={inWatchlist ? 'Remove from watchlist' : 'Add to watchlist'}
                >
                    {watchlistLoading ? '...' : inWatchlist ? '★ Saved' : '☆ Save'}
                </button>
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
                        <label>sell in <strong>{!targetSellDate ? 'now' : formatTime(hoursToSell)}</strong> {targetSellDate && <span className="tz-label">PT</span>}</label>
                        <div className="time-input-group">
                            <input
                                type="datetime-local"
                                className="datetime-input"
                                value={targetSellDate ? (() => {
                                    const pad = n => n.toString().padStart(2, '0')
                                    return `${targetSellDate.getFullYear()}-${pad(targetSellDate.getMonth() + 1)}-${pad(targetSellDate.getDate())}T${pad(targetSellDate.getHours())}:${pad(targetSellDate.getMinutes())}`
                                })() : ''}
                                onChange={(e) => {
                                    if (!e.target.value) {
                                        setTargetSellDate(null)
                                        return
                                    }
                                    setTargetSellDate(new Date(e.target.value))
                                }}
                                min={new Date().toISOString().slice(0, 16)}
                                max={option.expiry ? `${option.expiry}T13:00` : undefined}
                            />
                            <span className="time-hint">
                                {sliderPercent === 0 ? 'breakeven' :
                                    sliderPercent < 10 ? 'short-term' :
                                        sliderPercent < 50 ? 'mid-term' : 'long-term'}
                            </span>
                        </div>
                    </div>
                    <input
                        type="range"
                        min="0"
                        max="100"
                        step="0.1"
                        value={sliderPercent}
                        onChange={e => {
                            const percent = parseFloat(e.target.value)
                            if (percent === 0) {
                                setTargetSellDate(null)
                            } else {
                                const now = new Date()
                                const totalMs = expiryDate.getTime() - now.getTime()
                                const targetMs = now.getTime() + (totalMs * percent / 100)
                                setTargetSellDate(new Date(targetMs))
                            }
                        }}
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
                            <StockChart
                                ticker={option.ticker}
                                strikes={[option.strike]}
                                defaultPeriod="1m"
                                roiCurves={roiCurves}
                                optionType={optionType}
                            />
                        </div>
                    </div>
                )}
                {/* Options Calculator Matrix */}
                <div className="history-section">
                    <h3>profit/loss matrix</h3>
                    <OptionsMatrix
                        option={option}
                        currentPrice={liveCurrentPrice}
                        entryPrice={entryPrice}
                        iv={iv}
                        optionType={optionType}
                        strike={strike}
                        totalHours={totalHours}
                        expiryDate={expiryDate}
                    />
                </div>
            </div>
        </div>
    )
}

export default ProfitEstimator
