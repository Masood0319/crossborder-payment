import Head from 'next/head';
import Link from 'next/link';
import {
  ArrowUpRight, CircleAlert, CircleCheck, Clock3, Landmark, LogOut, RefreshCw, ShieldCheck,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Brand } from '../components/PublicSite.jsx';
import {
  acknowledgeTreasuryAlert, clearStaffSession, getStaffSession, getTreasuryLiquidityAlerts,
} from '../services/api.js';

const viewerRoles = ['TREASURY_VIEWER', 'TREASURY_OPERATOR', 'TREASURY_ADMIN'];
const operatorRoles = ['TREASURY_OPERATOR', 'TREASURY_ADMIN'];

export default function TreasuryPage() {
  const [staffSession, setStaffSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [balances, setBalances] = useState([]);
  const [corridors, setCorridors] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acknowledgingId, setAcknowledgingId] = useState('');
  const [notice, setNotice] = useState('');

  const roles = staffSession?.user?.roles || [];
  const canView = roles.some(role => viewerRoles.includes(role));
  const canAcknowledge = roles.some(role => operatorRoles.includes(role));
  const activeAlerts = useMemo(() => alerts.filter(alert => !alert.acknowledged), [alerts]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError('');
    try {
      const result = await getTreasuryLiquidityAlerts();
      setAlerts(result.alerts || []);
      setBalances(result.balances || []);
      setCorridors(result.corridors || []);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    setStaffSession(getStaffSession());
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready && canView) refresh();
    else if (ready) setLoading(false);
  }, [ready, canView, refresh]);

  const acknowledge = async alert => {
    setAcknowledgingId(alert.alertId);
    setError('');
    setNotice('');
    try {
      await acknowledgeTreasuryAlert(alert.alertId);
      setAlerts(current => current.map(item => (
        item.alertId === alert.alertId ? { ...item, acknowledged: true } : item
      )));
      setNotice('Alert acknowledgement recorded. No funds were moved.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setAcknowledgingId('');
    }
  };

  const signOut = () => {
    clearStaffSession();
    window.location.assign('/login');
  };

  if (!ready) return <Loading />;

  if (!staffSession || !canView) {
    return (
      <>
        <Head><title>Treasury access · KitePay</title></Head>
        <main className="grid min-h-screen place-items-center bg-canvas px-5 py-12">
          <section className="w-full max-w-lg rounded-3xl bg-white p-7 text-center shadow-card ring-1 ring-slate-200 sm:p-10">
            <Brand />
            <span className="mx-auto mt-8 grid h-14 w-14 place-items-center rounded-2xl bg-amber-50 text-amber-800"><ShieldCheck size={25} /></span>
            <h1 className="mt-5 text-2xl font-extrabold tracking-tight text-ink">Treasury staff access required</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">This operational dashboard is restricted to authenticated staff with a treasury role. Staff sign-in is managed by the configured external identity provider; this demo does not create staff credentials.</p>
            <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href="/login" className="rounded-xl bg-ink px-5 py-3 text-sm font-bold text-white hover:bg-slate-700">Consumer sign in</Link>
              <Link href="/" className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-ink hover:bg-slate-50">Return to home</Link>
            </div>
          </section>
        </main>
      </>
    );
  }

  const staffName = staffSession.user.reviewerId || staffSession.user.name || 'Treasury staff';

  return (
    <>
      <Head>
        <title>Treasury operations · KitePay</title>
        <meta name="description" content="Role-protected treasury liquidity monitoring and alert acknowledgement for the KitePay prototype." />
      </Head>
      <div className="min-h-screen bg-canvas">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
            <div className="flex items-center gap-4"><Brand /><span className="hidden h-7 border-l border-slate-200 sm:block" /><span className="hidden text-sm font-bold text-slate-500 sm:block">Treasury operations</span></div>
            <div className="flex items-center gap-3">
              <span className="hidden text-right sm:block"><span className="block text-xs font-bold text-ink">{staffName}</span><span className="block text-[10px] font-semibold text-slate-500">{roles.filter(role => viewerRoles.includes(role)).join(' · ')}</span></span>
              <button type="button" onClick={signOut} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"><LogOut size={15} />Sign out</button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl space-y-7 px-5 py-7 sm:px-8 sm:py-10">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[.15em] text-blue-800">Treasury management</p>
              <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-ink">Liquidity overview</h1>
              <p className="mt-2 text-sm text-slate-500">Review configured nostro pools and record operational alert acknowledgements.</p>
            </div>
            <button type="button" onClick={refresh} disabled={refreshing} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
              <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />{refreshing ? 'Refreshing…' : 'Refresh overview'}
            </button>
          </div>

          <div role="note" className="flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-4 text-sm leading-6 text-blue-950">
            <ShieldCheck className="mt-0.5 shrink-0 text-blue-800" size={18} />
            <p><strong>Prototype controls:</strong> alert recommendations are informational only. Acknowledging an alert records an audit event; it does not initiate a rebalance, injection, sweep or bank instruction.</p>
          </div>
          {error && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</p>}
          {notice && <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">{notice}</p>}

          {loading ? <Loading /> : (
            <>
              <section className="grid gap-4 sm:grid-cols-3" aria-label="Treasury summary">
                <SummaryCard icon={Landmark} label="Configured pools" value={balances.length} detail="Nostro balance records" />
                <SummaryCard icon={CircleAlert} label="Open liquidity alerts" value={activeAlerts.length} detail="Based on current configured thresholds" tone={activeAlerts.length ? 'amber' : 'green'} />
                <SummaryCard icon={CircleCheck} label="Acknowledged this view" value={alerts.length - activeAlerts.length} detail="Audit record only; no funds moved" tone="blue" />
              </section>

              <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
                <div className="flex flex-col justify-between gap-2 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:px-6">
                  <div><h2 className="text-base font-extrabold text-ink">Configured FX corridors</h2><p className="mt-1 text-xs text-slate-500">Prototype settings and reference rates; not live market pricing.</p></div>
                  <span className="w-fit rounded-full bg-blue-50 px-3 py-1 text-[10px] font-extrabold text-blue-800">STATIC DEMO FEED</span>
                </div>
                {corridors.length ? (
                  <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-4">
                    {corridors.map(corridor => (
                      <article key={corridor.code} className="rounded-xl border border-slate-200 p-4">
                        <div className="flex items-start justify-between gap-2"><div><p className="text-xs font-extrabold text-slate-500">{corridor.code}</p><h3 className="mt-1 text-sm font-extrabold text-ink">{corridor.sourceCurrency} <span className="text-slate-400">→</span> {corridor.targetCurrency}</h3></div><span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-extrabold text-slate-600">CONFIGURED</span></div>
                        <p className="mt-5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Reference mid-market rate</p>
                        <p className="mt-1 font-mono text-lg font-bold tabular-nums text-ink">{formatRate(corridor.midMarketRate) || 'Unavailable'}</p>
                        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
                          <div><p className="text-[10px] font-semibold text-slate-400">Base spread</p><p className="mt-1 text-xs font-bold text-slate-700">{corridor.baseSpreadBps} bps</p></div>
                          <div><p className="text-[10px] font-semibold text-slate-400">Volatility buffer</p><p className="mt-1 text-xs font-bold text-slate-700">{corridor.volatilityBufferBps} bps</p></div>
                          <div><p className="text-[10px] font-semibold text-slate-400">Quote lifetime</p><p className="mt-1 text-xs font-bold text-slate-700">{corridor.quoteTtlSeconds}s</p></div>
                        </div>
                        <p className="mt-3 text-[10px] leading-4 text-slate-400">Observed {corridor.rateObservedAt ? new Date(corridor.rateObservedAt).toLocaleString() : 'time unavailable'}. Static illustrative rate, not a live quote.</p>
                      </article>
                    ))}
                  </div>
                ) : <EmptyState title="No FX corridor configuration" detail="No corridor reference data is currently available." />}
              </section>

              <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-6">
                  <div><h2 className="text-base font-extrabold text-ink">Nostro liquidity pools</h2><p className="mt-1 text-xs text-slate-500">Balances and thresholds from configured records</p></div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{balances.length} pools</span>
                </div>
                {balances.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-left text-sm">
                      <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3 font-bold sm:px-6">Bank / pool</th><th className="px-4 py-3 font-bold">Currency</th><th className="px-4 py-3 text-right font-bold">Current</th><th className="px-4 py-3 text-right font-bold">Reserved</th><th className="px-4 py-3 text-right font-bold">Available</th><th className="px-5 py-3 text-right font-bold sm:px-6">Threshold range</th></tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {balances.map((pool, index) => (
                          <tr key={`${pool.bankCode}-${pool.currency}-${index}`}>
                            <td className="px-5 py-4 sm:px-6"><span className="block font-bold text-ink">{pool.bankName}</span><span className="mt-1 block text-xs text-slate-500">{pool.bankCode}</span></td>
                            <td className="px-4 py-4 font-bold text-slate-700">{pool.currency}</td>
                            <td className="px-4 py-4 text-right tabular-nums text-slate-700">{formatAmount(pool.currentBalance, pool.currency)}</td>
                            <td className="px-4 py-4 text-right tabular-nums text-slate-700">{formatAmount(pool.reservedBalance, pool.currency)}</td>
                            <td className="px-4 py-4 text-right tabular-nums font-bold text-ink">{formatAmount(pool.availableBalance, pool.currency)}</td>
                            <td className="px-5 py-4 text-right tabular-nums text-slate-600 sm:px-6">{formatAmount(pool.minimumThreshold, pool.currency)} – {formatAmount(pool.maximumThreshold, pool.currency)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <EmptyState title="No liquidity pools configured" detail="No nostro balance records are currently available to this dashboard." />}
              </section>

              <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-6">
                  <div><h2 className="text-base font-extrabold text-ink">Liquidity alerts</h2><p className="mt-1 text-xs text-slate-500">Recommendations are calculated from available balance and configured limits.</p></div>
                  <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-900">{alerts.length} alerts</span>
                </div>
                {alerts.length ? (
                  <div className="divide-y divide-slate-100">
                    {alerts.map(alert => (
                      <article key={alert.alertId} className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
                        <div className="flex min-w-0 gap-3">
                          <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ${alert.acknowledged ? 'bg-emerald-50 text-emerald-700' : alert.thresholdType === 'CRITICAL_DEPLETION' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-800'}`}>
                            {alert.acknowledged ? <CircleCheck size={18} /> : <CircleAlert size={18} />}
                          </span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2"><h3 className="font-extrabold text-ink">{alert.bankName} · {alert.currency}</h3><span className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold ${alert.acknowledged ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}>{alert.acknowledged ? 'ACKNOWLEDGED' : alert.thresholdType.replaceAll('_', ' ')}</span></div>
                            <p className="mt-2 text-sm leading-6 text-slate-600">{alert.recommendedAction}</p>
                            <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400"><Clock3 size={13} />{new Date(alert.timestamp).toLocaleString()}</p>
                          </div>
                        </div>
                        {canAcknowledge && !alert.acknowledged && (
                          <button type="button" onClick={() => acknowledge(alert)} disabled={acknowledgingId === alert.alertId} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-60">
                            <CircleCheck size={15} />{acknowledgingId === alert.alertId ? 'Recording…' : 'Acknowledge'}
                          </button>
                        )}
                      </article>
                    ))}
                  </div>
                ) : <EmptyState title="No active liquidity alerts" detail="Current pool balances are within their configured alert thresholds." />}
              </section>
              <p className="flex items-start gap-2 text-xs leading-5 text-slate-500"><ShieldCheck className="mt-0.5 shrink-0" size={14} />Access is enforced by the staff identity provider and API role checks. This view contains operational demo data, not instructions to move funds. <Link href="/" className="inline-flex shrink-0 items-center gap-1 font-bold text-blue-800 hover:text-blue-950">Public site <ArrowUpRight size={12} /></Link></p>
            </>
          )}
        </main>
      </div>
    </>
  );
}

function SummaryCard({ icon: Icon, label, value, detail, tone = 'blue' }) {
  const styles = {
    blue: 'bg-blue-50 text-blue-800',
    amber: 'bg-amber-50 text-amber-800',
    green: 'bg-emerald-50 text-emerald-800',
  };
  return <div className="flex items-center gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200"><span className={`grid h-11 w-11 place-items-center rounded-xl ${styles[tone]}`}><Icon size={20} /></span><div><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-1 text-2xl font-extrabold tabular-nums text-ink">{value}</p><p className="mt-1 text-[11px] text-slate-400">{detail}</p></div></div>;
}

function EmptyState({ title, detail }) {
  return <div className="px-5 py-10 text-center sm:px-6"><p className="text-sm font-bold text-ink">{title}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div>;
}

function formatAmount(value, currency) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `${value} ${currency}`;
  return new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}

function formatRate(value) {
  const rate = Number(value);
  return Number.isFinite(rate) ? rate.toFixed(6) : '';
}

function Loading() {
  return <main className="grid min-h-screen place-items-center bg-canvas text-sm font-semibold text-slate-500"><span className="flex items-center gap-2"><RefreshCw size={16} className="animate-spin" />Loading treasury workspace…</span></main>;
}
