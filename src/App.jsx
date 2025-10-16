import React, { useState } from "react";
import axios from "axios";

export default function App() {
  const [instrument, setInstrument] = useState("BTC");
  const [iv, setIv] = useState(30);
  const [startDate, setStartDate] = useState("2024-10-01");
  const [endDate, setEndDate] = useState("2024-10-01");
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");

  const API_BASE = "https://btcmovements-backend.onrender.com/api";

  const fetchAndCompute = async () => {
    setLoading(true);
    setError("");
    setSummary(null);

    try {
      // Updated URL parameters for the robust Binance backend
      const url = `${API_BASE}/candles?instrument_name=${encodeURIComponent(instrument)}&start_date=${startDate}&end_date=${endDate}&resolution=1m&market=spot`;
      
      console.log('Fetching data from:', url);
      
      const res = await axios.get(url, { timeout: 60000 });
      
      if (!res.data || !Array.isArray(res.data)) {
        throw new Error("Invalid response from backend");
      }
      
      const candles = res.data;
      if (candles.length === 0) {
        setError("No data returned for selected date range.");
        setLoading(false);
        return;
      }

      console.log('Processing', candles.length, 'candles');
      
      // Format data for movement calculations
      const formattedCandles = {
        t: candles.map(c => c.timestamp),
        o: candles.map(c => c.open),
        h: candles.map(c => c.high),
        l: candles.map(c => c.low),
        c: candles.map(c => c.close)
      };
      
      const movements = computeMovementsFromCandles_ExcelStyle(formattedCandles, iv);
      const s = { 
        instrument, 
        iv, 
        startDate, 
        endDate, 
        candles: formattedCandles, 
        movements,
        rawCandles: candles // Keep original candles for reference
      };
      setSummary(s);
      
    } catch (err) {
      console.error("Fetch error:", err);
      const msg = err?.response?.data?.error || 
                  err?.response?.data?.details || 
                  err?.message || 
                  String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  function computeMovementsFromCandles_ExcelStyle(candleData, ivPercent) {
    if (!candleData || !candleData.t || candleData.t.length === 0) return null;

    const times = candleData.t.map(Number);
    const opens = candleData.o.map(Number);
    const highs = candleData.h.map(Number);
    const lows = candleData.l.map(Number);
    const closes = candleData.c.map(Number);

    const n = times.length;
    if (n === 0) return null;

    const opening = closes[0];
    const FM_thresh = (Number(ivPercent) / 1900) * opening;
    const LM_thresh = FM_thresh * 0.7;
    const SM_thresh = FM_thresh * 0.25;

    let currentFM = opening;
    let currentLM = opening;
    let currentSM = opening;

    let hitsFM = 0, hitsLM = 0, hitsSM = 0;
    const events = [];

    for (let i = 0; i < n; i++) {
      const h = highs[i];
      const l = lows[i];

      // FM Calculation
      let newFM = currentFM;
      if (h - currentFM >= FM_thresh) {
        newFM = h;
        hitsFM++;
        events.push({
          idx: i,
          timestamp: times[i],
          timestamp_iso: new Date(times[i]).toISOString(),
          type: "FM",
          priceObserved: h,
          thresholdLevel: FM_thresh,
          prevNeutral: currentFM,
          newNeutral: newFM,
          diffFromPrev: h - currentFM
        });
      } else if (l - currentFM <= -FM_thresh) {
        newFM = l;
        hitsFM++;
        events.push({
          idx: i,
          timestamp: times[i],
          timestamp_iso: new Date(times[i]).toISOString(),
          type: "FM",
          priceObserved: l,
          thresholdLevel: FM_thresh,
          prevNeutral: currentFM,
          newNeutral: newFM,
          diffFromPrev: l - currentFM
        });
      }
      currentFM = newFM;

      // LM Calculation
      let newLM = currentLM;
      if (h - currentLM >= LM_thresh) {
        newLM = h;
        hitsLM++;
        events.push({
          idx: i,
          timestamp: times[i],
          timestamp_iso: new Date(times[i]).toISOString(),
          type: "LM",
          priceObserved: h,
          thresholdLevel: LM_thresh,
          prevNeutral: currentLM,
          newNeutral: newLM,
          diffFromPrev: h - currentLM
        });
      } else if (l - currentLM <= -LM_thresh) {
        newLM = l;
        hitsLM++;
        events.push({
          idx: i,
          timestamp: times[i],
          timestamp_iso: new Date(times[i]).toISOString(),
          type: "LM",
          priceObserved: l,
          thresholdLevel: LM_thresh,
          prevNeutral: currentLM,
          newNeutral: newLM,
          diffFromPrev: l - currentLM
        });
      }
      currentLM = newLM;

      // SM Calculation
      let newSM = currentSM;
      if (h - currentSM >= SM_thresh) {
        newSM = h;
        hitsSM++;
        events.push({
          idx: i,
          timestamp: times[i],
          timestamp_iso: new Date(times[i]).toISOString(),
          type: "SM",
          priceObserved: h,
          thresholdLevel: SM_thresh,
          prevNeutral: currentSM,
          newNeutral: newSM,
          diffFromPrev: h - currentSM
        });
      } else if (l - currentSM <= -SM_thresh) {
        newSM = l;
        hitsSM++;
        events.push({
          idx: i,
          timestamp: times[i],
          timestamp_iso: new Date(times[i]).toISOString(),
          type: "SM",
          priceObserved: l,
          thresholdLevel: SM_thresh,
          prevNeutral: currentSM,
          newNeutral: newSM,
          diffFromPrev: l - currentSM
        });
      }
      currentSM = newSM;
    }

    return {
      openingPrice: opening,
      ivPercent: Number(ivPercent),
      thresholds: { FM: FM_thresh, LM: LM_thresh, SM: SM_thresh },
      totals: { FM: hitsFM, LM: hitsLM, SM: hitsSM },
      events: events.sort((a, b) => a.timestamp - b.timestamp)
    };
  }

  return (
    <div style={{ fontFamily: "Inter, sans-serif", padding: 24 }}>
      <h1>Spot Dashboard — Excel-method (exact)</h1>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <select value={instrument} onChange={(e) => setInstrument(e.target.value)} style={{ padding: 6 }}>
          <option value="BTC">BTC/USDT Spot</option>
          <option value="ETH">ETH/USDT Spot</option>
          <option value="BTCUSDT">BTCUSDT (Direct)</option>
          <option value="ETHUSDT">ETHUSDT (Direct)</option>
        </select>

        <input 
          type="number" 
          value={iv} 
          onChange={(e) => setIv(e.target.value)} 
          placeholder="IV %" 
          style={{ width: 90, padding: 6 }} 
        />

        <input 
          type="date" 
          value={startDate} 
          onChange={(e) => setStartDate(e.target.value)} 
          style={{ padding: 6 }} 
        />
        <input 
          type="date" 
          value={endDate} 
          onChange={(e) => setEndDate(e.target.value)} 
          style={{ padding: 6 }} 
        />

        <button 
          onClick={fetchAndCompute} 
          disabled={loading} 
          style={{ padding: "6px 12px", background: loading ? "#ccc" : "#007acc", color: "white", border: "none", borderRadius: 4 }}
        >
          {loading ? "Loading..." : "Fetch & Calculate"}
        </button>
      </div>

      {error && (
        <div style={{ background: "#fdecea", color: "#7a1f1f", padding: 10, borderRadius: 6, marginBottom: 12 }}>
          <b>Error:</b> {String(error)}
        </div>
      )}

      {summary && summary.movements && (
        <div style={{ background: "#fafafa", padding: 14, borderRadius: 8 }}>
          <div style={{ marginBottom: 8 }}>
            <strong>Opening Price:</strong> {Number(summary.movements.openingPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </div>

          <div style={{ display: "flex", gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
            <div><b>FM</b>: th={Number(summary.movements.thresholds.FM).toLocaleString(undefined, { maximumFractionDigits: 2 })} | Hits: {summary.movements.totals.FM}</div>
            <div><b>LM</b>: th={Number(summary.movements.thresholds.LM).toLocaleString(undefined, { maximumFractionDigits: 2 })} | Hits: {summary.movements.totals.LM}</div>
            <div><b>SM</b>: th={Number(summary.movements.thresholds.SM).toLocaleString(undefined, { maximumFractionDigits: 2 })} | Hits: {summary.movements.totals.SM}</div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <strong>Data Info:</strong> {summary.rawCandles?.length || summary.candles.t.length} candles | 
            Date: {summary.startDate} to {summary.endDate} | 
            Instrument: {summary.instrument}
          </div>

          <h3>Movement Events (first 100)</h3>
          <div style={{ maxHeight: 400, overflowY: "auto", background: "#fff", padding: 10, borderRadius: 6 }}>
            {summary.movements.events.length === 0 && <div>No events found.</div>}
            {summary.movements.events.slice(0, 100).map((e, i) => (
              <div key={i} style={{ padding: 8, borderBottom: "1px solid #eee", fontSize: '12px' }}>
                [{e.timestamp_iso.split('T')[1].split('.')[0]}] <b>{e.type}</b> | 
                Price: {Number(e.priceObserved).toLocaleString(undefined, { maximumFractionDigits: 2 })} | 
                Th: {Number(e.thresholdLevel).toLocaleString(undefined, { maximumFractionDigits: 2 })} | 
                Prev: {Number(e.prevNeutral).toLocaleString(undefined, { maximumFractionDigits: 2 })} → 
                New: {Number(e.newNeutral).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </div>
            ))}
          </div>
        </div>
      )}

      {!summary && !error && (
        <div style={{ marginTop: 18, color: "#666", background: "#f5f5f5", padding: 12, borderRadius: 6 }}>
          <div><b>Instructions:</b></div>
          <div>• Select instrument (BTC/ETH)</div>
          <div>• Set IV percentage (default: 30)</div>
          <div>• Choose date range (YYYY-MM-DD format)</div>
          <div>• Click "Fetch & Calculate"</div>
          <div style={{ marginTop: 8, fontSize: 11, color: "#999" }}>
            Using robust Binance API with Dubai timezone handling
          </div>
        </div>
      )}

      <div style={{ marginTop: 16, fontSize: 12, color: "#999" }}>
        <div>Backend: <code>https://btcmovements-backend.onrender.com</code></div>
        <div>Data: Binance Spot API (1-minute intervals) | Dubai timezone (UTC+4)</div>
        <div>Instruments: BTC/USDT, ETH/USDT Spot</div>
      </div>
    </div>
  );
}
