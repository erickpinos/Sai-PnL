# Sai Perps P&L Tracker

A web application for tracking profit and loss on Sai Perps trades on Nibiru.

## Overview

This application allows users to enter a Nibiru address and view their Sai Perps trading history with detailed profit/loss information per trade.

## Features

- Enter any Nibiru address to analyze trading history
- View total P&L, win rate, and trade count
- Detailed trade history table with:
  - Trade type (open/close)
  - Direction (long/short)
  - Entry/exit prices
  - P&L percentage
  - Collateral and fees
  - Links to nibiscan.io for each transaction

## Architecture

### Frontend (React + Vite)
- **client/src/pages/home.tsx**: Main dashboard with address search form and trades table
- **client/src/App.tsx**: App routing
- Uses TanStack Query for data fetching
- shadcn/ui components with dark crypto-themed design

### Backend (Express)
- **server/routes.ts**: API endpoint `/api/trades?address=<address>`
- Fetches data from Nibiru via JSON-RPC
- Parses WASM event logs to extract trade information

### Data Flow
1. User enters Nibiru address
2. Frontend calls `/api/trades?address=<address>`
3. Backend queries Nibiru RPC for transaction logs
4. Parses event data to extract trade info (open/close, prices, P&L)
5. Returns structured trade data with stats

## Technical Details

### Nibiru Integration
- RPC Endpoint: `https://evm-rpc.nibiru.fi`
- Sai Perps Contract: `0x9F48A925Dda8528b3A5c2A6717Df0F03c8b167c0`
- WASM Precompile: `0x0000000000000000000000000000000000000802`

### Event Types Parsed
- `sai/perp/user_close_order` - Close trade with P&L
- `sai/perp/handle_trade_pnl` - Trade profit/loss details
- `sai/perp/process_closing_fees` - Fee information
- `register_trade` / `open_trade` - Open position events

## Running the App

```bash
npm run dev
```

The app runs on port 5000.

## Recent Changes

- 2026-01-27: Initial implementation with dark crypto theme, address search, and trade history display
