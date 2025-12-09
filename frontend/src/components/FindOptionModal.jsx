import React, { useState, useEffect } from 'react';
import { API_BASE } from '../config';
import './FindOptionModal.css'; // We'll create this next

const FindOptionModal = ({ ticker, currentPrice, onClose, onSelectOption }) => {
    const [optionType, setOptionType] = useState('CALL');
    const [targetPrice, setTargetPrice] = useState('');
    const [stopLoss, setStopLoss] = useState('');
    const [targetDate, setTargetDate] = useState('');
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState(null);
    const [error, setError] = useState('');

    // Set default target date to tomorrow
    useEffect(() => {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        setTargetDate(tomorrow.toISOString().split('T')[0]);

        // Default targets based on current price (just suggestions)
        if (currentPrice) {
            setTargetPrice((currentPrice * 1.05).toFixed(2));
            setStopLoss((currentPrice * 0.98).toFixed(2));
        }
    }, [currentPrice]);

    const handleFind = async () => {
        if (!targetPrice || !stopLoss || !targetDate) {
            setError('Please fill in all fields');
            return;
        }

        setLoading(true);
        setError('');
        setResults(null);

        try {
            const res = await fetch(`${API_BASE}/api/find-options`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ticker,
                    optionType,
                    targetPrice: parseFloat(targetPrice),
                    stopLoss: parseFloat(stopLoss),
                    targetDate
                })
            });

            if (res.ok) {
                const data = await res.json();
                setResults(data.options);
                if (data.options.length === 0) {
                    setError('No matching options found. Try adjusting criteria.');
                }
            } else {
                const err = await res.json();
                setError(err.detail || 'Failed to find options');
            }
        } catch (e) {
            setError('Error connecting to server');
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content find-option-modal">
                <div className="modal-header">
                    <h3>Find Best Option for {ticker}</h3>
                    <button className="close-btn" onClick={onClose}>×</button>
                </div>

                <div className="modal-body">
                    <div className="input-grid">
                        <div className="form-group">
                            <label>I think {ticker} will go:</label>
                            <div className="toggle-group">
                                <button
                                    className={`toggle-btn ${optionType === 'CALL' ? 'active call' : ''}`}
                                    onClick={() => setOptionType('CALL')}
                                >
                                    UP (Call)
                                </button>
                                <button
                                    className={`toggle-btn ${optionType === 'PUT' ? 'active put' : ''}`}
                                    onClick={() => setOptionType('PUT')}
                                >
                                    DOWN (Put)
                                </button>
                            </div>
                        </div>

                        <div className="form-group">
                            <label>Target Price ($)</label>
                            <input
                                type="number"
                                step="0.01"
                                value={targetPrice}
                                onChange={e => setTargetPrice(e.target.value)}
                            />
                        </div>

                        <div className="form-group">
                            <label>Stop Loss ($)</label>
                            <input
                                type="number"
                                step="0.01"
                                value={stopLoss}
                                onChange={e => setStopLoss(e.target.value)}
                            />
                        </div>

                        <div className="form-group">
                            <label>By Date</label>
                            <input
                                type="date"
                                min={new Date().toISOString().split('T')[0]}
                                value={targetDate}
                                onChange={e => setTargetDate(e.target.value)}
                            />
                        </div>
                    </div>

                    <button className="find-submit-btn" onClick={handleFind} disabled={loading}>
                        {loading ? 'Analyzing Options...' : 'Find Best Options'}
                    </button>

                    {error && <div className="error-msg">{error}</div>}

                    {results && (
                        <div className="results-container">
                            <h4>Top Results (Sorted by Risk:Reward)</h4>
                            <table className="results-table">
                                <thead>
                                    <tr>
                                        <th>Expiry</th>
                                        <th>Strike</th>
                                        <th>Cost</th>
                                        <th>Reward</th>
                                        <th>Risk</th>
                                        <th>R:R</th>
                                        <th>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {results.map((opt, idx) => (
                                        <tr key={idx} className={idx === 0 ? 'top-pick' : ''}>
                                            <td>{opt.expiry} ({opt.daysToExpiry}d)</td>
                                            <td>${opt.strike}</td>
                                            <td>${opt.ask.toFixed(2)}</td>
                                            <td className="profit">+${opt.projectedReward.toFixed(2)}</td>
                                            <td className="loss">-${Math.abs(opt.projectedRisk).toFixed(2)}</td>
                                            <td className={`rr-cell ${opt.riskRewardRatio >= 3 ? 'excellent' : 'good'}`}>
                                                {opt.riskRewardRatio.toFixed(1)}:1
                                            </td>
                                            <td>
                                                <button className="select-btn" onClick={() => onSelectOption(opt)}>
                                                    Analyze
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default FindOptionModal;
