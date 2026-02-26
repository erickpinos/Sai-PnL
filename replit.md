# Sai PnL Tracker

A web application for tracking profit and loss on Sai Perps trades on Nibiru.

**Website URL:** https://sai.fun

## Overview

This application allows users to connect their wallet (MetaMask/Rabby) or enter a Nibiru EVM address (0x format) to view their Sai Perps trading history with detailed profit/loss information per trade.

## Features

- Connect wallet (MetaMask/Rabby Wallet support via window.ethereum)
- Enter any Nibiru EVM address (0x format) to analyze trading history
- Switch between Mainnet and Testnet networks
- View total PnL, win rate, and trade count
- Detailed trade history table with:
  - Trading pair (e.g., BTC)
  - Direction (long/short) with leverage
  - Entry/exit prices
  - Time opened and time closed
  - Opening and closing fees (extracted from RPC transaction receipts)
  - PnL percentage and amount
  - Collateral
  - Links to nibiscan.io for each transaction

## Architecture

### Frontend (React + Vite)
- **client/src/pages/home.tsx**: Main dashboard with address search form and trades table
- **client/src/App.tsx**: App routing
- Uses TanStack Query for data fetching
- shadcn/ui components with dark crypto-themed design

### Backend (Express)
- **server/routes.ts**: API endpoint `/api/trades?address=<address>&network=<mainnet|testnet>&limit=<number>&offset=<number>`
- Fetches data from Sai Keeper GraphQL API
- Converts EVM addresses (0x) to Nibiru bech32 format (nibi1) for API queries
- Merges trade data with trade history to get accurate realized PnL

### Data Flow
1. User enters Nibiru EVM address (0x format)
2. Frontend calls `/api/trades?address=<address>&network=<network>`
3. Backend converts 0x address to nibi1 bech32 format using bech32 library
4. Backend queries Sai Keeper GraphQL API for trades and trade history
5. Merges trade data with realized PnL from trade history
6. Returns structured trade data with stats

## Technical Details

### Sai Keeper GraphQL API
- Mainnet: `https://sai-keeper.nibiru.fi/query`
- Testnet: `https://sai-keeper.testnet-2.nibiru.fi/query`

### Address Conversion
- User inputs EVM address: `0x5DBa7Aa28074201a2c3Abe4e743Adaf8E74BD183`
- Backend converts to bech32: `nibi1tka84g5qwssp5tp6he88gwk6lrn5h5vrumrhqx`
- Uses bech32 library with "nibi" prefix

### GraphQL Queries
- `trades` query: Returns trade list with open/close status, prices, leverage, and `perpBorrowing { marketId, collateralToken { symbol } }`
- `tradeHistory` query: Returns `realizedPnlPct`, `realizedPnlCollateral`, `collateralPrice`, and `evmTxHash` for closed trades
- `borrowings` query: Returns all markets with prices and oracle token prices (used for matching trades to pairs and USD conversion)

### Collateral Token USD Conversion
Markets can use different collateral tokens (USDC or stNIBI). All monetary values are converted to USD:
- `perpBorrowing.collateralToken.symbol` on each trade identifies the collateral token
- For USDC collateral: multiplier = 1 (already in USD)
- For stNIBI collateral: multiplier = oracle stNIBI/USD price
- `collateralPrice` from `tradeHistory` provides historical USD price at trade time (fallback for closed trades)
- Conversion applies to: collateral, PnL amounts, fees, position values, volume, and open interest
- Oracle prices fetched via `oracle { tokenPricesUsd }` in the MARKETS_QUERY

### Market Matching
Market symbols are determined by querying `perpBorrowing.marketId` directly from each trade, then mapping to symbols using the `borrowings` endpoint:
1. Query `trades` with `perpBorrowing { marketId, collateralToken { symbol } }` included
2. Query all markets via `borrowings` endpoint to get `marketId → symbol` mapping + oracle prices
3. Trades with deprecated/unknown marketId show "Unknown" as the pair

### PnL Data Sources
- For closed trades: `realizedPnlPct` from `tradeHistory` query (amounts converted to USD via collateral price)
- For open trades: `state.pnlPct` from `trades` query (unrealized PnL, amounts converted to USD via oracle price)

### Fee Extraction (RPC-based)
- Fees are extracted from EVM transaction receipts via RPC
- Mainnet RPC: `https://evm-rpc.nibiru.fi`
- Testnet RPC: `https://evm-rpc.testnet-2.nibiru.fi`
- Parse wasm events from transaction logs:
  - `wasm-sai/perp/process_opening_fees` → `total_fee_charged`, `trigger_fee_component`
  - `wasm-sai/perp/process_closing_fees` → `final_closing_fee`, `final_trigger_fee`
- Borrowing fee is from GraphQL state (available for open trades only)
- Fees are fetched in parallel (batches of 10) with 10-second timeout per request
- **Note:** Mainnet RPC prunes old transaction receipts (returns null), so fees show as "-" for older trades. Testnet retains receipts longer.
- UI shows a single consolidated "Fees" column (individual fee breakdown hidden)

## Running the App

```bash
npm run dev
```

The app runs on port 5000.

## Recent Changes

- 2026-02-26: Consolidated 4 fee columns into single "Fees" column; fixed PnL percentage to use weighted calculation; added 10s RPC timeout
- 2026-02-26: Fixed volume calculation: batch size 100 (API hard limit), include order_triggered events, no trade ID dedup (matches sai-explorer)
- 2026-02-26: Added stNIBI collateral USD conversion using oracle prices across all monetary values (trades, PnL, fees, volume, OI)
- 2026-02-04: Simplified market matching by querying perpBorrowing directly from trades (API fix deployed)
- 2026-02-03: Improved market matching using tradeHistory partial data to extract marketId (most closed trades now show correct pair)
- 2026-02-03: Fixed perpBorrowing API issue by fetching markets separately and matching trades by price
- 2026-02-03: Added hide address toggle (eye icon) in top right header to mask wallet addresses with dots
- 2026-02-03: Changed all Download buttons to Share buttons that open a modal with the generated image for right-click saving
- 2026-02-02: Added Total Trading Volume to Protocol Stats (shows "Coming Soon" - API doesn't expose volume data yet)
- 2026-01-31: Added closed vault positions (withdrawals) to "My Vaults" tab with distinct styling
- 2026-01-31: Added "My Vaults" tab showing user's SLP-USDC and SLP-stNIBI positions with deposit history and earnings
- 2026-01-31: Hide duplicate stNIBI/USDC vaults under collapsible "Deprecated/Hidden" section
- 2026-01-31: Added methodology explanations for all Protocol Stats metrics (TVL, OI, etc.)
- 2026-01-31: Fixed vault TVL calculation to use oracle token prices with availableAssets (matches DefiLlama)
- 2026-01-31: Added vault breakdown section to Protocol Stats showing individual vault TVL, symbol, and APY
- 2026-01-31: Added "Connect Wallet" button with MetaMask and Rabby Wallet support
- 2026-01-31: Added Mark Price column to open positions table
- 2026-01-30: Implemented RPC-based fee extraction from transaction receipts (opening and closing fees)
- 2026-01-30: Added Time Opened and Time Closed columns to trade table
- 2026-01-30: Refactored to use Sai Keeper GraphQL API for instant data retrieval (vs slow RPC block scanning)
- 2026-01-30: Added EVM to bech32 address conversion
- 2026-01-30: Fixed PnL display by merging trade data with trade history for realized PnL
- 2026-01-30: Added network switching between Mainnet and Testnet
- 2026-01-27: Initial implementation with dark crypto theme, address search, and trade history display
