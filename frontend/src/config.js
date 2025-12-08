// API configuration
// In production (Docker), we use relative URLs and nginx proxies to backend
// In development, we use the full localhost URL
export const API_BASE = import.meta.env.VITE_API_URL || ''
