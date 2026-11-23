import Head from 'next/head';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Search } from 'lucide-react';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';
import { ConsumerLayout } from '../components/ConsumerLayout.jsx';
import { useConsumerSession } from '../components/useConsumerSession.js';
import { getTransfers } from '../services/api.js';

const statuses = [
  'INITIATED', 'VALIDATING', 'QUOTED', 'FUNDS_DEBITED', 'SUBMITTED',
  'ACCEPTED', 'SETTLED', 'FAILED', 'REJECTED', 'RETURNED',
  'CANCELLED', 'SIMULATED', 'REVERSED',
];

function exactMoney(value, currency) {
  const [whole = '0', fraction] = String(value ?? '0').split('.');
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${currency} ${groupedWhole}${fraction ? `.${fraction}` : ''}`;
}

function shortDate(value) {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function statusPresentation(status) {
  const failed = ['FAILED', 'REJECTED', 'REQUIRES_REVIEW'].includes(status);
  const processing = ['INITIATED', 'VALIDATING', 'QUOTED', 'FUNDS_DEBITED', 'SUBMITTED', 'ACCEPTED'].includes(status);
  if (failed) return { label: status === 'REQUIRES_REVIEW' ? 'Needs review' : 'Failed or rejected', className: 'bg-rose-50 text-rose-800' };
  if (processing) return { label: status.replaceAll('_', ' ').toLowerCase(), className: 'bg-blue-50 text-blue-800' };
  if (status === 'CANCELLED') return { label: 'Cancelled', className: 'bg-slate-100 text-slate-700' };
  return {
    label: status === 'SIMULATED' ? 'Demo complete' : status.replaceAll('_', ' ').toLowerCase(),
    className: 'bg-emerald-50 text-emerald-800',
  };
}

export default function TransfersPage() {
  const router = useRouter();
  const { session, ready } = useConsumerSession();
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [appliedFrom, setAppliedFrom] = useState('');
  const [appliedTo, setAppliedTo] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadTransfers = useCallback(async () => {
    setLoading(true);
    try {
      setResult(await getTransfers({ page, status, query: appliedQuery, from: appliedFrom, to: appliedTo }));
      setError('');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [page, status, appliedQuery, appliedFrom, appliedTo]);

  useEffect(() => {
    if (ready && !session) router.replace('/login');
    if (ready && session) loadTransfers();
  }, [ready, session, router, loadTransfers]);

  const applyFilters = event => {
    event.preventDefault();
    setPage(1);
    setAppliedQuery(query);
    setAppliedFrom(from ? new Date(`${from}T00:00:00`).toISOString() : '');
    setAppliedTo(to ? new Date(`${to}T23:59:59`).toISOString() : '');
  };

  if (!ready || !session) {
    return <main className="grid min-h-screen place-items-center text-sm font-semibold text-slate-500">Loading your activity…</main>;
  }

  const transfers = result?.transfers || [];
  const pagination = result?.pagination;

  return (
    <>
      <Head><title>Transfer activity · KitePay</title></Head>
      <ConsumerLayout active="Activity">
        <div className="mx-auto max-w-6xl space-y-6">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-ink"><ArrowLeft size={16} />Wallet overview</Link>
              <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-ink">Transfer activity</h1>
              <p className="mt-2 text-sm text-slate-500">Review your recorded transfer history and status.</p>
            </div>
            <Link href="/send" className="inline-flex items-center justify-center gap-2 rounded-xl bg-ink px-4 py-3 text-sm font-bold text-white hover:bg-slate-700">Create a demo transfer<ArrowRight size={16} /></Link>
          </div>

          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
            Demonstration records only. A simulated status is not evidence that funds were sent or settled by a bank.
          </p>

          <form onSubmit={applyFilters} className="grid gap-3 rounded-2xl bg-white p-4 shadow-card ring-1 ring-slate-200 sm:grid-cols-[1fr_180px_150px_150px_auto]">
            <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 focus-within:ring-2 focus-within:ring-emerald-600/20">
              <Search size={17} className="text-slate-400" />
              <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search reference or recipient" className="min-w-0 flex-1 py-3 text-sm outline-none" aria-label="Search transfer reference or recipient" />
            </label>
            <label className="sr-only" htmlFor="transfer-status">Filter by status</label>
            <select id="transfer-status" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }} className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-700">
              <option value="">All statuses</option>
              {statuses.map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
            </select>
            <label className="sr-only" htmlFor="transfer-from">Created from date</label>
            <input id="transfer-from" type="date" value={from} onChange={event => setFrom(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-3 text-sm" />
            <label className="sr-only" htmlFor="transfer-to">Created to date</label>
            <input id="transfer-to" type="date" value={to} onChange={event => setTo(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-3 text-sm" />
            <button type="submit" className="rounded-xl bg-ink px-5 py-3 text-sm font-bold text-white hover:bg-slate-700">Search</button>
          </form>

          {error && <div role="alert" className="flex items-center justify-between gap-3 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700"><span>{error}</span><button type="button" onClick={loadTransfers} className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-800">Retry</button></div>}

          <section className="overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-slate-200">
            {loading ? <p className="p-8 text-center text-sm font-semibold text-slate-500" role="status">Loading transfers…</p>
              : transfers.length === 0 ? <div className="p-10 text-center"><h2 className="font-extrabold text-ink">No transfers found</h2><p className="mt-2 text-sm text-slate-500">Try another search or start a simulated transfer.</p></div>
                : <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-4">Recipient</th><th className="px-5 py-4">Sent</th><th className="px-5 py-4">Recipient gets</th><th className="px-5 py-4">Status</th><th className="px-5 py-4">Created</th><th className="px-5 py-4"><span className="sr-only">Details</span></th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {transfers.map(transfer => <tr key={transfer.id} className="hover:bg-slate-50/70">
                        <td className="px-5 py-4"><p className="font-bold text-ink">{transfer.beneficiary.fullName}</p><p className="mt-1 text-xs text-slate-500">{transfer.beneficiary.bankName} · {transfer.beneficiary.country}</p><p className="mt-1 font-mono text-[10px] text-slate-400">{transfer.uetr}</p></td>
                        <td className="whitespace-nowrap px-5 py-4 font-bold text-ink">{exactMoney(transfer.sendAmount, transfer.sourceCurrency)}<p className="mt-1 text-xs font-medium text-slate-500">Fee {exactMoney(transfer.feeAmount, transfer.sourceCurrency)}</p></td>
                        <td className="whitespace-nowrap px-5 py-4 font-bold text-ink">{exactMoney(transfer.payoutAmount, transfer.payoutCurrency)}<p className="mt-1 text-xs font-medium text-slate-500">Rate {String(transfer.exchangeRate)}</p></td>
                        <td className="px-5 py-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-extrabold ${statusPresentation(transfer.status).className}`}>{statusPresentation(transfer.status).label}</span></td>
                        <td className="whitespace-nowrap px-5 py-4 text-xs text-slate-600">{shortDate(transfer.createdAt)}</td>
                        <td className="px-5 py-4"><Link className="font-bold text-emerald-800 hover:underline" href={`/transfer/${encodeURIComponent(transfer.id)}`}>Details</Link></td>
                      </tr>)}
                    </tbody>
                  </table>
                </div>}
            <div className="flex items-center justify-between border-t border-slate-100 px-5 py-4 text-xs text-slate-500">
              <span>{pagination ? `${pagination.total} transfer${pagination.total === 1 ? '' : 's'}${result?.summary?.isFiltered ? ' matching filters' : ''}` : ' '}</span>
              <div className="flex items-center gap-3">
                <button type="button" disabled={page <= 1 || loading} onClick={() => setPage(current => current - 1)} className="rounded-lg border border-slate-200 px-3 py-2 font-bold disabled:opacity-40">Previous</button>
                <span>{pagination ? `${pagination.page} / ${Math.max(1, pagination.totalPages)}` : '—'}</span>
                <button type="button" disabled={!pagination || page >= pagination.totalPages || loading} onClick={() => setPage(current => current + 1)} className="rounded-lg border border-slate-200 px-3 py-2 font-bold disabled:opacity-40">Next</button>
              </div>
            </div>
          </section>
        </div>
      </ConsumerLayout>
    </>
  );
}
