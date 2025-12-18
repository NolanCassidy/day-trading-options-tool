import React, { useState, useEffect } from 'react'
import { API_BASE } from '../config'

// Categories for ticker dropdown
const CATEGORIES = [
    'Index ETF', 'Leveraged ETF', 'Sector ETF', 'Commodity ETF', 'Bond ETF', 'Intl ETF',
    'Mega-Cap Tech', 'Cloud/SaaS', 'Cybersecurity', 'Semiconductors', 'AI/Data',
    'Financials', 'Fintech', 'Healthcare', 'Biotech', 'Pharma',
    'Consumer', 'Retail', 'E-commerce', 'Entertainment', 'Streaming', 'Social', 'Gaming',
    'Industrial', 'Logistics', 'Energy', 'Clean Energy', 'EV',
    'Crypto', 'Meme', 'Travel', 'Rideshare', 'Networking', 'Enterprise', 'Other'
]

function DbPage({ onNavigateToOption }) {
    const [activeTab, setActiveTab] = useState('tickers') // 'tickers' | 'options'

    // Ticker Watchlist State
    const [tickers, setTickers] = useState([])
    const [tickersLoading, setTickersLoading] = useState(true)
    const [newTickerSymbol, setNewTickerSymbol] = useState('')
    const [newTickerCategory, setNewTickerCategory] = useState('Other')
    const [newSupport, setNewSupport] = useState('')
    const [newResistance, setNewResistance] = useState('')
    const [tickerError, setTickerError] = useState('')
    const [tickerFilter, setTickerFilter] = useState('')

    // Option Watchlist State
    const [options, setOptions] = useState([])
    const [optionsLoading, setOptionsLoading] = useState(true)
    const [optionError, setOptionError] = useState('')

    // Fetch tickers on mount
    useEffect(() => {
        fetchTickers()
        fetchOptions()
    }, [])

    const fetchTickers = async () => {
        setTickersLoading(true)
        try {
            const res = await fetch(`${API_BASE}/api/watchlist/tickers`)
            if (res.ok) {
                const data = await res.json()
                setTickers(data.tickers || [])
            }
        } catch (e) {
            console.error('Failed to fetch tickers:', e)
        } finally {
            setTickersLoading(false)
        }
    }

    const fetchOptions = async () => {
        setOptionsLoading(true)
        try {
            const res = await fetch(`${API_BASE}/api/watchlist/options`)
            if (res.ok) {
                const data = await res.json()
                setOptions(data.options || [])
            }
        } catch (e) {
            console.error('Failed to fetch options:', e)
        } finally {
            setOptionsLoading(false)
        }
    }

    const handleAddTicker = async (e) => {
        e.preventDefault()
        if (!newTickerSymbol.trim()) return

        setTickerError('')
        try {
            const res = await fetch(`${API_BASE}/api/watchlist/tickers`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    symbol: newTickerSymbol.toUpperCase().trim(),
                    category: newTickerCategory
                })
            })

            if (res.ok) {
                // After adding, if levels were provided, update them
                if (newSupport || newResistance) {
                    await fetch(`${API_BASE}/api/watchlist/tickers/levels/${newTickerSymbol.toUpperCase().trim()}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            supportPrice: newSupport ? parseFloat(newSupport) : null,
                            resistancePrice: newResistance ? parseFloat(newResistance) : null
                        })
                    })
                }

                setNewTickerSymbol('')
                setNewSupport('')
                setNewResistance('')
                fetchTickers()
            } else {
                const data = await res.json()
                setTickerError(data.detail || 'Failed to add ticker')
            }
        } catch (e) {
            setTickerError('Network error')
        }
    }

    const handleUpdateLevels = async (symbol, support, resistance) => {
        try {
            const res = await fetch(`${API_BASE}/api/watchlist/tickers/levels/${symbol}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    supportPrice: support !== '' ? parseFloat(support) : null,
                    resistancePrice: resistance !== '' ? parseFloat(resistance) : null
                })
            })
            if (res.ok) {
                fetchTickers()
            }
        } catch (e) {
            console.error('Failed to update levels:', e)
        }
    }

    const handleRemoveTicker = async (symbol) => {
        try {
            const res = await fetch(`${API_BASE}/api/watchlist/tickers/${symbol}`, {
                method: 'DELETE'
            })
            if (res.ok) {
                fetchTickers()
            }
        } catch (e) {
            console.error('Failed to remove ticker:', e)
        }
    }

    const handleRemoveOption = async (contractSymbol) => {
        try {
            const res = await fetch(`${API_BASE}/api/watchlist/options/${encodeURIComponent(contractSymbol)}`, {
                method: 'DELETE'
            })
            if (res.ok) {
                fetchOptions()
            }
        } catch (e) {
            console.error('Failed to remove option:', e)
        }
    }

    // Filter tickers
    const filteredTickers = tickers.filter(t =>
        t.symbol.toLowerCase().includes(tickerFilter.toLowerCase()) ||
        t.category.toLowerCase().includes(tickerFilter.toLowerCase())
    )

    // Group tickers by category
    const tickersByCategory = filteredTickers.reduce((acc, t) => {
        if (!acc[t.category]) acc[t.category] = []
        acc[t.category].push(t)
        return acc
    }, {})

    return (
        <div className="db-page">
            <div className="db-header">
                <h2>Database</h2>
                <div className="db-tabs">
                    <button
                        className={`db-tab ${activeTab === 'tickers' ? 'active' : ''}`}
                        onClick={() => setActiveTab('tickers')}
                    >
                        Ticker Watchlist ({tickers.length})
                    </button>
                    <button
                        className={`db-tab ${activeTab === 'options' ? 'active' : ''}`}
                        onClick={() => setActiveTab('options')}
                    >
                        Option Watchlist ({options.length})
                    </button>
                </div>
            </div>

            {/* Ticker Watchlist Tab */}
            {activeTab === 'tickers' && (
                <div className="watchlist-content">
                    <div className="watchlist-controls">
                        <form className="add-ticker-form" onSubmit={handleAddTicker}>
                            <input
                                type="text"
                                placeholder="Add ticker..."
                                value={newTickerSymbol}
                                onChange={(e) => setNewTickerSymbol(e.target.value.toUpperCase())}
                                className="ticker-input"
                            />
                            <select
                                value={newTickerCategory}
                                onChange={(e) => setNewTickerCategory(e.target.value)}
                                className="category-select"
                            >
                                {CATEGORIES.map(cat => (
                                    <option key={cat} value={cat}>{cat}</option>
                                ))}
                            </select>
                            <input
                                type="number"
                                step="0.01"
                                placeholder="Support"
                                value={newSupport}
                                onChange={(e) => setNewSupport(e.target.value)}
                                className="level-input"
                            />
                            <input
                                type="number"
                                step="0.01"
                                placeholder="Resistance"
                                value={newResistance}
                                onChange={(e) => setNewResistance(e.target.value)}
                                className="level-input"
                            />
                            <button type="submit" className="add-btn">+ Add</button>
                        </form>
                        <input
                            type="text"
                            placeholder="Filter..."
                            value={tickerFilter}
                            onChange={(e) => setTickerFilter(e.target.value)}
                            className="filter-input"
                        />
                    </div>

                    {tickerError && <div className="error-msg">{tickerError}</div>}

                    {tickersLoading ? (
                        <div className="loading">Loading tickers...</div>
                    ) : (
                        <div className="ticker-grid">
                            {Object.entries(tickersByCategory).sort().map(([category, categoryTickers]) => (
                                <div key={category} className="ticker-category">
                                    <h4 className="category-header">{category} ({categoryTickers.length})</h4>
                                    <div className="ticker-chips">
                                        {categoryTickers.sort((a, b) => a.symbol.localeCompare(b.symbol)).map(t => (
                                            <div key={t.symbol} className="ticker-chip-expanded">
                                                <div className="chip-main">
                                                    <span
                                                        className="ticker-symbol clickable"
                                                        onClick={() => onNavigateToOption?.({ ticker: t.symbol, type: 'STOCK' })}
                                                    >
                                                        {t.symbol}
                                                    </span>
                                                    <button
                                                        className="remove-chip-btn"
                                                        onClick={() => handleRemoveTicker(t.symbol)}
                                                        title="Remove"
                                                    >
                                                        ×
                                                    </button>
                                                </div>
                                                <div className="chip-levels">
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        placeholder="S"
                                                        defaultValue={t.support_price || ''}
                                                        onBlur={(e) => handleUpdateLevels(t.symbol, e.target.value, t.resistance_price)}
                                                        className="mini-level-input"
                                                        title="Support Price"
                                                    />
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        placeholder="R"
                                                        defaultValue={t.resistance_price || ''}
                                                        onBlur={(e) => handleUpdateLevels(t.symbol, t.support_price, e.target.value)}
                                                        className="mini-level-input"
                                                        title="Resistance Price"
                                                    />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Option Watchlist Tab */}
            {activeTab === 'options' && (
                <div className="watchlist-content">
                    {optionError && <div className="error-msg">{optionError}</div>}

                    {optionsLoading ? (
                        <div className="loading">Loading options...</div>
                    ) : options.length === 0 ? (
                        <div className="empty-state">
                            <p>No options in watchlist</p>
                            <p className="hint">Click "Add to Watchlist" from any option page to add options here</p>
                        </div>
                    ) : (
                        <div className="options-table-container">
                            <table className="options-table watchlist-table">
                                <thead>
                                    <tr>
                                        <th>Ticker</th>
                                        <th>Type</th>
                                        <th>Strike</th>
                                        <th>Expiry</th>
                                        <th>Notes</th>
                                        <th>Added</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {options.map((opt) => (
                                        <tr
                                            key={opt.contract_symbol}
                                            className={`option-row ${opt.option_type.toLowerCase()}`}
                                            onClick={() => onNavigateToOption?.(opt)}
                                        >
                                            <td className="ticker-cell">{opt.ticker}</td>
                                            <td className={opt.option_type === 'CALL' ? 'call-type' : 'put-type'}>
                                                {opt.option_type}
                                            </td>
                                            <td>${opt.strike.toFixed(2)}</td>
                                            <td>{opt.expiry}</td>
                                            <td className="notes-cell">{opt.notes || '-'}</td>
                                            <td className="date-cell">
                                                {new Date(opt.added_at).toLocaleDateString()}
                                            </td>
                                            <td>
                                                <button
                                                    className="remove-btn"
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        handleRemoveOption(opt.contract_symbol)
                                                    }}
                                                >
                                                    ✕
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

export default DbPage
