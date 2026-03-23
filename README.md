# MPP Demo

An interactive browser demo of the [Machine Payments Protocol](https://mpp.dev) — the open standard for autonomous machine-to-machine payments over HTTP.
The demo is currently hosted at [mpp.paymentdemos.com](https://mpp.paymentdemos.com).

![MPP Demo screenshot](https://mpp.dev/og.png)

## What this demo shows

The Machine Payments Protocol extends HTTP with a payment layer. When a client requests a resource that requires payment, the server responds with **HTTP 402 Payment Required** and a payment challenge. The client signs a payment credential and retries the request — all in a single flow with no human interaction required.

This demo makes that invisible process visible, step by step:

### Setup wizard

Before the demo runs, a one-time wallet setup guides you through:

1. **Generate a wallet** — a fresh private key and Ethereum-compatible address are created in the browser
2. **Fund from faucet** — the Tempo Moderato testnet faucet drips 1,000,000 each of PathUSD, AlphaUSD, BetaUSD, and ThetaUSD test tokens to your address
3. **Start the demo** — your wallet is stored in `localStorage` so you don't need to repeat setup

### Payment flow

Once set up, you can run the live MPP payment flow against `https://mpp.dev/api/ping/paid`:

| Step | What happens |
|------|-------------|
| 1 | Client fetches the resource with no credentials |
| 2 | Server returns `402 Payment Required` with a `WWW-Authenticate` challenge |
| 3 | Client signs a payment credential using the Tempo account and retries with an `Authorization` header |
| 4 | Server validates the payment, returns `200 OK` with a `Payment-Receipt` header |

### Activity panels

Two tabs give full visibility into what's happening under the hood:

- **Activity Log** — a timestamped trace of each action
- **Activity Details** — raw HTTP request and response details for both the unauthenticated and authenticated calls, including the full `Authorization` credential and `Payment-Receipt` headers

## Tech stack

| Package | Role |
|---------|------|
| [`mppx`](https://www.npmjs.com/package/mppx) | MPP client — creates payment credentials and handles the 402 flow |
| [`viem`](https://viem.sh) | Wallet key management and Tempo chain interaction |
| `viem/tempo` | Tempo-specific actions: faucet funding, token balance queries |
| [React](https://react.dev) + [Vite](https://vitejs.dev) | Frontend framework and dev server |

The app runs entirely in the browser. The Vite dev server proxies requests to `https://mpp.dev` to work around CORS restrictions on 402 responses.

## Prerequisites

- [Node.js](https://nodejs.org) 18 or later
- npm, pnpm, or bun

## Installation

```bash
git clone https://github.com/brianmc/MPP-Demo.git
cd MPP-Demo
npm install
```

## Running locally

```bash
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.

## How to use

1. Click **Generate wallet** — a new keypair is created in the browser
2. Click **Fund wallet** — the testnet faucet loads your wallet with test tokens (takes a few seconds)
3. Click **Start demo**
4. Click **Run Payment Flow** and watch the four steps animate in real time
5. Switch to the **Activity Details** tab to inspect the raw HTTP traffic

Click **Reset wallet** in the header to start over with a fresh wallet.

> **Note:** This demo uses the Tempo Moderato testnet. No real funds are ever used.

## Project structure

```
src/
  App.tsx        — all UI and logic (setup wizard + demo view)
  main.tsx       — React entry point
  index.css      — global reset
index.html
vite.config.ts   — Vite config with CORS proxy for mpp.dev
```

## Learn more

- [mpp.dev](https://mpp.dev) — Machine Payments Protocol documentation
- [tempo.xyz](https://tempo.xyz) — Tempo blockchain
- [viem.sh/tempo](https://viem.sh/tempo/accounts) — Tempo accounts in viem
- [Stripe MPP announcement](https://stripe.com/blog/machine-payments-protocol)
