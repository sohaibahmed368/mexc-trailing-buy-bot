
# 🧪 Master Cumulative Scenario Testing Registry

**Execution Timestamp**: 2026-07-24T11:27:26.136Z  
**Total Scenarios Tested**: 6  
**Passed**: 6 / 6 (100% PERFECT)  

---

## 📋 Scenario Execution Details


### Scenario 1: Trailing Buy Activation & Consensus Indicator Alignment
- **Status**: ✅ PASSED
- **Details**: Dip activated at 99.40, rebound triggered at 99.85 with OBI 60% >= 55%. Order transitioned to TP_SL_ACTIVE.
- **Timestamp**: 2026-07-24T11:27:24.902Z


### Scenario 2: 100% Take Profit Target Hit & Auto-Loop Reset
- **Status**: ✅ PASSED
- **Details**: Price hit +1.0% TP target ($101.05). Executed Limit Sell, logged profit, and reset to PENDING_ACTIVATION.
- **Timestamp**: 2026-07-24T11:27:25.456Z


### Scenario 3: 50% TP Profit Lock Fallback (Strict Immediate Market Sell)
- **Status**: ✅ PASSED
- **Details**: Price reached >50% TP progress, locked profit at +0.5%. On reversal, Smart SL extension was SKIPPED and IMMEDIATE MARKET SELL executed.
- **Timestamp**: 2026-07-24T11:27:25.656Z


### Scenario 4: Pre-50% TP Drop with High Bids Support (Smart SL Buffer Extended)
- **Status**: ✅ PASSED
- **Details**: Price dropped before 50% TP progress. OBI Bids Support 60% >= 45% confirmed seller absorption. Extended SL by +0.2% buffer and deferred market sell.
- **Timestamp**: 2026-07-24T11:27:25.886Z


### Scenario 5: Pre-50% TP Drop with Heavy Selling Dumping (Instant SL Execution)
- **Status**: ✅ PASSED
- **Details**: Price dropped before 50% TP progress with Bids Support 20% < 45% (Heavy Asks Dumping 80%). Smart SL Extension refused, executed immediate Stop Loss Market Sell.
- **Timestamp**: 2026-07-24T11:27:26.058Z


### Scenario 6: Decoupled Alpaca Stock Tracker Engine Execution (USO, BNO, NVDA)
- **Status**: ✅ PASSED
- **Details**: Decoupled Alpaca Engine executed USO WTI Oil ETF order with independent credentials, independent endpoints, and 50% TP Profit Lock fallback.
- **Timestamp**: 2026-07-24T11:27:26.136Z


---
*Generated automatically by Master Cumulative QA Scenario Test Suite.*
