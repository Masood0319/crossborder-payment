import Head from 'next/head';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, BadgeCheck, Check, CircleCheck, Clock3, Copy, ShieldCheck, WalletCards } from 'lucide-react';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { ConsumerLayout } from '../../components/ConsumerLayout.jsx';
import { useConsumerSession } from '../../components/useConsumerSession.js';
import { getTransfer } from '../../services/api.js';

const transferSteps = [
  ['WALLET_DEBITED', 'Wallet debit posted', 'Your wallet debit was recorded in the prototype ledger.'],
  ['SANCTIONS_CLEARED', 'Sanctions cleared', 'The recipient and transfer passed compliance screening.'],
  ['INSTRUCTION_CREATED', 'Payment instruction prepared', 'The ISO 20022 instruction was generated; it was not sent to a bank.'],
  ['FUNDS_RECEIVED', 'External settlement', 'No bank acceptance or settlement has been verified.'],
];

const money = (amount, currency) => new Intl.NumberFormat('en', {
  style: 'currency',
  currency,
  maximumFractionDigits: 2,
}).format(Number(amount));

export default function TransferStatusPage() {
  const router = useRouter();
  const { session, ready } = useConsumerSession();
  const [transfer, setTransfer] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (ready && !session) router.replace('/login');
    if (ready && session && router.isReady && router.query.id) {
      getTransfer(router.query.id)
        .then(result => setTransfer(result.transfer))
        .catch(requestError => setError(requestError.message));
    }
  }, [ready, session, router]);

  if (!ready || !session || (!transfer && !error)) {
    return <main className="grid min-h-screen place-items-center text-sm font-semibold text-slate-500">Loading your transfer…</main>;
  }
  if (error) {
    return <main className="grid min-h-screen place-items-center px-5"><div className="max-w-md rounded-2xl bg-white p-7 text-center shadow-card"><p className="font-bold text-rose-700">{error}</p><Link href="/dashboard" className="mt-5 inline-flex rounded-xl bg-ink px-4 py-3 text-sm font-bold text-white">Back to wallet</Link></div></main>;
  }

  const timeline = transfer.timeline || [];

  return (
    <>
      <Head><title>Transfer tracking · KitePay</title></Head>
      <ConsumerLayout active="Overview">
        <div className="mx-auto max-w-3xl">
          <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-ink"><ArrowLeft size={16} />Wallet overview</Link>
          <section className="mt-5 overflow-hidden rounded-3xl bg-white shadow-card ring-1 ring-slate-200">
            <div className="bg-ink px-6 py-8 text-center text-white sm:px-10 sm:py-10">
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-mint text-ink">{transfer.status === 'SIMULATED' ? <Clock3 size={28} /> : transfer.status === 'REVERSED' ? <ArrowLeft size={28} /> : <CircleCheck size={28} />}</span>
              <p className="mt-5 text-xs font-extrabold uppercase tracking-[.15em] text-mint">{transfer.status === 'SIMULATED' ? 'Transfer simulated · demo only' : transfer.status === 'REVERSED' ? 'Transfer reversed · demo only' : `Transfer ${transfer.status.toLowerCase()}`}</p>
              <h1 className="mt-2 text-3xl font-extrabold tracking-tight">{transfer.status === 'SIMULATED' ? 'Demo instruction prepared' : transfer.status === 'REVERSED' ? 'Demo transfer reversed' : `Transfer to ${transfer.beneficiary.fullName.split(' ')[0]}`}</h1>
              <p className="mt-2 text-sm text-slate-300">{transfer.status === 'SIMULATED' || transfer.status === 'REVERSED' ? 'No funds were sent to a bank or payment rail.' : 'Your transfer status is shown below.'}</p>
              <p className="mt-5 text-4xl font-extrabold">{money(transfer.payoutAmount, transfer.payoutCurrency)}</p>
              <p className="mt-1 text-xs text-slate-400">To {transfer.beneficiary.fullName} · {transfer.beneficiary.bankName}</p>
            </div>
            <div className="p-5 sm:p-8">
              <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-extrabold text-ink">Transfer progress</h2><p className="mt-1 text-xs text-slate-500">Reference {transfer.uetr}</p></div><span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-extrabold text-emerald-800"><Clock3 size={13} />{transfer.status}</span></div>
              <ol className="mt-7 space-y-0">
                {transferSteps.map(([key, title, description], index) => {
                  const event = timeline.find(item => item.step === key);
                  const done = event?.status === 'COMPLETED';
                  return <li key={key} className="relative flex gap-4 pb-7 last:pb-0"><span className="relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-800">{done ? <Check size={17} /> : index === 0 ? <Clock3 size={16} /> : <span className="h-2 w-2 rounded-full bg-slate-300" />}</span>{index < transferSteps.length - 1 && <span className={`absolute left-[17px] top-9 h-[calc(100%-12px)] w-0.5 ${done ? 'bg-emerald-200' : 'bg-slate-200'}`} />}<span className="min-w-0 flex-1 pt-0.5"><span className="block text-sm font-extrabold text-ink">{title}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span></span><span className="pt-1 text-[11px] font-bold text-emerald-700">{done ? 'Done' : 'Waiting'}</span></li>;
                })}
              </ol>
              {transfer.statusEvents?.length > 0 && <section className="mt-7 border-t border-slate-100 pt-5"><h3 className="text-sm font-extrabold text-ink">Status audit</h3><ol className="mt-3 space-y-3">{transfer.statusEvents.map(event => <li key={event.id} className="flex items-start justify-between gap-3 text-xs"><span><strong className="text-slate-800">{event.toStatus}</strong><span className="ml-2 text-slate-500">{event.reason.replace('DEMO_MODE: ', '')}</span></span><time className="shrink-0 text-slate-400">{new Date(event.createdAt).toLocaleString()}</time></li>)}</ol></section>}
              <div className="mt-7 grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2">
                <Detail label="You sent" value={money(transfer.sendAmount, transfer.sourceCurrency)} />
                <Detail label="Transfer fee" value={money(transfer.feeAmount, transfer.sourceCurrency)} />
                <Detail label="Exchange rate" value={`1 ${transfer.sourceCurrency} = ${Number(transfer.exchangeRate).toFixed(6)} ${transfer.payoutCurrency}`} />
                <Detail label="Purpose" value={transfer.purpose.replaceAll('_', ' ').toLowerCase()} />
              </div>
              <div className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4"><ShieldCheck className="mt-0.5 shrink-0 text-amber-800" size={18} /><p className="text-xs leading-5 text-amber-950"><strong>Demonstration transfer.</strong> This prototype records a simulated instruction and ledger entries. It does not transmit funds, and a generated ISO 20022 message is not bank acceptance or settlement.</p></div>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row"><CopyReference value={transfer.uetr} /><Link href="/dashboard" className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-ink px-4 py-3 text-sm font-extrabold text-white hover:bg-slate-700">Back to wallet<ArrowRight size={16} /></Link></div>
              <div className="mt-5 flex items-center justify-center gap-2 text-[11px] text-slate-400"><BadgeCheck size={14} />Recorded securely in your cross-border wallet ledger</div>
            </div>
          </section>
        </div>
      </ConsumerLayout>
    </>
  );
}

function Detail({ label, value }) {
  return <div><p className="text-[11px] font-semibold text-slate-500">{label}</p><p className="mt-1 text-sm font-extrabold capitalize text-ink">{value}</p></div>;
}

function CopyReference({ value }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return <button type="button" onClick={copy} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"><WalletCards size={16} />{copied ? 'Reference copied' : 'Copy reference'}</button>;
}
