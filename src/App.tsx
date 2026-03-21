import { useState, useEffect, useCallback } from 'react'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { createPublicClient, http, formatUnits } from 'viem'
import { tempoModerato } from 'viem/chains'
import { Actions } from 'viem/tempo'
import { Mppx, tempo } from 'mppx/client'
import { Receipt } from 'mppx'

// ─── Constants ───────────────────────────────────────────────────────────────

const PAID_ENDPOINT = 'https://mpp.dev/api/ping/paid'
const PROXY_ENDPOINT = '/proxy/ping/paid'
const LS_KEY = 'mpp_demo_pk'

const TESTNET_TOKENS: { address: `0x${string}`; symbol: string }[] = [
  { address: '0x20c0000000000000000000000000000000000000', symbol: 'PathUSD' },
  { address: '0x20c0000000000000000000000000000000000001', symbol: 'AlphaUSD' },
  { address: '0x20c0000000000000000000000000000000000002', symbol: 'BetaUSD' },
  { address: '0x20c0000000000000000000000000000000000003', symbol: 'ThetaUSD' },
]

const tempoClient = createPublicClient({ chain: tempoModerato, transport: http() })

// ─── Types ────────────────────────────────────────────────────────────────────

type TokenBalance = { symbol: string; balance: string; address: string }

type SetupPhase =
  | { id: 'start' }
  | { id: 'generating' }
  | { id: 'generated'; address: string }
  | { id: 'funding' }
  | { id: 'funded'; address: string; txHashes: string[] }

type PayStep =
  | { id: 'idle' }
  | { id: 'fetching_402' }
  | { id: 'got_402'; challenge: string }
  | { id: 'paying' }
  | { id: 'paid'; receipt: { status: string; reference: string; timestamp: string; method: string }; body: string }
  | { id: 'error'; message: string }

type HttpEntry = {
  label: string
  request: { method: string; url: string; headers: Record<string, string>; body?: string }
  response: { status: number; statusText: string; headers: Record<string, string>; body: string }
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((v, k) => { out[k] = v })
  return out
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function shorten(s: string, head = 10, tail = 8) {
  return s.length > head + tail + 3 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s
}

async function loadBalances(key: string): Promise<TokenBalance[]> {
  const account = privateKeyToAccount(key as `0x${string}`)
  return Promise.all(
    TESTNET_TOKENS.map(async ({ address, symbol }) => {
      const raw = await Actions.token.getBalance(tempoClient, {
        account: account.address,
        token: address,
      }).catch(() => 0n)
      return { symbol, balance: formatUnits(raw, 6), address }
    })
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [page, setPage] = useState<'setup' | 'demo'>(() =>
    localStorage.getItem(LS_KEY) ? 'demo' : 'setup'
  )
  const [privateKey, setPrivateKey] = useState<string>(
    () => localStorage.getItem(LS_KEY) ?? ''
  )

  const handleWalletReady = (key: string) => {
    localStorage.setItem(LS_KEY, key)
    setPrivateKey(key)
    setPage('demo')
  }

  const handleReset = () => {
    localStorage.removeItem(LS_KEY)
    setPrivateKey('')
    setPage('setup')
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.badge}>MPP</div>
        <div style={{ flex: 1 }}>
          <h1 style={styles.title}>Machine Payments Protocol</h1>
          <p style={styles.subtitle}>Interactive demo — HTTP 402 payment flow</p>
        </div>
        {page === 'demo' && (
          <button style={{ ...styles.btnSecondary, fontSize: 12 }} onClick={handleReset}>
            Reset wallet
          </button>
        )}
      </header>

      {page === 'setup'
        ? <SetupView onReady={handleWalletReady} />
        : <DemoView privateKey={privateKey} />
      }

      <footer style={styles.footer}>
        Built with{' '}
        <a href="https://mpp.dev" target="_blank" rel="noreferrer" style={styles.link}>mpp.dev</a>
        {' '}· mppx + viem · Tempo Moderato testnet
      </footer>
    </div>
  )
}

// ─── Setup View ───────────────────────────────────────────────────────────────

function SetupView({ onReady }: { onReady: (key: string) => void }) {
  const [phase, setPhase] = useState<SetupPhase>({ id: 'start' })
  const [privateKey, setPrivateKey] = useState('')
  const [balances, setBalances] = useState<TokenBalance[] | null>(null)

  const handleGenerate = () => {
    setPhase({ id: 'generating' })
    const key = generatePrivateKey()
    const account = privateKeyToAccount(key)
    setPrivateKey(key)
    setPhase({ id: 'generated', address: account.address })
  }

  const handleFund = async () => {
    if (phase.id !== 'generated') return
    setPhase({ id: 'funding' })
    try {
      const account = privateKeyToAccount(privateKey as `0x${string}`)
      const receipts = await Actions.faucet.fundSync(tempoClient, { account: account.address })
      const hashes = receipts.map(r => r.transactionHash)
      const bals = await loadBalances(privateKey)
      setBalances(bals)
      setPhase({ id: 'funded', address: account.address, txHashes: hashes })
    } catch (err) {
      // fall back to non-sync if fundSync not available on this endpoint
      try {
        const account = privateKeyToAccount(privateKey as `0x${string}`)
        await Actions.faucet.fund(tempoClient, { account: account.address })
        const bals = await loadBalances(privateKey)
        setBalances(bals)
        setPhase({ id: 'funded', address: account.address, txHashes: [] })
      } catch (err2) {
        const msg = err2 instanceof Error ? err2.message : String(err2)
        alert(`Faucet error: ${msg}`)
        setPhase({ id: 'generated', address: privateKeyToAccount(privateKey as `0x${string}`).address })
      }
    }
  }

  const address = phase.id === 'generated' || phase.id === 'funded'
    ? phase.address
    : phase.id === 'funding'
    ? privateKeyToAccount(privateKey as `0x${string}`).address
    : null

  return (
    <main style={styles.setupMain}>
      <div style={styles.setupCard}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚡</div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', marginBottom: 8 }}>
            Set up your testnet wallet
          </h2>
          <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.6 }}>
            Create a free wallet on the Tempo Moderato testnet and get funded with test tokens
            to try out the Machine Payments Protocol.
          </p>
        </div>

        {/* Steps */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 32 }}>
          {/* Step 1 */}
          <SetupStep
            num={1}
            title="Generate a wallet"
            done={phase.id !== 'start' && phase.id !== 'generating'}
            active={phase.id === 'start' || phase.id === 'generating'}
          >
            {phase.id === 'start' && (
              <button style={styles.btnPrimary} onClick={handleGenerate}>
                Generate wallet
              </button>
            )}
            {phase.id === 'generating' && (
              <p style={styles.hint}>Generating…</p>
            )}
            {address && phase.id !== 'start' && phase.id !== 'generating' && (
              <div>
                <p style={{ ...styles.hint, marginBottom: 6 }}>Your address</p>
                <div style={styles.addressBox}>{address}</div>
              </div>
            )}
          </SetupStep>

          {/* Step 2 */}
          <SetupStep
            num={2}
            title="Fund from testnet faucet"
            done={phase.id === 'funded'}
            active={phase.id === 'generated' || phase.id === 'funding'}
            muted={phase.id === 'start' || phase.id === 'generating'}
          >
            {(phase.id === 'start' || phase.id === 'generating') && (
              <p style={styles.hint}>Complete step 1 first</p>
            )}
            {phase.id === 'generated' && (
              <button style={styles.btnPrimary} onClick={handleFund}>
                Fund wallet
              </button>
            )}
            {phase.id === 'funding' && (
              <p style={styles.hint}>Requesting testnet tokens from faucet…</p>
            )}
            {phase.id === 'funded' && balances && (
              <div>
                <p style={{ ...styles.hint, marginBottom: 8 }}>
                  {phase.txHashes.length > 0
                    ? `Funded via ${phase.txHashes.length} transaction${phase.txHashes.length > 1 ? 's' : ''}`
                    : 'Funded successfully'}
                </p>
                <div style={styles.balanceGrid}>
                  {balances.map(({ symbol, balance }) => (
                    <div key={symbol} style={styles.balanceChip}>
                      <span style={{ color: '#64748b', fontSize: 11 }}>{symbol}</span>
                      <span style={{ color: '#4ade80', fontSize: 13, fontFamily: 'monospace', fontWeight: 600 }}>
                        {Number(balance).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </SetupStep>

          {/* Step 3 */}
          <SetupStep
            num={3}
            title="Run the payment demo"
            done={false}
            active={phase.id === 'funded'}
            muted={phase.id !== 'funded'}
          >
            {phase.id !== 'funded' && (
              <p style={styles.hint}>Complete steps 1 & 2 first</p>
            )}
            {phase.id === 'funded' && (
              <button style={styles.btnPrimary} onClick={() => onReady(privateKey)}>
                Start demo →
              </button>
            )}
          </SetupStep>
        </div>

        <p style={{ fontSize: 12, color: '#334155', textAlign: 'center' }}>
          Your private key is stored only in this browser's localStorage. This is a demo — never use real funds.
        </p>
      </div>
    </main>
  )
}

function SetupStep({
  num, title, done, active, muted, children,
}: {
  num: number
  title: string
  done: boolean
  active: boolean
  muted?: boolean
  children: React.ReactNode
}) {
  const numColor = done ? '#6366f1' : active ? '#f59e0b' : '#334155'
  return (
    <div style={{
      background: '#0f172a',
      border: `1px solid ${active ? '#334155' : done ? '#1e293b' : '#1e293b'}`,
      borderRadius: 12,
      padding: '16px 20px',
      opacity: muted ? 0.5 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          border: `2px solid ${numColor}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 700, color: numColor,
          background: done ? `${numColor}22` : 'transparent',
          flexShrink: 0,
        }}>
          {done ? '✓' : num}
        </div>
        <span style={{ fontSize: 14, fontWeight: 600, color: active ? '#f1f5f9' : done ? '#94a3b8' : '#475569' }}>
          {title}
        </span>
      </div>
      <div style={{ paddingLeft: 40 }}>{children}</div>
    </div>
  )
}

// ─── Demo View ────────────────────────────────────────────────────────────────

function DemoView({ privateKey }: { privateKey: string }) {
  const [step, setStep] = useState<PayStep>({ id: 'idle' })
  const [log, setLog] = useState<string[]>([])
  const [httpLog, setHttpLog] = useState<HttpEntry[]>([])
  const [activeTab, setActiveTab] = useState<'log' | 'details'>('log')
  const [balances, setBalances] = useState<TokenBalance[] | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)

  const account = privateKeyToAccount(privateKey as `0x${string}`)

  const refreshBalances = useCallback(async () => {
    setBalanceLoading(true)
    try {
      setBalances(await loadBalances(privateKey))
    } finally {
      setBalanceLoading(false)
    }
  }, [privateKey])

  useEffect(() => { refreshBalances() }, [refreshBalances])

  const addLog = useCallback((msg: string) => {
    setLog(prev => [...prev, `${new Date().toLocaleTimeString()} — ${msg}`])
  }, [])

  const addHttp = useCallback((entry: HttpEntry) => {
    setHttpLog(prev => [...prev, entry])
  }, [])

  const handleRun = async () => {
    setLog([])
    setHttpLog([])
    setActiveTab('log')
    setStep({ id: 'fetching_402' })
    addLog(`Calling ${PAID_ENDPOINT} without payment...`)

    try {
      // ── Request 1: unauthenticated fetch ──────────────────────────────────
      const rawRes = await fetch(PROXY_ENDPOINT)
      const rawBody = await rawRes.text()
      addHttp({
        label: 'Request 1 — Unauthenticated fetch',
        request: { method: 'GET', url: PAID_ENDPOINT, headers: {} },
        response: { status: rawRes.status, statusText: rawRes.statusText, headers: headersToRecord(rawRes.headers), body: rawBody || '(empty)' },
      })
      addLog(`Server responded with HTTP ${rawRes.status} ${rawRes.statusText}`)

      if (rawRes.status !== 402) {
        setStep({ id: 'error', message: `Expected 402 but got ${rawRes.status}` })
        return
      }

      const challenge = rawRes.headers.get('WWW-Authenticate') ?? '(see headers)'
      setStep({ id: 'got_402', challenge })
      addLog(`Payment challenge received: ${challenge.slice(0, 80)}…`)

      await new Promise(r => setTimeout(r, 800))

      // ── Request 2: authenticated fetch with credential ────────────────────
      setStep({ id: 'paying' })
      addLog(`Signing with account ${shorten(account.address)}...`)

      const mppx = Mppx.create({
        polyfill: false,
        methods: [tempo({ account: privateKeyToAccount(privateKey as `0x${string}`) })],
      })

      // Re-create the raw 402 response for createCredential (headers only, body already consumed)
      const challengeRes = new Response(rawBody, { status: 402, headers: headersToRecord(rawRes.headers) })
      const credential = await mppx.createCredential(challengeRes, {
        account: privateKeyToAccount(privateKey as `0x${string}`),
      })

      addLog('Sending payment credential to server...')
      const reqHeaders = { Authorization: credential }
      const paidRes = await fetch(PROXY_ENDPOINT, { headers: reqHeaders })
      const body = await paidRes.text()
      addHttp({
        label: 'Request 2 — Authenticated fetch',
        request: { method: 'GET', url: PAID_ENDPOINT, headers: reqHeaders },
        response: { status: paidRes.status, statusText: paidRes.statusText, headers: headersToRecord(paidRes.headers), body: body || '(empty)' },
      })
      addLog(`Server responded with HTTP ${paidRes.status} ${paidRes.statusText}`)

      const receipt = Receipt.fromResponse(paidRes)

      addLog(`Payment receipt status: ${receipt.status}`)
      addLog(`Transaction reference: ${receipt.reference}`)
      addLog(`Timestamp: ${receipt.timestamp}`)

      setStep({
        id: 'paid',
        receipt: {
          status: receipt.status,
          reference: receipt.reference,
          timestamp: receipt.timestamp,
          method: receipt.method,
        },
        body,
      })
      refreshBalances()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      addLog(`Error: ${msg}`)
      setStep({ id: 'error', message: msg })
    }
  }

  const handleReset = () => {
    setStep({ id: 'idle' })
    setLog([])
    setHttpLog([])
  }

  return (
    <main style={styles.main}>
      {/* Left column */}
      <div>
        {/* Wallet card */}
        <section style={styles.card}>
          <h2 style={styles.cardTitle}>Wallet</h2>
          <p style={{ ...styles.hint, marginBottom: 8 }}>Address</p>
          <div style={styles.addressBox}>{account.address}</div>

          <div style={{ height: 16 }} />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <p style={{ ...styles.hint, marginBottom: 0 }}>Testnet balances</p>
            <button
              style={{ ...styles.btnSecondary, padding: '3px 10px', fontSize: 11 }}
              onClick={refreshBalances}
              disabled={balanceLoading}
            >
              {balanceLoading ? '…' : 'Refresh'}
            </button>
          </div>
          <div style={styles.balanceBox}>
            {balanceLoading && !balances && (
              <span style={{ color: '#64748b', fontSize: 12 }}>Loading…</span>
            )}
            {balances?.map(({ symbol, balance }) => (
              <div key={symbol} style={styles.balanceRow}>
                <span style={{ color: '#94a3b8', fontSize: 12 }}>{symbol}</span>
                <span style={{
                  fontSize: 12, fontFamily: 'monospace',
                  color: parseFloat(balance) > 0 ? '#4ade80' : '#475569',
                }}>
                  {Number(balance).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Demo controls */}
        <section style={styles.card}>
          <h2 style={styles.cardTitle}>Demo</h2>
          <p style={{ ...styles.hint, marginBottom: 8 }}>Target endpoint</p>
          <div style={styles.endpointBox}>{PAID_ENDPOINT}</div>

          <div style={{ height: 20 }} />

          <button
            style={{ ...styles.btnPrimary, opacity: step.id === 'fetching_402' || step.id === 'paying' ? 0.6 : 1 }}
            onClick={handleRun}
            disabled={step.id === 'fetching_402' || step.id === 'paying'}
          >
            {step.id === 'fetching_402' ? 'Fetching…' : step.id === 'paying' ? 'Paying…' : 'Run Payment Flow'}
          </button>

          {step.id !== 'idle' && (
            <button style={{ ...styles.btnSecondary, marginTop: 10, width: '100%' }} onClick={handleReset}>
              Reset
            </button>
          )}
        </section>
      </div>

      {/* Right column */}
      <div style={styles.rightCol}>
        <section style={styles.card}>
          <h2 style={styles.cardTitle}>Payment Flow</h2>
          <div style={styles.flow}>
            <FlowStep num={1} label="Fetch resource (no auth)"
              active={step.id === 'fetching_402'}
              done={step.id !== 'idle' && step.id !== 'fetching_402'} />
            <FlowArrow />
            <FlowStep num={2} label="Server returns HTTP 402"
              sublabel={step.id === 'got_402' || step.id === 'paying' || step.id === 'paid' ? 'Payment Required' : undefined}
              active={step.id === 'got_402'}
              done={step.id === 'paying' || step.id === 'paid'}
              isPayment />
            <FlowArrow />
            <FlowStep num={3} label="Sign & send payment credential"
              active={step.id === 'paying'}
              done={step.id === 'paid'} />
            <FlowArrow />
            <FlowStep num={4} label="Receive response + receipt"
              active={false}
              done={step.id === 'paid'}
              isSuccess />
          </div>
        </section>

        {step.id === 'paid' && (
          <section style={{ ...styles.card, borderColor: '#22c55e44' }}>
            <h2 style={{ ...styles.cardTitle, color: '#22c55e' }}>Payment Successful</h2>
            <div style={styles.receiptGrid}>
              <ReceiptField label="Status" value={step.receipt.status} color="#22c55e" />
              <ReceiptField label="Method" value={step.receipt.method} />
              <ReceiptField label="Reference" value={step.receipt.reference} mono />
              <ReceiptField label="Timestamp" value={step.receipt.timestamp} />
            </div>
            <ReceiptField label="Response Body" value={step.body} mono />
          </section>
        )}

        {step.id === 'error' && (
          <section style={{ ...styles.card, borderColor: '#ef444444' }}>
            <h2 style={{ ...styles.cardTitle, color: '#ef4444' }}>Error</h2>
            <p style={{ fontFamily: 'monospace', color: '#fca5a5', fontSize: 13 }}>{step.message}</p>
          </section>
        )}

        {(log.length > 0 || httpLog.length > 0) && (
          <section style={styles.card}>
            <div style={styles.tabBar}>
              <button
                style={{ ...styles.tab, ...(activeTab === 'log' ? styles.tabActive : {}) }}
                onClick={() => setActiveTab('log')}
              >
                Activity Log
              </button>
              <button
                style={{ ...styles.tab, ...(activeTab === 'details' ? styles.tabActive : {}) }}
                onClick={() => setActiveTab('details')}
              >
                Activity Details
                {httpLog.length > 0 && (
                  <span style={styles.tabBadge}>{httpLog.length}</span>
                )}
              </button>
            </div>

            {activeTab === 'log' && (
              <div style={styles.logBox}>
                {log.map((line, i) => <div key={i} style={styles.logLine}>{line}</div>)}
              </div>
            )}

            {activeTab === 'details' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {httpLog.length === 0
                  ? <p style={{ ...styles.hint, padding: '8px 0' }}>No requests yet</p>
                  : httpLog.map((entry, i) => <HttpEntryCard key={i} entry={entry} />)
                }
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  )
}

// ─── Shared components ────────────────────────────────────────────────────────

function FlowStep({ num, label, sublabel, active, done, isPayment, isSuccess }: {
  num: number; label: string; sublabel?: string
  active: boolean; done: boolean; isPayment?: boolean; isSuccess?: boolean
}) {
  const color = done ? (isSuccess ? '#22c55e' : '#6366f1') : active ? '#f59e0b' : '#334155'
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <div style={{
        width: 32, height: 32, borderRadius: '50%', border: `2px solid ${color}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, fontWeight: 700, color, flexShrink: 0,
        background: done ? `${color}22` : 'transparent', transition: 'all 0.3s',
      }}>
        {done ? '✓' : num}
      </div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 500, color: active ? '#f59e0b' : done ? '#e2e8f0' : '#64748b' }}>
          {label}
        </div>
        {sublabel && (
          <div style={{ fontSize: 12, color: isPayment ? '#f87171' : '#94a3b8', marginTop: 2 }}>
            {isPayment ? '⚠ ' : ''}{sublabel}
          </div>
        )}
      </div>
    </div>
  )
}

function FlowArrow() {
  return <div style={{ marginLeft: 15, width: 2, height: 20, background: '#1e293b' }} />
}

function HttpEntryCard({ entry }: { entry: HttpEntry }) {
  const statusColor = entry.response.status < 300 ? '#4ade80' : entry.response.status < 500 ? '#f59e0b' : '#f87171'
  return (
    <div style={{ background: '#020617', border: '1px solid #1e293b', borderRadius: 8, overflow: 'hidden', fontSize: 12, fontFamily: 'monospace' }}>
      {/* Label bar */}
      <div style={{ background: '#0f172a', borderBottom: '1px solid #1e293b', padding: '6px 12px', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {entry.label}
      </div>

      {/* Request */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #0f172a' }}>
        <div style={{ color: '#6366f1', fontWeight: 700, marginBottom: 6 }}>
          {entry.request.method} <span style={{ color: '#7dd3fc' }}>{entry.request.url}</span>
        </div>
        {Object.entries(entry.request.headers).map(([k, v]) => (
          <div key={k} style={{ color: '#94a3b8' }}>
            <span style={{ color: '#64748b' }}>{k}: </span>
            <span style={{ wordBreak: 'break-all' }}>{v}</span>
          </div>
        ))}
        {entry.request.body && (
          <div style={{ color: '#94a3b8', marginTop: 6, paddingTop: 6, borderTop: '1px solid #1e293b' }}>
            {entry.request.body}
          </div>
        )}
      </div>

      {/* Response */}
      <div style={{ padding: '10px 12px' }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>
          <span style={{ color: statusColor }}>{entry.response.status} {entry.response.statusText}</span>
        </div>
        {Object.entries(entry.response.headers).map(([k, v]) => (
          <div key={k} style={{ color: '#94a3b8' }}>
            <span style={{ color: '#64748b' }}>{k}: </span>
            <span style={{ wordBreak: 'break-all' }}>{v}</span>
          </div>
        ))}
        {entry.response.body && (
          <div style={{ color: '#cbd5e1', marginTop: 6, paddingTop: 6, borderTop: '1px solid #1e293b', wordBreak: 'break-all' }}>
            {entry.response.body}
          </div>
        )}
      </div>
    </div>
  )
}

function ReceiptField({ label, value, color, mono }: { label: string; value: string; color?: string; mono?: boolean }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: color ?? '#e2e8f0', fontFamily: mono ? 'monospace' : 'inherit', wordBreak: 'break-all' }}>
        {value}
      </div>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh', display: 'flex', flexDirection: 'column',
    padding: '0 24px', maxWidth: 1100, margin: '0 auto',
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 16,
    padding: '32px 0 24px', borderBottom: '1px solid #1e293b',
  },
  badge: {
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    color: '#fff', fontWeight: 800, fontSize: 18,
    padding: '8px 14px', borderRadius: 10, letterSpacing: '0.05em',
  },
  title: { fontSize: 24, fontWeight: 700, color: '#f1f5f9' },
  subtitle: { fontSize: 14, color: '#64748b', marginTop: 2 },

  // Setup
  setupMain: {
    flex: 1, display: 'flex', alignItems: 'flex-start',
    justifyContent: 'center', padding: '48px 0',
  },
  setupCard: {
    width: '100%', maxWidth: 520,
    background: '#0f172a', border: '1px solid #1e293b',
    borderRadius: 16, padding: '32px 36px',
  },
  addressBox: {
    background: '#1e293b', border: '1px solid #334155',
    borderRadius: 8, padding: '8px 12px',
    fontSize: 12, fontFamily: 'monospace', color: '#7dd3fc',
    wordBreak: 'break-all',
  },
  balanceGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
  },
  balanceChip: {
    background: '#0f172a', border: '1px solid #1e293b',
    borderRadius: 8, padding: '8px 12px',
    display: 'flex', flexDirection: 'column' as const, gap: 2,
  },

  // Demo
  main: {
    display: 'grid', gridTemplateColumns: '300px 1fr',
    gap: 20, padding: '24px 0', flex: 1, alignItems: 'start',
  },
  rightCol: {},
  card: {
    background: '#0f172a', border: '1px solid #1e293b',
    borderRadius: 12, padding: '20px 24px', marginBottom: 16,
  },
  cardTitle: {
    fontSize: 15, fontWeight: 600, color: '#94a3b8',
    marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.05em',
  },
  endpointBox: {
    background: '#1e293b', border: '1px solid #334155',
    borderRadius: 8, padding: '8px 12px',
    fontSize: 12, fontFamily: 'monospace', color: '#7dd3fc', wordBreak: 'break-all',
  },
  balanceBox: {
    background: '#1e293b', border: '1px solid #334155',
    borderRadius: 8, padding: '10px 12px',
    display: 'flex', flexDirection: 'column' as const, gap: 6,
  },
  balanceRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  flow: { display: 'flex', flexDirection: 'column' },
  receiptGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' },
  tabBar: {
    display: 'flex', gap: 4, marginBottom: 14,
    borderBottom: '1px solid #1e293b', paddingBottom: 0,
  },
  tab: {
    padding: '6px 14px', background: 'transparent', border: 'none',
    borderBottom: '2px solid transparent', marginBottom: -1,
    color: '#475569', fontSize: 13, fontWeight: 500, cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 6,
  },
  tabActive: {
    color: '#e2e8f0', borderBottomColor: '#6366f1',
  },
  tabBadge: {
    background: '#1e293b', color: '#94a3b8',
    fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10,
  },
  logBox: {
    background: '#020617', border: '1px solid #1e293b',
    borderRadius: 8, padding: '12px 14px',
    maxHeight: 200, overflowY: 'auto', fontFamily: 'monospace', fontSize: 12,
  },
  logLine: { color: '#94a3b8', marginBottom: 4, lineHeight: 1.5 },

  // Shared
  btnPrimary: {
    width: '100%', padding: '12px 20px',
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    color: '#fff', border: 'none', borderRadius: 8,
    fontSize: 14, fontWeight: 600, cursor: 'pointer',
  },
  btnSecondary: {
    padding: '8px 14px', background: '#1e293b', color: '#94a3b8',
    border: '1px solid #334155', borderRadius: 8,
    fontSize: 13, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap',
  },
  label: { display: 'block', fontSize: 13, fontWeight: 500, color: '#94a3b8', marginBottom: 6 },
  hint: { fontSize: 12, color: '#475569', marginTop: 0 },
  footer: {
    padding: '16px 0 24px', fontSize: 13, color: '#475569',
    textAlign: 'center', borderTop: '1px solid #1e293b',
  },
  link: { color: '#818cf8', textDecoration: 'none' },
}
