import Head from 'next/head';
import Link from 'next/link';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Clock3, CreditCard, Globe2, Plus, RefreshCw, Send, ShieldCheck, WalletCards } from 'lucide-react';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConsumerLayout } from '../components/ConsumerLayout.jsx';
import { useConsumerSession } from '../components/useConsumerSession.js';
import { getWallet, topUpWallet } from '../services/api.js';

const currencyFormat = (value, currency) => new Intl.NumberFormat('en-PK', {
  style: 'currency',
  currency,
  maximumFractionDigits: 2,
}).format(Number(value));

export default function DashboardPage() {
  const router = useRouter();
  const { session, ready } = useConsumerSession();
  const [walletData, setWalletData] = useState(null);
  const [error, setError] = useState('');
  const [topUpAmount, setTopUpAmount] = useState('5000');
  const [topUpBusy, setTopUpBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const topUpIdempotencyKey = useRef(null);

  const refreshWallet = useCallback(async () => {
    try {
      setWalletData(await getWallet());
      setError('');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready && !session) router.replace('/login');
    if (ready && session) refreshWallet();
  }, [ready, session, router, refreshWallet]);

  const wallet = useMemo(
    () => walletData?.wallets?.find(item => item.currency === 'PKR') || walletData?.wallets?.[0],
    [walletData]
  );

  const topUp = async event => {
    event.preventDefault();
    setTopUpBusy(true);
    setError('');
    try {
      topUpIdempotencyKey.current ||= crypto.randomUUID();
      await topUpWallet(Number(topUpAmount), wallet?.currency || 'PKR', topUpIdempotencyKey.current);
      topUpIdempotencyKey.current = null;
      await refreshWallet();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setTopUpBusy(false);
    }
  };

  if (!ready || !session || loading) return <Loading />;

  const activities = walletData?.activities || [];

  return (
    <>
      <Head><title>Your wallet · KitePay</title><meta name="description" content="Wallet balance and recent cross-border transfers." /></Head>
      <ConsumerLayout active="Overview">
        <div className="space-y-7">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div><p className="text-sm font-semibold text-slate-500">{new Date().toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long' })}</p><h1 className="mt-1 text-3xl font-extrabold tracking-tight text-ink">Good to see you, {session.user.fullName?.split(' ')[0] || 'there'} <span aria-hidden="true">👋</span></h1><p className="mt-2 text-sm text-slate-500">Here’s what’s happening with your wallet.</p></div>
            <div className="flex gap-2"><button type="button" onClick={refreshWallet} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"><RefreshCw size={16} />Refresh</button><Link href="/send" className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-3 text-sm font-bold text-white hover:bg-slate-700"><Send size={16} />Send money</Link></div>
          </div>

          {error && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</p>}
          <section className="grid gap-5 lg:grid-cols-[1.4fr_.8fr]">
            <div className="relative overflow-hidden rounded-3xl bg-ink p-6 text-white shadow-card sm:p-8">
              <div className="relative z-10 flex items-start justify-between">
                <div><p className="text-sm font-semibold text-slate-300">Available balance</p><p className="mt-3 text-4xl font-extrabold tracking-tight sm:text-5xl">{currencyFormat(wallet?.balance || 0, wallet?.currency || 'PKR')}</p><p className="mt-2 text-xs font-medium text-slate-400">Your Pakistan wallet · {wallet?.currency || 'PKR'}</p></div>
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/10 text-mint"><WalletCards size={22} /></span>
              </div>
              <div className="relative z-10 mt-8 flex flex-wrap gap-3">
                <a href="#top-up" className="inline-flex items-center gap-2 rounded-xl bg-mint px-4 py-3 text-sm font-extrabold text-ink hover:bg-white"><Plus size={17} />Top up</a>
                <Link href="/send" className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-sm font-bold text-white hover:bg-white/10"><ArrowUpRight size={17} />Send money</Link>
              </div>
              <div className="absolute -right-16 -top-28 h-80 w-80 rounded-full border border-white/10" /><div className="absolute -right-4 -top-20 h-64 w-64 rounded-full border border-white/10" />
            </div>
            <div id="top-up" className="rounded-3xl bg-white p-6 shadow-card ring-1 ring-slate-200 sm:p-7">
              <div className="flex items-start justify-between"><div><p className="text-xs font-extrabold uppercase tracking-[.14em] text-emerald-700">Quick top up</p><h2 className="mt-2 text-xl font-extrabold text-ink">Add money to your wallet</h2></div><span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-800"><CreditCard size={19} /></span></div>
              <form className="mt-5" onSubmit={topUp}><label className="block text-xs font-bold text-slate-600">Amount in {wallet?.currency || 'PKR'}<div className="mt-1.5 flex items-center rounded-xl border border-slate-200 px-3 focus-within:border-emerald-600 focus-within:ring-4 focus-within:ring-emerald-600/10"><span className="text-sm font-bold text-slate-400">{wallet?.currency || 'PKR'}</span><input type="number" min="1" step="0.01" required value={topUpAmount} onChange={event => setTopUpAmount(event.target.value)} className="w-full border-0 bg-transparent px-3 py-3 text-lg font-extrabold text-ink outline-none" /></div></label><button disabled={topUpBusy} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm font-extrabold text-ink hover:bg-slate-50 disabled:opacity-60">{topUpBusy ? 'Adding funds…' : 'Simulate bank top up'}<ArrowRight size={16} /></button></form>
              <p className="mt-3 text-[11px] leading-4 text-slate-400">Demo only: records a simulated incoming payment with a balanced ledger entry.</p>
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-3">
            <InfoCard icon={ShieldCheck} title="Identity check" value={walletData?.kycStatus || session.user.kycStatus || 'NOT_SUBMITTED'} detail={walletData?.kycStatus === 'APPROVED' ? 'You’re ready to send' : 'Verify to unlock transfers'} tone={walletData?.kycStatus === 'APPROVED' ? 'green' : 'amber'} href="/kyc" />
            <InfoCard icon={Globe2} title="Sending to" value="UAE & Saudi Arabia" detail="Clear rates before you send" tone="blue" href="/send" />
            <InfoCard icon={Clock3} title="Transfer tracking" value="Demo status timeline" detail="No bank submission or settlement is verified" tone="purple" href="/dashboard#activity" />
          </section>

          <section id="activity" className="overflow-hidden rounded-3xl bg-white shadow-card ring-1 ring-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-5 sm:px-7"><div><h2 className="text-lg font-extrabold text-ink">Recent activity</h2><p className="mt-1 text-xs text-slate-500">Your latest wallet top ups and transfers</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{activities.length} recent</span></div>
            {activities.length ? <div className="divide-y divide-slate-100">{activities.map(activity => <ActivityRow key={activity.id} activity={activity} />)}</div> : <div className="px-6 py-12 text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500"><ArrowDownLeft size={21} /></span><h3 className="mt-4 font-bold text-ink">Your wallet is ready</h3><p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">Add money to your wallet and your recent activity will show up here.</p><a href="#top-up" className="mt-5 inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-bold text-white">Make a top up<ArrowRight size={15} /></a></div>}
          </section>
          <p className="flex items-center justify-center gap-2 text-center text-xs text-slate-400"><ShieldCheck size={14} />Your wallet activity is protected and recorded to your personal ledger.</p>
        </div>
      </ConsumerLayout>
    </>
  );
}

function Loading() {
  return <main className="grid min-h-screen place-items-center text-sm font-semibold text-slate-500"><span className="flex items-center gap-2"><RefreshCw size={16} className="animate-spin" />Loading your wallet…</span></main>;
}

function InfoCard({ icon: Icon, title, value, detail, tone, href }) {
  const colors = { green: 'bg-emerald-50 text-emerald-800', amber: 'bg-amber-50 text-amber-800', blue: 'bg-blue-50 text-blue-800', purple: 'bg-violet-50 text-violet-800' };
  return <Link href={href} className="flex items-start gap-4 rounded-2xl bg-white p-5 shadow-card ring-1 ring-slate-200 hover:ring-emerald-300"><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${colors[tone]}`}><Icon size={19} /></span><span><span className="block text-xs font-semibold text-slate-500">{title}</span><span className="mt-1 block text-sm font-extrabold text-ink">{value}</span><span className="mt-1 block text-xs text-slate-500">{detail}</span></span></Link>;
}

function ActivityRow({ activity }) {
  const isTransfer = activity.kind === 'TRANSFER';
  const details = activity.details || {};
  const badge = activity.status === 'COMPLETED' ? 'bg-emerald-50 text-emerald-800' : activity.status === 'PROCESSING' ? 'bg-blue-50 text-blue-800' : 'bg-amber-50 text-amber-800';
  const statusLabel = activity.status === 'SIMULATED' ? 'DEMO · SIMULATED' : activity.status;
  const date = new Date(activity.createdAt).toLocaleDateString('en', { day: 'numeric', month: 'short' });
  return <div className="flex items-center gap-3 px-5 py-4 sm:gap-4 sm:px-7"><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${isTransfer ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'}`}>{isTransfer ? <ArrowUpRight size={18} /> : <ArrowDownLeft size={18} />}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-extrabold text-ink">{activity.description}</p><p className="mt-1 text-xs text-slate-500">{date} · {activity.reference}</p></div><span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${badge}`}>{statusLabel}</span><div className="text-right"><p className={`whitespace-nowrap text-sm font-extrabold ${isTransfer ? 'text-ink' : 'text-emerald-700'}`}>{isTransfer ? '−' : '+'}{currencyFormat(activity.amount, activity.currency)}</p>{isTransfer && details.payoutAmount && <p className="mt-1 text-[11px] text-slate-500">→ {currencyFormat(details.payoutAmount, details.payoutCurrency)}</p>}</div></div>;
}
