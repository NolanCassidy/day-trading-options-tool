import React, { useState, useEffect } from 'react'
import './index.css'
import ProfitEstimator from './components/ProfitEstimator'
import StockChart from './components/StockChart'
import AIAdvisor from './components/AIAdvisor'
import { API_BASE } from './config'

// Parse URL hash for routing
const getInitialState = () => {
  const hash = window.location.hash.slice(1) // Remove #
  if (hash.startsWith('scan')) {
    return { view: 'scan', ticker: '', option: null }
  } else if (hash.startsWith('option/')) {
    // Format: option/TICKER/CONTRACTSYMBOL
    const parts = hash.replace('option/', '').split('/')
    const ticker = parts[0]?.toUpperCase() || ''
    const contractSymbol = parts[1] || ''
    return { view: 'option', ticker, contractSymbol }
  } else if (hash.startsWith('stock/')) {
    return { view: 'stock', ticker: hash.replace('stock/', '').toUpperCase(), option: null }
  }
  return { view: 'home', ticker: '', option: null }
}

function App() {
  const initialState = getInitialState()
  const [ticker, setTicker] = useState(initialState.ticker)
  const [searchTicker, setSearchTicker] = useState(initialState.ticker)
  const [quote, setQuote] = useState(null)
  const [topVolume, setTopVolume] = useState(null)
  const [scanResults, setScanResults] = useState(null)
  const [options, setOptions] = useState(null)
  const [selectedExpiry, setSelectedExpiry] = useState('')
  const [activeTab, setActiveTab] = useState('calls')
  const [topVolumeTab, setTopVolumeTab] = useState('topCalls')
  const [scanTab, setScanTab] = useState('topCalls')
  const [loading, setLoading] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState('')
  const [selectedOption, setSelectedOption] = useState(null)
  const [showAIAdvisor, setShowAIAdvisor] = useState(false)
  const [aiScope, setAiScope] = useState('both') // 'calls', 'puts', 'both'

  // Filter state
  const [filters, setFilters] = useState({
    maxPrice: 10,
    maxSpread: 0.50,
    minVolume: 0,
    maxDTE: 7,
    showFilters: false
  })
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [lastRefresh, setLastRefresh] = useState(null)

  // On mount, auto-load from URL
  useEffect(() => {
    if (initialState.view === 'scan') {
      handleScan()
    } else if (initialState.view === 'option' && initialState.ticker && initialState.contractSymbol) {
      // Load option from URL - first load the stock, then select the option
      setTicker(initialState.ticker)
      handleSearch(null, initialState.ticker).then(() => {
        // Try to find and select the option by contract symbol
        const loadOption = async () => {
          try {
            const res = await fetch(`${API_BASE}/api/options/${initialState.ticker}`)
            if (res.ok) {
              const data = await res.json()
              const allOptions = [...(data.calls || []), ...(data.puts || [])]
              const opt = allOptions.find(o => o.contractSymbol === initialState.contractSymbol)
              if (opt) {
                handleOptionClick(opt, opt.contractSymbol.includes('C') ? 'CALL' : 'PUT')
              }
            }
          } catch (e) {
            console.error('Failed to load option from URL:', e)
          }
        }
        loadOption()
      })
    } else if (initialState.view === 'stock' && initialState.ticker) {
      setTicker(initialState.ticker)
      handleSearch(null, initialState.ticker)
    }
  }, [])

  // Update URL when state changes  
  const updateURL = (view, tickerVal = '', contractSymbol = '') => {
    if (view === 'scan') {
      window.history.replaceState(null, '', '#scan')
    } else if (view === 'option' && tickerVal && contractSymbol) {
      window.history.replaceState(null, '', `#option/${tickerVal}/${contractSymbol}`)
    } else if (view === 'stock' && tickerVal) {
      window.history.replaceState(null, '', `#stock/${tickerVal}`)
    } else {
      window.history.replaceState(null, '', '#')
    }
  }

  // Manual refresh state
  const [lastQuoteRefresh, setLastQuoteRefresh] = useState(null)
  const [priceFlash, setPriceFlash] = useState(null) // 'up' | 'down' | null
  const [refreshing, setRefreshing] = useState(false)
  const prevPriceRef = React.useRef(null)

  // Manual quote refresh function
  const refreshQuote = async () => {
    if (!searchTicker || refreshing) return
    setRefreshing(true)
    try {
      const res = await fetch(`${API_BASE}/api/quote-lite/${searchTicker}`)
      if (res.ok) {
        const data = await res.json()
        if (!data.error && data.price) {
          // Detect price change direction
          if (prevPriceRef.current !== null && data.price !== prevPriceRef.current) {
            setPriceFlash(data.price > prevPriceRef.current ? 'up' : 'down')
            setTimeout(() => setPriceFlash(null), 500)
          }
          prevPriceRef.current = data.price

          // Update quote with new price
          setQuote(prev => prev ? {
            ...prev,
            price: data.price,
            change: data.change,
            changePercent: data.changePercent,
            dayHigh: data.dayHigh,
            dayLow: data.dayLow
          } : prev)

          setLastQuoteRefresh(new Date())
        }
      }
    } catch (e) {
      console.error('Quote refresh failed:', e)
    } finally {
      setRefreshing(false)
    }
  }

  // Auto-refresh effect (scan results)
  React.useEffect(() => {
    if (!autoRefresh || !scanResults) return
    const interval = setInterval(() => {
      handleScan()
    }, 30000) // 30 seconds
    return () => clearInterval(interval)
  }, [autoRefresh, scanResults])

  // Apply filters to scan results
  const applyFilters = (options) => {
    if (!options) return []
    return options.filter(opt => {
      if (filters.maxPrice > 0 && opt.lastPrice > filters.maxPrice) return false
      if (filters.maxSpread > 0 && opt.spread > filters.maxSpread) return false
      if (filters.minVolume > 0 && opt.volume < filters.minVolume) return false
      if (filters.maxDTE > 0 && opt.daysToExpiry > filters.maxDTE) return false
      return true
    })
  }

  // Filter presets
  const applyPreset = (preset) => {
    switch (preset) {
      case 'cheap':
        setFilters(f => ({ ...f, maxPrice: 1.00 }))
        break
      case '0dte':
        setFilters(f => ({ ...f, maxDTE: 0 }))
        break
      case 'tight':
        setFilters(f => ({ ...f, maxSpread: 0.05 }))
        break
      case 'reset':
        setFilters({ maxPrice: 10, maxSpread: 0.50, minVolume: 0, maxDTE: 7, showFilters: true })
        break
    }
  }

  // Market Scanner - scan all top stocks
  const handleScan = async () => {
    setScanning(true)
    setError('')
    setScanResults(null)
    setTopVolume(null)
    setQuote(null)
    setOptions(null)
    setSearchTicker('')

    try {
      const res = await fetch(`${API_BASE}/api/scan`)
      if (res.ok) {
        const data = await res.json()
        setScanResults(data)
        setLastRefresh(new Date())
        updateURL('scan')
        if (data.errors && data.errors.length > 0) {
          setError(`Some stocks failed: ${data.errors.join(', ')}`)
        }
      } else {
        throw new Error('Failed to scan market')
      }
    } catch (err) {
      setError(err.message || 'Error scanning market')
    } finally {
      setScanning(false)
    }
  }

  const fetchData = async (symbol, expiry = null) => {
    if (!symbol) return

    setLoading(true)
    setError('')
    setScanResults(null)

    try {
      const topVolumeRes = await fetch(`${API_BASE}/api/top-volume/${symbol}`)
      if (topVolumeRes.ok) {
        const topVolumeData = await topVolumeRes.json()
        setTopVolume(topVolumeData)

        if (topVolumeData.error) {
          setError(topVolumeData.error)
        }

        if (topVolumeData.symbol && !topVolumeData.error) {
          try {
            const quoteRes = await fetch(`${API_BASE}/api/quote/${symbol}`)
            if (quoteRes.ok) {
              const quoteData = await quoteRes.json()
              setQuote(quoteData)
            }
          } catch (e) {
            setQuote({ symbol: symbol.toUpperCase(), price: 0, name: symbol.toUpperCase() })
          }
        }
      } else {
        throw new Error('Failed to fetch options data')
      }

      const optionsUrl = expiry
        ? `${API_BASE}/api/options/${symbol}?expiry=${expiry}`
        : `${API_BASE}/api/options/${symbol}`
      try {
        const optionsRes = await fetch(optionsUrl)
        if (optionsRes.ok) {
          const optionsData = await optionsRes.json()
          setOptions(optionsData)
          if (!expiry && optionsData.selectedExpiry) {
            setSelectedExpiry(optionsData.selectedExpiry)
          }
        }
      } catch (e) { }
    } catch (err) {
      setError(err.message || 'Error fetching data')
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = (e, tickerOverride = null) => {
    if (e) e.preventDefault()
    const searchFor = tickerOverride || ticker.trim()
    if (searchFor) {
      const upperTicker = searchFor.toUpperCase()
      setSearchTicker(upperTicker)
      setSelectedExpiry('')
      setTopVolume(null)
      setOptions(null)
      setQuote(null)
      fetchData(searchFor)
      updateURL('stock', upperTicker)
    }
  }

  const handleExpiryChange = (e) => {
    const newExpiry = e.target.value
    setSelectedExpiry(newExpiry)
    fetchData(searchTicker, newExpiry)
  }

  // Handle clicking an option to open profit estimator
  const handleOptionClick = async (opt, tickerSymbol, expiry, daysToExpiry, optType) => {
    // Try to get current stock price
    let stockPrice = quote?.price

    if (!stockPrice || (tickerSymbol && tickerSymbol !== searchTicker)) {
      // Fetch the price for this ticker
      try {
        const res = await fetch(`${API_BASE}/api/quote/${tickerSymbol}`)
        if (res.ok) {
          const data = await res.json()
          stockPrice = data.price
        }
      } catch (e) {
        // Estimate from strike - assume near ATM if we can't fetch
        stockPrice = opt.strike
      }
    }

    // Fallback to strike if still no price
    if (!stockPrice) stockPrice = opt.strike

    setSelectedOption({
      ...opt,
      ticker: tickerSymbol,
      expiry: expiry,
      daysToExpiry: daysToExpiry,
      type: optType,
      currentPrice: stockPrice
    })

    // Update URL for persistence
    if (opt.contractSymbol) {
      updateURL('option', tickerSymbol, opt.contractSymbol)
    }
  }

  const formatNumber = (num) => {
    if (!num) return '-'
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B'
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M'
    if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K'
    return num.toLocaleString()
  }

  const formatPrice = (price) => {
    if (!price && price !== 0) return '-'
    return '$' + price.toFixed(2)
  }

  const currentOptions = options?.[activeTab] || []
  const currentTopOptions = topVolume?.[topVolumeTab] || []
  const currentScanOptions = applyFilters(scanResults?.[scanTab] || [])

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="logo">
          <span>options</span>
        </div>

        <div className="header-actions">
          {/* Manual Refresh Button */}
          {searchTicker && !scanResults && (
            <div className="refresh-group">
              <button
                className="refresh-btn"
                onClick={refreshQuote}
                disabled={refreshing}
                title="Refresh price data"
              >
                {refreshing ? '↻' : '↻'} Refresh
              </button>
              {lastQuoteRefresh && (
                <span className="last-refresh">
                  {lastQuoteRefresh.toLocaleTimeString()}
                </span>
              )}
            </div>
          )}

          {/* AI Advisor Button */}
          {scanResults && (
            <button
              className="ai-btn"
              onClick={() => setShowAIAdvisor(true)}
            >
              ai.analyze
            </button>
          )}

          {/* Market Scanner Button */}
          <button
            className="scan-btn"
            onClick={handleScan}
            disabled={scanning}
          >
            {scanning ? 'scanning...' : 'scan market'}
          </button>

          <form className="search-container" onSubmit={handleSearch}>
            <input
              type="text"
              className="search-input"
              placeholder="Enter ticker..."
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
            />
            <button type="submit" className="search-btn" disabled={loading}>
              {loading ? 'Loading...' : 'Search'}
            </button>
          </form>
        </div>
      </header>

      {/* Error */}
      {error && <div className="error">{error}</div>}

      {/* Empty State */}
      {!quote && !topVolume && !scanResults && !loading && !scanning && (
        <div className="empty-state">
          <h2>options scanner</h2>
          <p>Click <strong>scan market</strong> to find high volume options across top stocks</p>
          <p className="or-text">or search for a specific ticker</p>
        </div>
      )}

      {/* MARKET SCANNER RESULTS */}
      {scanResults && (
        <div className="options-section scanner-section">
          <div className="options-header">
            <div className="section-title">
              <h2>market scan</h2>
              <span className="scan-info">
                Scanned {scanResults.scannedStocks?.length || 0}/{scanResults.totalStocks} stocks
                {lastRefresh && <> · {lastRefresh.toLocaleTimeString()}</>}
              </span>
              <button
                className={`filter-toggle ${filters.showFilters ? 'active' : ''}`}
                onClick={() => setFilters(f => ({ ...f, showFilters: !f.showFilters }))}
              >
                ⚙ Filters
              </button>
            </div>
            <div className="tabs">
              <button
                className={`tab calls ${scanTab === 'topCalls' ? 'active' : ''}`}
                onClick={() => setScanTab('topCalls')}
              >
                Top Calls ({currentScanOptions.length}/{scanResults.topCalls?.length || 0})
              </button>
              <button
                className={`tab puts ${scanTab === 'topPuts' ? 'active' : ''}`}
                onClick={() => setScanTab('topPuts')}
              >
                Top Puts ({applyFilters(scanResults.topPuts || []).length}/{scanResults.topPuts?.length || 0})
              </button>
            </div>
          </div>

          {/* Filter Panel */}
          {filters.showFilters && (
            <div className="filter-panel">
              <div className="filter-row">
                <div className="filter-group">
                  <label>Max Price</label>
                  <input
                    type="number"
                    step="0.10"
                    value={filters.maxPrice}
                    onChange={(e) => setFilters(f => ({ ...f, maxPrice: parseFloat(e.target.value) || 0 }))}
                  />
                </div>
                <div className="filter-group">
                  <label>Max Spread</label>
                  <input
                    type="number"
                    step="0.01"
                    value={filters.maxSpread}
                    onChange={(e) => setFilters(f => ({ ...f, maxSpread: parseFloat(e.target.value) || 0 }))}
                  />
                </div>
                <div className="filter-group">
                  <label>Min Volume</label>
                  <input
                    type="number"
                    step="100"
                    value={filters.minVolume}
                    onChange={(e) => setFilters(f => ({ ...f, minVolume: parseInt(e.target.value) || 0 }))}
                  />
                </div>
                <div className="filter-group">
                  <label>Max DTE</label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={filters.maxDTE}
                    onChange={(e) => setFilters(f => ({ ...f, maxDTE: parseInt(e.target.value) || 0 }))}
                  />
                </div>
                <div className="filter-group auto-refresh">
                  <label>Auto-Refresh</label>
                  <button
                    className={`toggle-btn ${autoRefresh ? 'on' : ''}`}
                    onClick={() => setAutoRefresh(!autoRefresh)}
                  >
                    {autoRefresh ? 'ON' : 'OFF'}
                  </button>
                </div>
              </div>
              <div className="filter-presets">
                <span className="presets-label">Quick:</span>
                <button className="preset-btn" onClick={() => applyPreset('cheap')}>Under $1</button>
                <button className="preset-btn" onClick={() => applyPreset('0dte')}>0DTE</button>
                <button className="preset-btn" onClick={() => applyPreset('tight')}>Tight Spreads</button>
                <button className="preset-btn reset" onClick={() => applyPreset('reset')}>Reset</button>
              </div>
            </div>
          )}

          {scanning ? (
            <div className="loading">
              <div className="spinner"></div>
              Scanning {scanResults?.scannedStocks?.length || 0} stocks...
            </div>
          ) : (
            <div className="options-table-container">
              <table className="options-table scanner-table">
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th>Price</th>
                    <th>Strike</th>
                    <th>Last</th>
                    <th>Δ</th>
                    <th>γ</th>
                    <th>Score</th>
                    <th>Rev%</th>
                    <th>R:R</th>
                    <th>Spread</th>
                    <th>Vol</th>
                    <th>IV</th>
                  </tr>
                </thead>
                <tbody>
                  {currentScanOptions.map((opt, idx) => (
                    <tr key={idx} className={`${opt.inTheMoney ? 'itm' : ''} ${opt.scalpScore >= 40 ? 'hot-option' : ''}`} onClick={() => handleOptionClick(opt, opt.ticker, opt.expiry, opt.daysToExpiry, opt.type)}>
                      <td className="ticker-cell">
                        <span className="ticker-symbol">{opt.ticker}</span>
                        <span className="expiry-mini">{opt.daysToExpiry}d</span>
                      </td>
                      <td className="price-cell">${opt.stockPrice?.toFixed(2) || '-'}</td>
                      <td className="strike-cell">{formatPrice(opt.strike)}</td>
                      <td>{formatPrice(opt.lastPrice)}</td>
                      <td className={Math.abs(opt.delta) >= 0.4 && Math.abs(opt.delta) <= 0.6 ? 'delta-atm' : ''}>
                        {opt.delta?.toFixed(2) || '-'}
                      </td>
                      <td className={opt.gamma >= 0.05 ? 'gamma-high' : ''}>
                        {opt.gamma?.toFixed(3) || '-'}
                      </td>
                      <td className={`score-cell ${opt.scalpScore >= 40 ? 'score-hot' : opt.scalpScore >= 25 ? 'score-good' : ''}`}>
                        {opt.scalpScore?.toFixed(0) || '-'}
                      </td>
                      <td className={opt.reversalPct >= 20 ? 'reversal-hot' : opt.reversalPct >= 10 ? 'reversal-good' : ''}>
                        {opt.reversalPct > 0 ? `+${opt.reversalPct}%` : '-'}
                      </td>
                      <td className={opt.riskRatio >= 2 ? 'rr-good' : opt.riskRatio >= 1 ? 'rr-ok' : 'rr-bad'}>
                        {opt.riskRatio > 0 ? `${opt.riskRatio}:1` : '-'}
                      </td>
                      <td className={opt.spread > 0.10 ? 'spread-wide' : 'spread-tight'}>
                        {formatPrice(opt.spread)}
                      </td>
                      <td className="volume-cell">{formatNumber(opt.volume)}</td>
                      <td className={opt.impliedVolatility > 50 ? 'iv-high' : ''}>
                        {opt.impliedVolatility}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Quote Card */}
      {quote && (
        <div className="quote-card">
          <div className="quote-header">
            <div>
              <div className="quote-symbol">
                {quote.symbol}
              </div>
              <div className="quote-name">{quote.name}</div>
            </div>
            <div className="quote-price-container">
              <div className={`quote-price ${priceFlash ? `flash-${priceFlash}` : ''}`}>
                {formatPrice(quote.price)}
              </div>
              {quote.change !== undefined && (
                <div className={`quote-change ${quote.change >= 0 ? 'positive' : 'negative'}`}>
                  {quote.change >= 0 ? '▲' : '▼'} {formatPrice(Math.abs(quote.change))} ({quote.changePercent >= 0 ? '+' : ''}{quote.changePercent}%)
                </div>
              )}
            </div>
          </div>
          {quote.volume > 0 && (
            <div className="quote-stats">
              <div className="stat-item">
                <span className="stat-label">Previous Close</span>
                <span className="stat-value">{formatPrice(quote.previousClose)}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Volume</span>
                <span className="stat-value">{formatNumber(quote.volume)}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Market Cap</span>
                <span className="stat-value">{formatNumber(quote.marketCap)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stock Chart */}
      {quote && searchTicker && (
        <StockChart ticker={searchTicker} />
      )}

      {/* TOP VOLUME OPTIONS */}
      {topVolume && topVolume.topCalls?.length > 0 && (
        <div className="options-section top-volume-section">
          <div className="options-header">
            <div className="section-title">
              <h2>top volume</h2>
              <span className="expiry-badge">
                Expires: {topVolume.expiry} ({topVolume.daysToExpiry} day{topVolume.daysToExpiry !== 1 ? 's' : ''})
              </span>
            </div>
            <div className="tabs">
              <button
                className={`tab calls ${topVolumeTab === 'topCalls' ? 'active' : ''}`}
                onClick={() => setTopVolumeTab('topCalls')}
              >
                Calls ({topVolume.topCalls?.length || 0})
              </button>
              <button
                className={`tab puts ${topVolumeTab === 'topPuts' ? 'active' : ''}`}
                onClick={() => setTopVolumeTab('topPuts')}
              >
                Puts ({topVolume.topPuts?.length || 0})
              </button>
            </div>
          </div>

          <div className="options-table-container">
            <table className="options-table">
              <thead>
                <tr>
                  <th>Strike</th>
                  <th>Last</th>
                  <th>Bid</th>
                  <th>Ask</th>
                  <th>Rev%</th>
                  <th>R:R</th>
                  <th>Spread</th>
                  <th>Volume</th>
                  <th>Open Int</th>
                  <th>IV</th>
                </tr>
              </thead>
              <tbody>
                {currentTopOptions.map((opt, idx) => (
                  <tr key={idx} className={opt.inTheMoney ? 'itm' : ''} onClick={() => handleOptionClick(opt, topVolume.symbol, topVolume.expiry, topVolume.daysToExpiry, topVolumeTab === 'topCalls' ? 'CALL' : 'PUT')}>
                    <td className="strike-cell">{formatPrice(opt.strike)}</td>
                    <td>{formatPrice(opt.lastPrice)}</td>
                    <td>{formatPrice(opt.bid)}</td>
                    <td>{formatPrice(opt.ask)}</td>
                    <td className={opt.reversalPct >= 20 ? 'reversal-hot' : opt.reversalPct >= 10 ? 'reversal-good' : ''}>
                      {opt.reversalPct > 0 ? `+${opt.reversalPct}%` : '-'}
                    </td>
                    <td className={opt.riskRatio >= 2 ? 'rr-good' : opt.riskRatio >= 1 ? 'rr-ok' : 'rr-bad'}>
                      {opt.riskRatio > 0 ? `${opt.riskRatio}:1` : '-'}
                    </td>
                    <td className={opt.spread > 0.10 ? 'spread-wide' : 'spread-tight'}>
                      {formatPrice(opt.spread)}
                    </td>
                    <td className="volume-cell">{formatNumber(opt.volume)}</td>
                    <td>{formatNumber(opt.openInterest)}</td>
                    <td className={opt.impliedVolatility > 50 ? 'iv-high' : ''}>
                      {opt.impliedVolatility}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Full Options Chain */}
      {options && (
        <div className="options-section">
          <div className="options-header">
            <div className="tabs">
              <button
                className={`tab calls ${activeTab === 'calls' ? 'active' : ''}`}
                onClick={() => setActiveTab('calls')}
              >
                All Calls ({options.calls?.length || 0})
              </button>
              <button
                className={`tab puts ${activeTab === 'puts' ? 'active' : ''}`}
                onClick={() => setActiveTab('puts')}
              >
                All Puts ({options.puts?.length || 0})
              </button>
              {/* AI Scope Toggles */}
              <div className="scope-toggles" style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
                <label className={`scope-btn ${aiScope === 'calls' ? 'active' : ''}`}>
                  <input
                    type="radio"
                    name="scope"
                    checked={aiScope === 'calls'}
                    onChange={() => setAiScope('calls')}
                    hidden
                  />
                  CALLS
                </label>
                <label className={`scope-btn ${aiScope === 'puts' ? 'active' : ''}`}>
                  <input
                    type="radio"
                    name="scope"
                    checked={aiScope === 'puts'}
                    onChange={() => setAiScope('puts')}
                    hidden
                  />
                  PUTS
                </label>
                <label className={`scope-btn ${aiScope === 'both' ? 'active' : ''}`}>
                  <input
                    type="radio"
                    name="scope"
                    checked={aiScope === 'both'}
                    onChange={() => setAiScope('both')}
                    hidden
                  />
                  BOTH
                </label>

                <button
                  className="ai-btn"
                  onClick={() => {
                    const daysToExpiry = Math.ceil((new Date(selectedExpiry) - new Date()) / (1000 * 60 * 60 * 24))

                    const callsData = (options.calls || []).slice(0, 30).map(c => ({
                      ...c,
                      ticker: searchTicker,
                      expiry: selectedExpiry,
                      daysToExpiry,
                      type: 'CALL',
                      stockPrice: quote?.price,
                    }))

                    const putsData = (options.puts || []).slice(0, 30).map(p => ({
                      ...p,
                      ticker: searchTicker,
                      expiry: selectedExpiry,
                      daysToExpiry,
                      type: 'PUT',
                      stockPrice: quote?.price,
                    }))

                    setScanResults({
                      // If scope is 'calls', send calls. If 'puts', empty list. If 'both', send calls.
                      topCalls: (aiScope === 'calls' || aiScope === 'both') ? callsData : [],
                      // If scope is 'puts', send puts. If 'calls', empty list. If 'both', send puts.
                      topPuts: (aiScope === 'puts' || aiScope === 'both') ? putsData : [],
                    })
                    setShowAIAdvisor(true)
                  }}
                >
                  ai.analyze_scope
                </button>
              </div>
            </div>

            <select
              className="expiry-select"
              value={selectedExpiry}
              onChange={handleExpiryChange}
            >
              {options.expirations?.map(exp => (
                <option key={exp} value={exp}>{exp}</option>
              ))}
            </select>
          </div>

          <div className="options-table-container">
            <table className="options-table">
              <thead>
                <tr>
                  <th>Strike</th>
                  <th>Last</th>
                  <th>Bid</th>
                  <th>Ask</th>
                  <th>Rev%</th>
                  <th>R:R</th>
                  <th>Change</th>
                  <th>Volume</th>
                  <th>Open Int</th>
                  <th>IV</th>
                </tr>
              </thead>
              <tbody>
                {currentOptions.map((opt, idx) => (
                  <tr key={idx}
                    className={`${opt.inTheMoney ? 'itm' : 'otm'}`}
                    onClick={() => handleOptionClick(opt, searchTicker, selectedExpiry, Math.ceil((new Date(selectedExpiry) - new Date()) / (1000 * 60 * 60 * 24)), activeTab === 'calls' ? 'CALL' : 'PUT')}>
                    <td className="strike-cell">{formatPrice(opt.strike)}</td>
                    <td>{formatPrice(opt.lastPrice)}</td>
                    <td>{formatPrice(opt.bid)}</td>
                    <td>{formatPrice(opt.ask)}</td>
                    <td className={opt.reversalPct >= 20 ? 'reversal-hot' : opt.reversalPct >= 10 ? 'reversal-good' : ''}>
                      {opt.reversalPct > 0 ? `+${opt.reversalPct}%` : '-'}
                    </td>
                    <td className={opt.riskRatio >= 2 ? 'rr-good' : opt.riskRatio >= 1 ? 'rr-ok' : 'rr-bad'}>
                      {opt.riskRatio > 0 ? `${opt.riskRatio}:1` : '-'}
                    </td>
                    <td className={opt.change >= 0 ? 'price-positive' : 'price-negative'}>
                      {opt.change >= 0 ? '+' : ''}{opt.change?.toFixed(2) || '-'}
                    </td>
                    <td>{formatNumber(opt.volume)}</td>
                    <td>{formatNumber(opt.openInterest)}</td>
                    <td className={opt.impliedVolatility > 50 ? 'iv-high' : ''}>
                      {opt.impliedVolatility}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {/* Profit Estimator Modal */}
      {selectedOption && (
        <ProfitEstimator
          option={selectedOption}
          currentPrice={quote?.price || selectedOption.currentPrice || selectedOption.strike}
          onClose={() => {
            setSelectedOption(null)
            // Restore previous URL
            if (searchTicker) {
              updateURL('stock', searchTicker)
            } else if (scanResults) {
              updateURL('scan')
            } else {
              updateURL('home')
            }
          }}
          onNavigate={(ticker) => {
            setTicker(ticker)
            handleSearch(null, ticker)
          }}
        />
      )}

      {/* AI Advisor Modal */}
      {showAIAdvisor && scanResults && (
        <AIAdvisor
          scanResults={scanResults}
          onClose={() => setShowAIAdvisor(false)}
          onSelectOption={(opt) => {
            setSelectedOption({
              ...opt,
              currentPrice: opt.stockPrice || opt.strike,
            })
          }}
        />
      )}
    </div>
  )
}

export default App
