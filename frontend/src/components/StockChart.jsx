import { useEffect, useRef, useState } from 'react'
import { createChart, CandlestickSeries, LineSeries, HistogramSeries } from 'lightweight-charts'
import { API_BASE } from '../config'

// --- Custom Plugin for Break-Even Background ---

class BreakevenBackgroundRenderer {
    constructor(data, optionType, chart, series) {
        this._data = data
        this._optionType = optionType
        this._chart = chart
        this._series = series
    }

    draw(target) {
        if (!this._data || this._data.length === 0 || !this._chart || !this._series) return

        target.useBitmapCoordinateSpace(scope => {
            const ctx = scope.context

            const isCall = this._optionType === 'CALL'
            const green = 'rgba(0, 210, 106, 0.15)'
            const red = 'rgba(255, 71, 87, 0.15)'

            const topColor = isCall ? green : red
            const bottomColor = isCall ? red : green

            const timeScale = this._chart.timeScale()

            // Calculate points using the series/chart APIs
            const points = this._data.map(d => {
                const x = timeScale.timeToCoordinate(d.time)
                const y = this._series.priceToCoordinate(d.value)
                return { x, y }
            }).filter(p => p.x !== null && p.y !== null)

            if (points.length < 2) return

            const xStart = points[0].x
            const xEnd = points[points.length - 1].x
            const yTop = 0
            const yBottom = scope.mediaSize.height

            // 1. Draw Top Zone (Profit for Call, Loss for Put)
            ctx.beginPath()
            ctx.fillStyle = topColor

            ctx.moveTo(points[0].x, points[0].y)
            for (let i = 1; i < points.length; i++) {
                ctx.lineTo(points[i].x, points[i].y)
            }

            ctx.lineTo(xEnd, yTop)
            ctx.lineTo(xStart, yTop)
            ctx.closePath()
            ctx.fill()

            // 2. Draw Bottom Zone using same path logic but down
            ctx.beginPath()
            ctx.fillStyle = bottomColor

            ctx.moveTo(points[0].x, points[0].y)
            for (let i = 1; i < points.length; i++) {
                ctx.lineTo(points[i].x, points[i].y)
            }

            ctx.lineTo(xEnd, yBottom)
            ctx.lineTo(xStart, yBottom)
            ctx.closePath()
            ctx.fill()
        })
    }
}

class BreakevenBackground {
    constructor(data, optionType) {
        this._data = data
        this._optionType = optionType
        this._chart = null
        this._series = null
    }

    attached({ chart, series, requestUpdate }) {
        this._chart = chart
        this._series = series
        this._requestUpdate = requestUpdate
    }

    detached() {
        this._chart = null
        this._series = null
    }

    update(data, optionType) {
        this._data = data
        this._optionType = optionType
        if (this._requestUpdate) this._requestUpdate()
    }

    paneViews() {
        return [{
            renderer: () => new BreakevenBackgroundRenderer(this._data, this._optionType, this._chart, this._series)
        }]
    }
}

function StockChart({ ticker, strikes = [], defaultPeriod = '3mo', roiCurves = {}, optionType = 'CALL' }) {
    const chartContainerRef = useRef(null)
    const chartRef = useRef(null)
    const [period, setPeriod] = useState(defaultPeriod)
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [showEmas, setShowEmas] = useState({ ema9: true, ema20: true, ema50: false, ema200: false })
    const [showRoi, setShowRoi] = useState({
        p100: false, p50: false, p25: false,
        zero: true,
        l25: false, l50: false, l100: false
    })

    // Fetch history data
    useEffect(() => {
        if (!ticker) return

        const fetchHistory = async () => {
            setLoading(true)
            setError(null)
            try {
                // Map period to API params
                let apiPeriod = period
                let apiInterval = '1d'

                // Intraday periods
                if (period === '1m') {
                    apiPeriod = '1d'
                    apiInterval = '1m'
                } else if (period === '5m') {
                    apiPeriod = '5d'
                    apiInterval = '5m'
                } else if (period === '15m') {
                    apiPeriod = '5d'
                    apiInterval = '15m'
                } else if (period === '30m') {
                    apiPeriod = '5d'
                    apiInterval = '30m'
                } else if (period === '1h') {
                    apiPeriod = '1mo'
                    apiInterval = '60m'
                } else if (period === '4h') {
                    apiPeriod = '3mo'
                    apiInterval = '60m' // yfinance doesn't support 4h, use 1h
                } else if (period === '1d') {
                    apiPeriod = '6mo'
                    apiInterval = '1d'
                }

                const res = await fetch(`${API_BASE}/api/history/${ticker}?period=${apiPeriod}&interval=${apiInterval}`)
                if (res.ok) {
                    const json = await res.json()
                    if (json.error) {
                        setError(json.error)
                    } else if (json.candles && json.candles.length > 0) {
                        setData(json)
                    } else {
                        setError('No chart data available')
                    }
                } else {
                    setError('Failed to fetch chart data')
                }
            } catch (e) {
                console.error('Error fetching history:', e)
                setError('Error loading chart')
            } finally {
                setLoading(false)
            }
        }

        fetchHistory()
    }, [ticker, period])

    // Create/update chart
    useEffect(() => {
        if (!chartContainerRef.current || !data?.candles?.length) return

        const containerWidth = chartContainerRef.current.clientWidth
        if (containerWidth <= 0) return

        try {
            // Clear existing chart
            if (chartRef.current) {
                chartRef.current.remove()
                chartRef.current = null
            }

            const chart = createChart(chartContainerRef.current, {
                width: containerWidth,
                height: 300,
                layout: {
                    background: { color: '#141414' },
                    textColor: '#888',
                },
                grid: {
                    vertLines: { color: '#2a2a2a' },
                    horzLines: { color: '#2a2a2a' },
                },
                rightPriceScale: {
                    borderColor: '#2a2a2a',
                },
                timeScale: {
                    borderColor: '#2a2a2a',
                    timeVisible: true,
                },
            })

            chartRef.current = chart

            // Add candlestick series (v5 API)
            const candlestickSeries = chart.addSeries(CandlestickSeries, {
                upColor: '#00d26a',
                downColor: '#ff4757',
                borderDownColor: '#ff4757',
                borderUpColor: '#00d26a',
                wickDownColor: '#ff4757',
                wickUpColor: '#00d26a',
            })

            // Format candle data
            const candles = data.candles.map(c => ({
                time: c.time,
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close,
            }))
            candlestickSeries.setData(candles)

            // Add EMA lines (v5 API)
            if (showEmas.ema9) {
                const ema9Series = chart.addSeries(LineSeries, { color: '#ffc107', lineWidth: 1 })
                ema9Series.setData(data.candles.filter(c => c.ema9).map(c => ({ time: c.time, value: c.ema9 })))
            }
            if (showEmas.ema20) {
                const ema20Series = chart.addSeries(LineSeries, { color: '#4a9eff', lineWidth: 1 })
                ema20Series.setData(data.candles.filter(c => c.ema20).map(c => ({ time: c.time, value: c.ema20 })))
            }
            if (showEmas.ema50) {
                const ema50Series = chart.addSeries(LineSeries, { color: '#ff6b35', lineWidth: 1 })
                ema50Series.setData(data.candles.filter(c => c.ema50).map(c => ({ time: c.time, value: c.ema50 })))
            }
            if (showEmas.ema200) {
                const ema200Series = chart.addSeries(LineSeries, { color: '#e74c3c', lineWidth: 2 })
                ema200Series.setData(data.candles.filter(c => c.ema200).map(c => ({ time: c.time, value: c.ema200 })))
            }

            // Add strike price lines if provided
            strikes.forEach(strike => {
                candlestickSeries.createPriceLine({
                    price: strike,
                    color: '#9b59b6',
                    lineWidth: 1,
                    lineStyle: 2,
                    axisLabelVisible: true,
                    title: `$${strike}`,
                })
            })

            // Add volume (v5 API)
            const volumeSeries = chart.addSeries(HistogramSeries, {
                color: '#4a9eff',
                priceFormat: { type: 'volume' },
                priceScaleId: 'volume',
            })
            chart.priceScale('volume').applyOptions({
                scaleMargins: { top: 0.85, bottom: 0 },
            })
            volumeSeries.setData(data.candles.map(c => ({
                time: c.time,
                value: c.volume || 0,
                color: c.close >= c.open ? 'rgba(0, 210, 106, 0.3)' : 'rgba(255, 71, 87, 0.3)',
            }))
            )

            // Add Custom Support/Resistance Lines
            const fetchAndAddLevels = async () => {
                try {
                    const res = await fetch(`${API_BASE}/api/watchlist/tickers/levels/${ticker}`)
                    if (res.ok) {
                        const levels = await res.json()
                        if (levels.support_price) {
                            candlestickSeries.createPriceLine({
                                price: levels.support_price,
                                color: '#e91e63', // Pinkish red for support
                                lineWidth: 2,
                                lineStyle: 2, // Dashed
                                axisLabelVisible: true,
                                title: `Support: $${levels.support_price}`,
                            })
                        }
                        if (levels.resistance_price) {
                            candlestickSeries.createPriceLine({
                                price: levels.resistance_price,
                                color: '#00bcd4', // Cyan for resistance
                                lineWidth: 2,
                                lineStyle: 2, // Dashed
                                axisLabelVisible: true,
                                title: `Resistance: $${levels.resistance_price}`,
                            })
                        }
                    }
                } catch (e) {
                    console.error('Failed to fetch levels for chart:', e)
                }
            }
            fetchAndAddLevels()

            chart.timeScale().fitContent()

            // Handle resize
            const handleResize = () => {
                if (chartContainerRef.current && chartRef.current) {
                    chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth })
                }
            }
            window.addEventListener('resize', handleResize)

            // Add ROI Lines - shift to start from last candle time to eliminate gap
            if (roiCurves && data.candles.length > 0) {
                const lastCandleTime = data.candles[data.candles.length - 1].time

                // Helper to shift curve times to start from last candle
                const shiftCurveToLastCandle = (curveData) => {
                    if (!curveData || curveData.length === 0) return curveData
                    const originalStartTime = curveData[0].time
                    const timeShift = lastCandleTime - originalStartTime
                    return curveData.map(point => ({
                        ...point,
                        time: point.time + timeShift
                    }))
                }

                // 1. Zero (Break-even) - Main Line with Background
                if (showRoi.zero && roiCurves.zero && roiCurves.zero.length > 0) {
                    const shiftedZero = shiftCurveToLastCandle(roiCurves.zero)
                    const beSeries = chart.addSeries(LineSeries, {
                        color: '#ffd700', // Gold
                        lineWidth: 2,
                        lineStyle: 2, // Dashed
                        lastValueVisible: false,
                        priceLineVisible: false,
                        crosshairMarkerVisible: false,
                        title: 'Break Even'
                    })
                    beSeries.setData(shiftedZero)

                    // Attach background plugin
                    const bgPlugin = new BreakevenBackground(shiftedZero, optionType)
                    beSeries.attachPrimitive(bgPlugin)
                }

                // Helper to add ROI lines
                const addRoiLine = (data, color, title) => {
                    if (data && data.length > 0) {
                        const shiftedData = shiftCurveToLastCandle(data)
                        const s = chart.addSeries(LineSeries, {
                            color: color,
                            lineWidth: 1,
                            lineStyle: 3, // Dotted
                            lastValueVisible: false,
                            priceLineVisible: false,
                            crosshairMarkerVisible: false,
                            title: title
                        })
                        s.setData(shiftedData)
                    }
                }

                // Profit Lines (Green tint)
                if (showRoi.p25) addRoiLine(roiCurves.p25, 'rgba(0, 210, 106, 0.6)', '+25%')
                if (showRoi.p50) addRoiLine(roiCurves.p50, 'rgba(0, 210, 106, 0.8)', '+50%')
                if (showRoi.p100) addRoiLine(roiCurves.p100, '#00d26a', '+100%')

                // Loss Lines (Red tint)
                if (showRoi.l25) addRoiLine(roiCurves.l25, 'rgba(255, 71, 87, 0.6)', '-25%')
                if (showRoi.l50) addRoiLine(roiCurves.l50, 'rgba(255, 71, 87, 0.8)', '-50%')
                if (showRoi.l100) addRoiLine(roiCurves.l100, '#ff4757', '-100%')
            }

            return () => {
                window.removeEventListener('resize', handleResize)
                if (chartRef.current) {
                    chartRef.current.remove()
                    chartRef.current = null
                }
            }
        } catch (e) {
            console.error('Error creating chart:', e)
            setError('Error rendering chart: ' + e.message)
        }
    }, [data, showEmas, strikes, roiCurves, optionType])

    if (!ticker) return null

    const indicators = data?.indicators || {}

    return (
        <div className="stock-chart-section">
            <div className="chart-header">
                <div className="chart-title">
                    <h3>{ticker} Chart</h3>
                    <div className="indicator-badges">
                        {indicators.rsi && (
                            <span className={`badge ${indicators.rsi > 70 ? 'badge-red' : indicators.rsi < 30 ? 'badge-green' : ''}`}>
                                RSI: {indicators.rsi}
                            </span>
                        )}
                        {indicators.atr > 0 && (
                            <span className="badge">
                                ATR: ${indicators.atr} ({indicators.atrPercent}%)
                            </span>
                        )}
                        {indicators.pctFrom52Low !== undefined && indicators.pctFrom52Low < 10 && (
                            <span className="badge badge-green">
                                {indicators.pctFrom52Low}% from 52w low ↗
                            </span>
                        )}
                        {indicators.pctFrom52High !== undefined && indicators.pctFrom52High > -5 && (
                            <span className="badge badge-yellow">
                                {Math.abs(indicators.pctFrom52High)}% from 52w high
                            </span>
                        )}
                        {indicators.earningsDate && (
                            <span className="badge badge-yellow">
                                ⚠ Earnings: {indicators.earningsDate}
                            </span>
                        )}
                    </div>
                </div>
                <div className="chart-controls">
                    <div className="timeframe-btns">
                        {/* Intraday */}
                        {['1m', '5m', '15m', '30m', '1h', '4h'].map(p => (
                            <button
                                key={p}
                                className={`tf-btn intraday ${period === p ? 'active' : ''}`}
                                onClick={() => setPeriod(p)}
                            >
                                {p.toUpperCase()}
                            </button>
                        ))}
                        <span className="tf-divider">|</span>
                        {/* Daily+ */}
                        {['1d', '5d', '1mo', '3mo', '1y'].map(p => (
                            <button
                                key={p}
                                className={`tf-btn ${period === p ? 'active' : ''}`}
                                onClick={() => setPeriod(p)}
                            >
                                {p.toUpperCase()}
                            </button>
                        ))}
                    </div>
                    <div className="ema-toggles">
                        <label className="ema-toggle ema-9">
                            <input
                                type="checkbox"
                                checked={showEmas.ema9}
                                onChange={e => setShowEmas(s => ({ ...s, ema9: e.target.checked }))}
                            />
                            9
                        </label>
                        <label className="ema-toggle ema-20">
                            <input
                                type="checkbox"
                                checked={showEmas.ema20}
                                onChange={e => setShowEmas(s => ({ ...s, ema20: e.target.checked }))}
                            />
                            20
                        </label>
                        <label className="ema-toggle ema-50">
                            <input
                                type="checkbox"
                                checked={showEmas.ema50}
                                onChange={e => setShowEmas(s => ({ ...s, ema50: e.target.checked }))}
                            />
                            50
                        </label>
                        <label className="ema-toggle ema-200">
                            <input
                                type="checkbox"
                                checked={showEmas.ema200}
                                onChange={e => setShowEmas(s => ({ ...s, ema200: e.target.checked }))}
                            />
                            200
                        </label>
                    </div>
                </div>
                <div className="chart-controls-row-2" style={{ display: 'flex', gap: '12px', marginTop: '6px', alignItems: 'center', paddingLeft: '8px' }}>
                    <span className="control-label" style={{ fontSize: '11px', color: '#888' }}>ROI:</span>
                    <div className="roi-toggles" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {[
                            { key: 'p100', label: '+100%', color: '#00d26a' },
                            { key: 'p50', label: '+50%', color: 'rgba(0, 210, 106, 0.8)' },
                            { key: 'p25', label: '+25%', color: 'rgba(0, 210, 106, 0.6)' },
                            { key: 'zero', label: 'BE', color: '#ffd700' },
                            { key: 'l25', label: '-25%', color: 'rgba(255, 71, 87, 0.6)' },
                            { key: 'l50', label: '-50%', color: 'rgba(255, 71, 87, 0.8)' },
                            { key: 'l100', label: '-100%', color: '#ff4757' },
                        ].map(item => (
                            <label key={item.key} className="roi-toggle" style={{
                                display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', cursor: 'pointer',
                                opacity: showRoi[item.key] ? 1 : 0.5
                            }}>
                                <input
                                    type="checkbox"
                                    checked={showRoi[item.key]}
                                    onChange={e => setShowRoi(s => ({ ...s, [item.key]: e.target.checked }))}
                                    style={{ accentColor: item.color }}
                                />
                                <span style={{ color: item.color }}>{item.label}</span>
                            </label>
                        ))}
                    </div>
                </div>
            </div>

            {loading && <div className="chart-loading">Loading chart...</div>}
            {error && <div className="chart-loading" style={{ color: '#ff4757' }}>{error}</div>}
            {!loading && !error && <div ref={chartContainerRef} className="chart-container-lw" />}
        </div>
    )
}

export default StockChart
