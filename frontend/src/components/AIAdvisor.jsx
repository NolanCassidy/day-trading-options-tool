import { useState } from 'react'

const API_BASE = 'http://localhost:8000'

function AIAdvisor({ scanResults, onClose, onSelectOption }) {
    const [recommendation, setRecommendation] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')

    const handleAnalyze = async () => {
        if (!scanResults) return

        setLoading(true)
        setError('')

        try {
            const res = await fetch(`${API_BASE}/api/ai-recommend`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    topCalls: scanResults.topCalls || [],
                    topPuts: scanResults.topPuts || [],
                }),
            })

            if (res.ok) {
                const data = await res.json()
                if (data.error) {
                    setError(data.error)
                } else {
                    setRecommendation(data)
                }
            } else {
                throw new Error('Failed to get recommendation')
            }
        } catch (e) {
            setError(e.message || 'Error analyzing options')
        } finally {
            setLoading(false)
        }
    }

    const handleOptionClick = (opt) => {
        if (onSelectOption) {
            onSelectOption({
                strike: opt.strike,
                lastPrice: opt.price,
                bid: opt.price * 0.98,
                ask: opt.price * 1.02,
                type: opt.type,
                ticker: opt.ticker,
                expiry: opt.expiry,
                daysToExpiry: opt.daysToExpiry || 1,
            })
            onClose()
        }
    }

    const rec = recommendation?.recommendation
    const runnerUps = recommendation?.runnerUps || []

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="ai-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <div className="modal-title">
                        <h2>AI Trade Advisor</h2>
                        {recommendation && (
                            <span className={`ai-badge ${recommendation.aiPowered ? 'ai-powered' : ''}`}>
                                {recommendation.aiPowered ? 'AI Powered' : 'Algorithm-Based'}
                            </span>
                        )}
                    </div>
                    <button className="close-btn" onClick={onClose}>×</button>
                </div>

                {!recommendation && !loading && (
                    <div className="ai-intro">
                        <p>Analyze current scan results to find the best trade opportunity.</p>
                        <p className="ai-note">
                            The AI will evaluate options based on scalp score, reversal potential, Greeks, RSI, and price action.
                        </p>
                        <button className="analyze-btn" onClick={handleAnalyze}>
                            analyze {(scanResults?.topCalls?.length || 0) + (scanResults?.topPuts?.length || 0)} options
                        </button>
                    </div>
                )}

                {loading && (
                    <div className="ai-loading">
                        <div className="spinner"></div>
                        <p>Analyzing options with AI...</p>
                    </div>
                )}

                {error && (
                    <div className="ai-error">
                        <p>⚠ {error}</p>
                        <button className="retry-btn" onClick={handleAnalyze}>Try Again</button>
                    </div>
                )}

                {rec && (
                    <div className="ai-recommendation">
                        <div className="rec-main" onClick={() => handleOptionClick(rec)}>
                            <div className="rec-header">
                                <span className={`rec-type ${rec.type?.toLowerCase()}`}>
                                    {rec.type}
                                </span>
                                <h3>{rec.ticker} ${rec.strike}</h3>
                                <span className="rec-expiry">{rec.expiry}</span>
                            </div>

                            <div className="rec-stats">
                                <div className="rec-stat">
                                    <span className="rec-label">Price</span>
                                    <span className="rec-value">${rec.price?.toFixed(2)}</span>
                                </div>
                                <div className="rec-stat">
                                    <span className="rec-label">Score</span>
                                    <span className="rec-value score">{rec.scalpScore}</span>
                                </div>
                                <div className="rec-stat">
                                    <span className="rec-label">Rev %</span>
                                    <span className="rec-value green">+{rec.reversalPct}%</span>
                                </div>
                                <div className="rec-stat">
                                    <span className="rec-label">Delta</span>
                                    <span className="rec-value">{rec.delta}</span>
                                </div>
                            </div>
                            <div className="click-hint">👆 Click to open Profit Estimator</div>
                        </div>

                        {recommendation.plan && (
                            <div className="rec-plan">
                                <h4>Trading Plan</h4>
                                <div className="plan-details">
                                    {recommendation.plan.split('|').map((part, i) => (
                                        <span key={i} className="plan-part">{part.trim()}</span>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="rec-reasoning">
                            <h4>Analysis</h4>
                            <p>{recommendation.reasoning}</p>
                        </div>

                        <div className="rec-confidence">
                            <span className={`confidence-badge ${recommendation.confidence}`}>
                                Confidence: {recommendation.confidence?.toUpperCase()}
                            </span>
                        </div>

                        {runnerUps.length > 0 && (
                            <div className="runner-ups">
                                <h4>Alternatives</h4>
                                <div className="runner-ups-list">
                                    {runnerUps.map((run, i) => (
                                        <div key={i} className="runner-up-item" onClick={() => handleOptionClick(run)}>
                                            <div className="ru-header">
                                                <span className={`ru-type ${run.type?.toLowerCase()}`}>{run.type}</span>
                                                <span className="ru-strike">${run.strike}</span>
                                                <span className="ru-expiry">{run.expiry}</span>
                                            </div>
                                            {run.reason && <div className="ru-reason">{run.reason}</div>}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="rec-disclaimer">
                            ⚠ {recommendation.disclaimer}
                        </div>

                        <button className="analyze-btn" onClick={handleAnalyze} style={{ marginTop: 16 }}>
                            🔄 Re-Analyze
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}

export default AIAdvisor
