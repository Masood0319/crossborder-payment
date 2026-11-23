import Head from 'next/head';
import Link from 'next/link';
import { AlertTriangle, ArrowLeftRight, Clock3, FileSearch, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Brand } from '../components/PublicSite.jsx';
import {
  clearStaffSession,
  getOperationsSummary,
  getOperationsTransfer,
  getOperationsTransfers,
  getRoutingAnalytics,
  getStaffSession,
} from '../services/api.js';

const viewerRoles = ['TREASURY_VIEWER', 'TREASURY_OPERATOR', 'TREASURY_ADMIN'];
const statuses = ['INITIATED', 'VALIDATING', 'QUOTED', 'FUNDS_DEBITED', 'SUBMITTED', 'ACCEPTED', 'SETTLED', 'FAILED', 'REJECTED', 'RETURNED', 'CANCELLED', 'SIMULATED', 'REVERSED'];
const corridors = ['PK_AE', 'AE_PK', 'PK_SA', 'SA_PK'];

export default function OperationsPage() {
  const [staffSession, setStaffSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [summary, setSummary] = useState(null);
  const [routingAnalytics, setRoutingAnalytics] = useState(null);
  const [transfers, setTransfers] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({ query: '', status: '', currency: '', corridor: '' });
  const [appliedFilters, setAppliedFilters] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);

  const roles = staffSession?.user?.roles || [];
  const canView = roles.some(role => viewerRoles.includes(role));

  const refresh = useCallback(async (page = 1, applied = appliedFilters) => {
    setLoading(true);
    setError('');
    try {
      const [nextSummary, transferResult, routeResult] = await Promise.all([
        getOperationsSummary(),
        getOperationsTransfers({ ...applied, page, pageSize: 20 }),
        getRoutingAnalytics(),
      ]);
      setSummary(nextSummary);
      setTransfers(transferResult.transfers);
      setPagination(transferResult.pagination);
      setRoutingAnalytics(routeResult);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [appliedFilters]);

  useEffect(() => {
    setStaffSession(getStaffSession());
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready && canView) refresh(1);
    else if (ready) setLoading(false);
  }, [ready, canView, refresh]);

  const openTransfer = async transfer => {
    setSelected(null);
    setDetailLoading(true);
    setError('');
    try {
      setSelected(await getOperationsTransfer(transfer.id));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setDetailLoading(false);
    }
  };

  const applyFilters = event => {
    event.preventDefault();
    const next = Object.fromEntries(Object.entries(filters).map(([key, value]) => [key, value.trim()]));
    setAppliedFilters(next);
  };

  const signOut = () => {
    clearStaffSession();
    window.location.assign('/login');
  };

  if (!ready) return <Loading />;
  if (!staffSession || !canView) {
    return <AccessDenied />;
  }

  return (
    <>
      <Head>
        <title>Transfer operations · KitePay</title>
        <meta name="description" content="Role-protected, read-only simulated transfer monitoring." />
      </Head>
      <main className="min-h-screen bg-canvas">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
            <div className="flex items-center gap-4"><Brand /><span className="hidden border-l border-slate-200 pl-4 text-sm font-bold text-slate-500 sm:block">Transfer operations</span></div>
            <div className="flex items-center gap-2">
              <Link href="/treasury" className="rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Treasury</Link>
              <Link href="/compliance" className="hidden rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 sm:inline-flex">Compliance</Link>
              <button type="button" onClick={signOut} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"><LogOut size={15} />Sign out</button>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-8 sm:py-9">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[.15em] text-blue-800">Staff workspace · read only</p>
              <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-ink">Transfer monitoring</h1>
              <p className="mt-2 text-sm text-slate-500">Investigate transfer state, recorded events, routing configuration and simulated outcomes.</p>
            </div>
            <button type="button" onClick={() => refresh(1)} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} />Refresh data</button>
          </div>

          <div role="note" className="flex gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-4 text-sm leading-6 text-blue-950">
            <ShieldCheck className="mt-0.5 shrink-0" size={18} />
            <p><strong>Simulation only.</strong> Statistics use persisted application records. A successful simulated transfer is not a bank confirmation or completed real-world settlement. No retry or state-changing action is offered here.</p>
          </div>
          {error && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</p>}

          {loading && !summary ? <Loading /> : summary && (
            <>
              <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="Transfer metrics">
                <Metric label="All transfers" value={summary.totals.totalTransfers} />
                <Metric label="Successful simulated" value={summary.totals.successfulSimulatedTransfers} tone="green" />
                <Metric label="Pending" value={summary.totals.pendingTransfers} tone="amber" />
                <Metric label="Failed / rejected" value={summary.totals.failedTransfers} tone="rose" />
                <Metric label="KYC review queue" value={summary.totals.pendingKycApplications} tone="blue" />
              </section>

              <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,.8fr)]">
                <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
                  <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
                    <h2 className="font-extrabold text-ink">Transfer queue</h2>
                    <p className="mt-1 text-xs text-slate-500">Search references; filters are applied by the backend.</p>
                    <form onSubmit={applyFilters} className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                      <input aria-label="Search reference" value={filters.query} onChange={event => setFilters({ ...filters, query: event.target.value })} placeholder="UETR or reference" className="rounded-lg border border-slate-200 px-3 py-2 text-sm lg:col-span-2" />
                      <select aria-label="Filter by status" value={filters.status} onChange={event => setFilters({ ...filters, status: event.target.value })} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"><option value="">All statuses</option>{statuses.map(status => <option key={status}>{status}</option>)}</select>
                      <select aria-label="Filter by currency" value={filters.currency} onChange={event => setFilters({ ...filters, currency: event.target.value })} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"><option value="">All currencies</option>{['PKR', 'AED', 'SAR'].map(currency => <option key={currency}>{currency}</option>)}</select>
                      <select aria-label="Filter by corridor" value={filters.corridor} onChange={event => setFilters({ ...filters, corridor: event.target.value })} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"><option value="">All corridors</option>{corridors.map(corridor => <option key={corridor}>{corridor}</option>)}</select>
                      <button className="rounded-lg bg-ink px-4 py-2 text-sm font-bold text-white hover:bg-slate-700 sm:col-span-2 lg:col-span-5">Apply filters</button>
                    </form>
                  </div>
                  {loading ? <Loading /> : transfers.length ? (
                    <>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[720px] text-left text-sm">
                          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3">Reference</th><th className="px-4 py-3">Corridor</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Status</th><th className="px-5 py-3">Review flag</th><th className="px-4 py-3">Details</th></tr></thead>
                          <tbody className="divide-y divide-slate-100">
                            {transfers.map(transfer => <tr key={transfer.id} className="hover:bg-slate-50/70">
                              <td className="px-5 py-4"><span className="block font-mono text-xs font-bold text-ink">{transfer.uetr}</span><span className="mt-1 block text-[10px] text-slate-400">{new Date(transfer.createdAt).toLocaleString()}</span></td>
                              <td className="px-4 py-4 font-bold text-slate-700">{transfer.corridorCode}</td>
                              <td className="px-4 py-4 tabular-nums text-slate-700">{formatAmount(transfer.sendAmount)} {transfer.sourceCurrency}</td>
                              <td className="px-4 py-4"><Status status={transfer.status} /></td>
                              <td className="px-5 py-4 text-xs text-slate-600">{transfer.user?.kycStatus || 'Unavailable'}</td>
                              <td className="px-4 py-4"><button type="button" onClick={() => openTransfer(transfer)} className="inline-flex items-center gap-1 font-bold text-blue-800 hover:underline"><FileSearch size={15} />Inspect</button></td>
                            </tr>)}
                          </tbody>
                        </table>
                      </div>
                      <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
                        <span>{pagination.total} matching transfers · page {pagination.page} of {Math.max(pagination.totalPages, 1)}</span>
                        <div className="flex gap-2">
                          <button type="button" disabled={pagination.page <= 1 || loading} onClick={() => refresh(pagination.page - 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 font-bold disabled:opacity-40">Previous</button>
                          <button type="button" disabled={pagination.page >= pagination.totalPages || loading} onClick={() => refresh(pagination.page + 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 font-bold disabled:opacity-40">Next</button>
                        </div>
                      </div>
                    </>
                  ) : <Empty title="No transfers found" detail="Try changing the status, currency, corridor or reference search." />}
                </section>

                <section className="space-y-5">
                  {detailLoading ? <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500"><RefreshCw className="mx-auto animate-spin" size={18} />Loading transfer investigation…</div> : selected ? <TransferDetail detail={selected} /> : <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200"><FileSearch className="mx-auto text-slate-400" size={25} /><p className="mt-3 font-bold text-ink">Select a transfer</p><p className="mt-1 text-sm text-slate-500">Recorded state events and routing details will appear here.</p></div>}
                  <ActivityPanel title="Recent transfer activity" events={summary.recentActivity} />
                </section>
              </div>

              <section className="grid gap-5 lg:grid-cols-2">
                <GroupPanel title="Corridor statistics" rows={summary.corridorStatistics} nameKey="corridorCode" description="Source-currency volume by configured route" />
                <GroupPanel title="Currency exposure" rows={summary.currencyStatistics} nameKey="sourceCurrency" description="Persisted send volume grouped by source currency; values are not combined across currencies" />
              </section>
              <RoutingAnalyticsPanel analytics={routingAnalytics} />
            </>
          )}
        </div>
      </main>
    </>
  );
}

function TransferDetail({ detail }) {
  const { transfer, routing, routingDecision, lifecycle } = detail;
  return (
    <article className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="border-b border-slate-100 px-5 py-4"><div className="flex items-center justify-between gap-2"><h2 className="font-extrabold text-ink">Transfer investigation</h2><Status status={transfer.status} /></div><p className="mt-2 break-all font-mono text-[11px] text-slate-500">{transfer.uetr}</p></div>
      <div className="space-y-5 p-5">
        <dl className="grid grid-cols-2 gap-3 text-xs">
          <Field label="Customer KYC" value={transfer.user.kycStatus} />
          <Field label="Recipient" value={`${transfer.beneficiary.fullName} · ${transfer.beneficiary.country}`} />
          <Field label="Amount" value={`${formatAmount(transfer.sendAmount)} ${transfer.sourceCurrency}`} />
          <Field label="Payout" value={`${formatAmount(transfer.payoutAmount)} ${transfer.payoutCurrency}`} />
          <Field label="Reference" value={transfer.transaction.reference} />
          <Field label="Routing" value={`${routing.corridorCode} · ${routing.sourceRail || 'route unavailable'} → ${routing.destinationRail || 'route unavailable'}`} />
        </dl>
        {routingDecision?.selectedRoute && <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-950"><p className="font-extrabold">Selected route · {routingDecision.strategyLabel}</p><p className="mt-1 font-bold">{routingDecision.selectedRoute.providerAdapter.label} · {formatAmount(routingDecision.selectedRoute.estimatedFee)} {routingDecision.selectedRoute.feeCurrency} · ~{routingDecision.selectedRoute.estimatedProcessingMinutes} min</p><p className="mt-1 leading-5">{routingDecision.decisionReason}</p><p className="mt-1 text-[10px]">Estimated receiver amount: {routingDecision.selectedRoute.estimatedReceivingAmount || 'unavailable'} {routingDecision.selectedRoute.receivingCurrency}</p></div>}
        {transfer.statusEvents.some(event => ['FAILED', 'REJECTED'].includes(event.toStatus)) && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900"><p className="flex items-center gap-2 font-extrabold"><AlertTriangle size={15} />Failure investigation reason</p>{transfer.statusEvents.filter(event => ['FAILED', 'REJECTED'].includes(event.toStatus)).map(event => <p key={event.id} className="mt-2">{event.reason} · {event.actorType} · {new Date(event.createdAt).toLocaleString()}</p>)}</div>}
        <div><h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">Lifecycle timeline</h3>{lifecycle?.presentation && <p className="mt-2 text-xs text-slate-600">{lifecycle.presentation.label}: {lifecycle.presentation.description}</p>}<ol className="mt-3 space-y-3">{(lifecycle?.timeline || transfer.statusEvents.map(event => ({ eventType: 'STATUS_TRANSITION', fromStatus: event.fromStatus, toStatus: event.toStatus, description: event.reason, source: event.actorType, timestamp: event.createdAt?.toString() }))).map((event, index) => <li key={`${event.eventType}-${event.sequenceOrder ?? index}`} className="flex gap-3 text-xs"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-600" /><div><p className="font-bold text-ink">{event.fromStatus ? `${event.fromStatus} → ${event.toStatus}` : event.eventType.replaceAll('_', ' ')}</p><p className="mt-0.5 leading-5 text-slate-600">{event.description}</p><p className="mt-1 break-all text-[10px] text-slate-400">{event.source} · {event.correlationId || 'no correlation ID'} · {event.timestamp ? new Date(event.timestamp).toLocaleString() : 'time unavailable'}</p></div></li>)}</ol></div>
        <div><h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">Payment message audit</h3>{transfer.transaction.isoAuditLogs.length ? <ul className="mt-2 space-y-2">{transfer.transaction.isoAuditLogs.map(event => <li key={event.messageId} className="rounded-lg bg-slate-50 px-3 py-2 text-xs"><span className="font-bold text-ink">{event.messageType} · {event.status}</span><span className="mt-1 block break-all font-mono text-[10px] text-slate-500">{event.messageId}</span></li>)}</ul> : <p className="mt-2 text-xs text-slate-500">No ISO message audit events recorded.</p>}</div>
        <div><h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">Callback inbox</h3>{transfer.transaction.callbackInbox.length ? <ul className="mt-2 space-y-2">{transfer.transaction.callbackInbox.map(event => <li key={`${event.source}-${event.messageId}`} className="rounded-lg bg-slate-50 px-3 py-2 text-xs"><span className="font-bold text-ink">{event.source} · {event.processingStatus} · {event.transactionStatus}</span>{event.processingError && <p className="mt-1 text-rose-700">{event.processingError}</p>}<span className="mt-1 block text-[10px] text-slate-400">{new Date(event.receivedAt).toLocaleString()}</span></li>)}</ul> : <p className="mt-2 text-xs text-slate-500">No callback events recorded.</p>}</div>
        <p className="border-t border-slate-100 pt-3 text-[10px] leading-4 text-slate-500">Recipient bank account details and raw payment XML are intentionally excluded from this operations view.</p>
      </div>
    </article>
  );
}

function RoutingAnalyticsPanel({ analytics }) {
  if (!analytics) return <div className="rounded-2xl bg-white p-5 text-sm text-slate-500 ring-1 ring-slate-200">Routing analytics are unavailable.</div>;
  return (
    <section className="space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end"><div><p className="text-[10px] font-extrabold uppercase tracking-wider text-blue-800">Routing analytics · simulated</p><h2 className="mt-1 text-xl font-extrabold text-ink">Provider route performance</h2><p className="mt-1 text-xs text-slate-500">Decisions reconstructed from recorded transfer timelines; performance and liquidity are not real partner observations.</p></div><span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{analytics.sampleSize} recorded decisions</span></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{(analytics.providers || []).map(provider => <article key={provider.id} className="rounded-xl border border-slate-200 p-4"><div className="flex items-start justify-between gap-2"><div><p className="text-sm font-extrabold text-ink">{provider.label}</p><p className="mt-1 text-[10px] text-slate-500">{provider.id} · {provider.mode}</p></div><span className={`rounded-full px-2 py-1 text-[9px] font-extrabold ${provider.availability === 'AVAILABLE' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>{provider.availability}</span></div><p className="mt-3 text-xs text-slate-600">{provider.estimatedMinutes} min estimate · risk {provider.riskScore}/100 · fee {provider.feeBasisPoints} bps</p><p className="mt-1 text-[10px] text-amber-800">{analytics.providerSelections?.find(row => row.providerId === provider.id)?.count || 0} selections in recorded sample · capacity simulated</p></article>)}</div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl bg-slate-50 p-4"><h3 className="text-sm font-extrabold text-ink">Recorded corridor selection counts</h3>{analytics.corridorPerformance?.length ? <ul className="mt-3 space-y-2">{analytics.corridorPerformance.map(row => <li key={row.corridorCode} className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-bold text-slate-700">{row.corridorCode} · {row.count} decisions</span><span className="text-slate-500">{Object.entries(row.selectedProviders).map(([id, count]) => `${id}: ${count}`).join(' · ')}</span></li>)}</ul> : <p className="mt-2 text-xs text-slate-500">No persisted route decisions yet.</p>}</div>
        <div className="rounded-xl bg-slate-50 p-4"><h3 className="text-sm font-extrabold text-ink">Route rejection reasons</h3>{analytics.routeRejections?.length ? <ul className="mt-3 space-y-2">{analytics.routeRejections.slice(0, 5).map((row, index) => <li key={`${row.providerId}-${row.reason}-${index}`} className="flex justify-between gap-3 text-xs"><span className="text-slate-600">{row.providerId} · {row.reason}</span><span className="font-bold text-slate-700">{row.count}</span></li>)}</ul> : <p className="mt-2 text-xs text-slate-500">No provider routes have been rejected in the recorded sample.</p>}</div>
      </div>
      <div><h3 className="text-sm font-extrabold text-ink">Recent route comparisons</h3>{analytics.recentDecisions?.length ? <div className="mt-3 grid gap-3 xl:grid-cols-2">{analytics.recentDecisions.slice(0, 8).map(decision => <article key={decision.transferId} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-mono text-[10px] text-slate-500">{decision.uetr}</p><span className="rounded-full bg-blue-50 px-2 py-1 text-[9px] font-extrabold text-blue-800">{decision.strategy}</span></div>{decision.selectedRoute ? <><p className="mt-2 text-sm font-extrabold text-ink">Selected: {decision.selectedRoute.providerAdapter.label}</p><p className="mt-1 text-xs text-slate-600">{decision.selectedRoute.estimatedFee} {decision.selectedRoute.feeCurrency} · {decision.selectedRoute.estimatedProcessingMinutes} min · risk {decision.selectedRoute.riskScore}/100</p><p className="mt-2 text-[10px] leading-4 text-slate-500">{decision.decisionReason}</p>{decision.alternatives?.length > 0 && <p className="mt-2 text-[10px] text-slate-600">Alternatives: {decision.alternatives.map(route => `${route.providerAdapter.label} (${route.estimatedFee} ${route.feeCurrency}, ${route.estimatedProcessingMinutes} min; score ${route.score})`).join(' · ')}</p>}</> : <p className="mt-2 text-xs text-amber-800">{decision.decisionReason}</p>}</article>)}</div> : <p className="mt-2 text-xs text-slate-500">Routing comparisons will appear as transfers are created.</p>}</div>
      <p className="border-t border-slate-100 pt-3 text-[10px] leading-4 text-slate-500">Fee, FX, provider availability, risk and processing time are simulated estimates. They are not actual partner performance, executed route choices or real liquidity. No route changes customer pricing or ledger postings.</p>
    </section>
  );
}

function Metric({ label, value, tone = 'slate' }) {
  const colors = { slate: 'text-ink', green: 'text-emerald-800', amber: 'text-amber-800', rose: 'text-rose-800', blue: 'text-blue-800' };
  return <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200"><p className="text-xs font-semibold text-slate-500">{label}</p><p className={`mt-2 text-2xl font-extrabold tabular-nums ${colors[tone]}`}>{value}</p></div>;
}

function GroupPanel({ title, description, rows, nameKey }) {
  return <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200"><h2 className="font-extrabold text-ink">{title}</h2><p className="mt-1 text-xs text-slate-500">{description}</p>{rows.length ? <ul className="mt-4 divide-y divide-slate-100">{rows.map(row => <li key={row[nameKey]} className="flex items-center justify-between gap-4 py-3 text-sm"><div><p className="font-bold text-ink">{row[nameKey]}</p><p className="mt-1 text-xs text-slate-500">{row.count} transfers · fees {formatAmount(row.feeAmount)}</p></div><p className="text-right font-mono text-xs text-slate-700">{formatAmount(row.sendAmount)}</p></li>)}</ul> : <Empty title="No grouped data" detail="There are no persisted transfers to summarize." />}</section>;
}

function ActivityPanel({ title, events = [] }) {
  return <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200"><h2 className="font-extrabold text-ink">{title}</h2>{events.length ? <ol className="mt-4 space-y-3">{events.map(event => <li key={event.id} className="flex gap-3 text-xs"><Clock3 className="mt-0.5 shrink-0 text-slate-400" size={14} /><div className="min-w-0"><p className="font-bold text-ink">{event.fromStatus || 'NEW'} → {event.toStatus} · {event.corridor}</p><p className="mt-1 break-all font-mono text-[10px] text-slate-500">{event.reference}</p><p className="mt-1 text-slate-500">{event.reason}</p></div></li>)}</ol> : <p className="mt-4 text-sm text-slate-500">No lifecycle activity recorded yet.</p>}</section>;
}

function Field({ label, value }) {
  return <div><dt className="text-slate-400">{label}</dt><dd className="mt-1 break-words font-bold text-slate-700">{value}</dd></div>;
}

function Status({ status }) {
  const tone = ['FAILED', 'REJECTED'].includes(status) ? 'bg-rose-50 text-rose-800' : status === 'SIMULATED' ? 'bg-blue-50 text-blue-800' : ['SETTLED', 'ACCEPTED'].includes(status) ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800';
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-extrabold ${tone}`}>{status}</span>;
}

function Empty({ title, detail }) {
  return <div className="px-5 py-9 text-center"><ArrowLeftRight className="mx-auto text-slate-300" size={23} /><p className="mt-2 text-sm font-bold text-ink">{title}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div>;
}

function formatAmount(value) {
  const [whole = '0', fraction] = String(value ?? '0').split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction ? `.${fraction}` : ''}`;
}

function Loading() {
  return <div className="grid min-h-40 place-items-center text-sm font-semibold text-slate-500"><span className="flex items-center gap-2"><RefreshCw size={16} className="animate-spin" />Loading operations data…</span></div>;
}

function AccessDenied() {
  return <main className="grid min-h-screen place-items-center bg-canvas px-5"><section className="w-full max-w-lg rounded-3xl bg-white p-8 text-center shadow-card ring-1 ring-slate-200"><Brand /><span className="mx-auto mt-7 grid h-12 w-12 place-items-center rounded-xl bg-amber-50 text-amber-800"><ShieldCheck size={23} /></span><h1 className="mt-4 text-2xl font-extrabold text-ink">Treasury staff access required</h1><p className="mt-2 text-sm leading-6 text-slate-600">Transfer monitoring is restricted to staff with a treasury role. Staff identity is managed by the configured external provider.</p><Link href="/" className="mt-6 inline-flex rounded-xl bg-ink px-5 py-3 text-sm font-bold text-white">Return to home</Link></section></main>;
}
