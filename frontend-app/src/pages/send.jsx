import Head from 'next/head';
import Link from 'next/link';
import { ArrowDown, ArrowLeft, ArrowRight, Check, ChevronDown, CircleHelp, Clock3, Plus, ShieldCheck, Sparkles, WalletCards } from 'lucide-react';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ConsumerLayout } from '../components/ConsumerLayout.jsx';
import { useConsumerSession } from '../components/useConsumerSession.js';
import { addBeneficiary, createFxQuote, getBeneficiaries, getWallet, sendTransfer } from '../services/api.js';

const countries = {
  AE: { label: 'United Arab Emirates', short: 'UAE', flag: '🇦🇪', currency: 'AED' },
  SA: { label: 'Saudi Arabia', short: 'Saudi Arabia', flag: '🇸🇦', currency: 'SAR' },
};
const purposes = [
  ['FAMILY_SUPPORT', 'Family support'],
  ['EDUCATION', 'Education'],
  ['MEDICAL', 'Medical expenses'],
  ['SAVINGS', 'Savings'],
  ['OTHER', 'Other'],
];

export default function SendPage() {
  const router = useRouter();
  const { session, ready } = useConsumerSession();
  const [wallet, setWallet] = useState(null);
  const [beneficiaries, setBeneficiaries] = useState([]);
  const [step, setStep] = useState(1);
  const [country, setCountry] = useState('AE');
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState(null);
  const [beneficiaryId, setBeneficiaryId] = useState('');
  const [purpose, setPurpose] = useState('FAMILY_SUPPORT');
  const [pin, setPin] = useState('');
  const [showNewBeneficiary, setShowNewBeneficiary] = useState(false);
  const [newBeneficiary, setNewBeneficiary] = useState({ fullName: '', iban: '', bic: '', bankName: '', country: 'AE' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const transferIdempotencyKey = useRef(null);

  useEffect(() => {
    if (ready && !session) router.replace('/login');
    if (ready && session) {
      Promise.all([getWallet(), getBeneficiaries()])
        .then(([walletResult, beneficiaryResult]) => {
          setWallet(walletResult);
          setBeneficiaries(beneficiaryResult.beneficiaries);
        })
        .catch(requestError => setError(requestError.message))
        .finally(() => setLoading(false));
    }
  }, [ready, session, router]);

  const activeWallet = useMemo(() => wallet?.wallets?.find(item => item.currency === 'PKR'), [wallet]);
  const countryBeneficiaries = beneficiaries.filter(item => item.country === country);
  const selectedBeneficiary = beneficiaries.find(item => item.id === beneficiaryId);
  const kycApproved = wallet?.kycStatus === 'APPROVED';
  const setAmountValue = value => {
    setAmount(value);
    setQuote(null);
    transferIdempotencyKey.current = null;
  };

  const getQuote = async event => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const nextQuote = await createFxQuote({
        amount: Number(amount),
        sourceCurrency: activeWallet?.currency || 'PKR',
        country,
      });
      setQuote(nextQuote);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const saveBeneficiary = async event => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await addBeneficiary(newBeneficiary);
      setBeneficiaries(items => [result.beneficiary, ...items]);
      setBeneficiaryId(result.beneficiary.id);
      setShowNewBeneficiary(false);
      setNewBeneficiary({ fullName: '', iban: '', bic: '', bankName: '', country });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const confirmTransfer = async event => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await sendTransfer({
        amount: Number(amount),
        sourceCurrency: activeWallet?.currency || 'PKR',
        beneficiaryId,
        purpose,
        pin,
        quoteId: quote.quoteId,
      }, transferIdempotencyKey.current ||= crypto.randomUUID());
      await router.push(`/transfer/${result.transfer.id}`);
      transferIdempotencyKey.current = null;
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  if (!ready || !session || loading) {
    return <main className="grid min-h-screen place-items-center text-sm font-semibold text-slate-500">Loading secure transfer…</main>;
  }

  return (
    <>
      <Head><title>Send money · KitePay</title><meta name="description" content="Send PKR to UAE and Saudi Arabia with a transparent, locked exchange rate." /></Head>
      <ConsumerLayout active="Send money">
        <div className="mx-auto max-w-4xl">
          <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-ink"><ArrowLeft size={16} />Wallet overview</Link>
          <div className="mt-5 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div><p className="text-xs font-extrabold uppercase tracking-[.15em] text-emerald-700">A little closer to home</p><h1 className="mt-2 text-3xl font-extrabold tracking-tight text-ink">Send money</h1><p className="mt-2 text-sm text-slate-500">Clear fees. A locked rate. Every step tracked.</p></div>
            <div className="flex items-center gap-2 text-xs font-bold text-slate-500"><Clock3 size={15} />Demo orchestration · payout status is simulated</div>
          </div>

          <div className="mt-7 grid grid-cols-3 gap-2">
            {['Amount & rate', 'Who receives it', 'Review & send'].map((label, index) => {
              const number = index + 1;
              return <div key={label} className={`flex items-center gap-2 border-b-2 pb-3 text-xs font-extrabold sm:gap-3 sm:text-sm ${step >= number ? 'border-emerald-600 text-ink' : 'border-slate-200 text-slate-400'}`}><span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs ${step > number ? 'bg-emerald-700 text-white' : step === number ? 'bg-ink text-white' : 'bg-slate-200 text-slate-500'}`}>{step > number ? <Check size={14} /> : number}</span><span className="leading-tight">{label}</span></div>;
            })}
          </div>

          {!kycApproved && <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-3"><ShieldCheck className="mt-0.5 shrink-0 text-amber-800" size={19} /><div><p className="text-sm font-extrabold text-amber-950">Complete your identity check</p><p className="mt-1 text-xs leading-5 text-amber-900">Transfers unlock after your identity documents are reviewed and approved.</p></div></div><Link href="/kyc" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-amber-900 px-4 py-2.5 text-xs font-extrabold text-white hover:bg-amber-800">Verify identity<ArrowRight size={14} /></Link></div>}

          {error && <p role="alert" className="mt-5 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</p>}

          <section className="mt-5 rounded-3xl bg-white p-5 shadow-card ring-1 ring-slate-200 sm:p-8">
            {step === 1 && <form onSubmit={getQuote} className="space-y-6">
              <div><h2 className="text-xl font-extrabold text-ink">Where are we sending it?</h2><p className="mt-1 text-sm text-slate-500">Choose where your recipient will receive their money.</p></div>
              <div className="grid gap-3 sm:grid-cols-2">{Object.entries(countries).map(([code, item]) => <button key={code} type="button" onClick={() => { setCountry(code); setQuote(null); setBeneficiaryId(''); }} className={`flex items-center gap-4 rounded-2xl border p-4 text-left transition ${country === code ? 'border-emerald-700 bg-emerald-50/70 ring-2 ring-emerald-700/10' : 'border-slate-200 hover:bg-slate-50'}`}><span className="text-3xl">{item.flag}</span><span className="flex-1"><span className="block text-sm font-extrabold text-ink">{item.label}</span><span className="mt-1 block text-xs text-slate-500">Receive in {item.currency}</span></span>{country === code && <Check className="text-emerald-800" size={18} />}</button>)}</div>
              <label className="block"><span className="text-sm font-extrabold text-slate-700">You send</span><div className="mt-1.5 flex items-center rounded-2xl border border-slate-200 px-4 focus-within:border-emerald-600 focus-within:ring-4 focus-within:ring-emerald-600/10"><div className="flex items-center gap-2 border-r border-slate-200 py-4 pr-3"><span className="text-xl">🇵🇰</span><span className="text-sm font-extrabold text-ink">PKR</span></div><input autoFocus type="number" min="1000" max="10000000" step="1" value={amount} onChange={event => setAmountValue(event.target.value)} placeholder="0.00" required className="min-w-0 flex-1 border-0 bg-transparent px-4 py-4 text-2xl font-extrabold text-ink outline-none placeholder:text-slate-300" /><span className="hidden text-xs font-semibold text-slate-400 sm:inline">Balance {Number(activeWallet?.balance || 0).toLocaleString()} PKR</span></div><span className="mt-1.5 block text-xs text-slate-500">Send between PKR 1,000 and PKR 10,000,000.</span></label>
              {quote && <QuoteCard quote={quote} country={country} />}
              <div className="flex flex-col-reverse justify-between gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center"><p className="flex items-center gap-2 text-xs text-slate-500"><ShieldCheck size={15} className="text-emerald-700" />Demo market rate held for 45 seconds.</p>{quote ? <button type="button" disabled={Number(quote.totalDebited) > Number(activeWallet?.balance || 0)} onClick={() => { setNewBeneficiary(current => ({ ...current, country })); setStep(2); }} className="inline-flex items-center justify-center gap-2 rounded-xl bg-ink px-5 py-3 text-sm font-extrabold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50">{Number(quote.totalDebited) > Number(activeWallet?.balance || 0) ? 'Insufficient wallet balance' : 'Choose recipient'}<ArrowRight size={16} /></button> : <button disabled={busy || !amount} className="inline-flex items-center justify-center gap-2 rounded-xl bg-ink px-5 py-3 text-sm font-extrabold text-white hover:bg-slate-700 disabled:opacity-50">{busy ? 'Checking demo rate…' : 'Get demo rate'}<ArrowRight size={16} /></button>}</div>
            </form>}

            {step === 2 && <div className="space-y-6">
              <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-extrabold text-ink">Who should receive the money?</h2><p className="mt-1 text-sm text-slate-500">Bank detail formats are checked; account ownership is not verified.</p></div><span className="text-2xl">{countries[country].flag}</span></div>
              {!showNewBeneficiary && <><div className="space-y-3">{countryBeneficiaries.map(person => <button type="button" key={person.id} onClick={() => setBeneficiaryId(person.id)} className={`flex w-full items-center gap-3 rounded-2xl border p-4 text-left ${beneficiaryId === person.id ? 'border-emerald-700 bg-emerald-50/70 ring-2 ring-emerald-700/10' : 'border-slate-200 hover:bg-slate-50'}`}><span className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-sm font-extrabold text-slate-700">{person.fullName.split(/\s+/).slice(0, 2).map(name => name[0]).join('').toUpperCase()}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-extrabold text-ink">{person.fullName}</span><span className="mt-1 block truncate text-xs text-slate-500">{person.bankName} · {person.iban.slice(0, 4)}••••{person.iban.slice(-4)}</span><span className="mt-1 block text-[11px] font-semibold text-amber-700">Format checked · ownership not verified</span></span>{beneficiaryId === person.id && <Check className="text-emerald-800" size={18} />}</button>)}</div>
                <button type="button" onClick={() => setShowNewBeneficiary(true)} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm font-extrabold text-slate-700 hover:border-emerald-700 hover:bg-emerald-50"><Plus size={17} />Add a new recipient</button>
              </>}
              {showNewBeneficiary && <form onSubmit={saveBeneficiary} className="grid gap-4 sm:grid-cols-2">
                <Field label="Beneficiary full name" value={newBeneficiary.fullName} onChange={event => setNewBeneficiary({ ...newBeneficiary, fullName: event.target.value })} required className="sm:col-span-2" />
                <Field label="Bank name" value={newBeneficiary.bankName} onChange={event => setNewBeneficiary({ ...newBeneficiary, bankName: event.target.value })} required />
                <label className="block"><span className="text-sm font-bold text-slate-700">Payout country</span><div className="relative mt-1.5"><select disabled value={country} className="w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 pr-9 text-sm outline-none"><option value="AE">United Arab Emirates</option><option value="SA">Saudi Arabia</option></select><ChevronDown size={16} className="pointer-events-none absolute right-3 top-3.5 text-slate-400" /></div></label>
                <Field label="IBAN" value={newBeneficiary.iban} onChange={event => setNewBeneficiary({ ...newBeneficiary, iban: event.target.value.toUpperCase() })} placeholder={country === 'AE' ? 'AE070331234567890123456' : 'SA…'} required className="sm:col-span-2" />
                <Field label="Bank BIC / SWIFT" value={newBeneficiary.bic} onChange={event => setNewBeneficiary({ ...newBeneficiary, bic: event.target.value.toUpperCase() })} placeholder={country === 'AE' ? 'FABAEADU' : 'RJHIBSRI'} required />
                <div className="flex items-end gap-2 sm:col-span-2"><button disabled={busy} className="rounded-xl bg-ink px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save recipient'}</button><button type="button" onClick={() => setShowNewBeneficiary(false)} className="rounded-xl px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-100">Cancel</button></div>
              </form>}
              <label className="block max-w-md"><span className="text-sm font-bold text-slate-700">Purpose of remittance</span><div className="relative mt-1.5"><select value={purpose} onChange={event => setPurpose(event.target.value)} className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-3.5 py-3 pr-9 text-sm outline-none focus:border-emerald-600"><option value="FAMILY_SUPPORT">Family support</option><option value="EDUCATION">Education</option><option value="MEDICAL">Medical expenses</option><option value="SAVINGS">Savings</option><option value="OTHER">Other</option></select><ChevronDown size={16} className="pointer-events-none absolute right-3 top-3.5 text-slate-400" /></div></label>
              <StepFooter onBack={() => setStep(1)} onNext={() => { if (!beneficiaryId || selectedBeneficiary?.country !== country) { setError('Choose a saved recipient in your selected payout country.'); return; } setError(''); setStep(3); }} nextLabel="Review transfer" disabled={showNewBeneficiary || !beneficiaryId} />
            </div>}

            {step === 3 && quote && selectedBeneficiary && <form onSubmit={confirmTransfer} className="space-y-6">
              <div><h2 className="text-xl font-extrabold text-ink">Review before you send</h2><p className="mt-1 text-sm text-slate-500">Double-check the details. We’ll ask for your payment PIN to confirm.</p></div>
              <QuoteCard quote={quote} country={country} />
              <div className="rounded-2xl border border-slate-200 p-4 sm:p-5">
                <p className="text-xs font-extrabold uppercase tracking-wider text-slate-500">Recipient</p><div className="mt-3 flex items-start gap-3"><span className="grid h-10 w-10 place-items-center rounded-full bg-emerald-50 text-sm font-extrabold text-emerald-900">{selectedBeneficiary.fullName.split(/\s+/).slice(0, 2).map(name => name[0]).join('').toUpperCase()}</span><div className="min-w-0"><p className="text-sm font-extrabold text-ink">{selectedBeneficiary.fullName}</p><p className="mt-1 text-xs text-slate-500">{selectedBeneficiary.bankName} · {countries[selectedBeneficiary.country].label}</p><p className="mt-1 truncate font-mono text-xs text-slate-500">{selectedBeneficiary.iban}</p></div></div>
                <div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">Purpose <span className="float-right font-bold text-slate-700">{purposes.find(([id]) => id === purpose)?.[1]}</span></div>
              </div>
              <label className="block max-w-xs"><span className="text-sm font-extrabold text-slate-700">Enter your 6-digit payment PIN</span><input type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))} required className="mt-1.5 w-full rounded-xl border border-slate-200 px-4 py-3 text-center font-mono text-2xl tracking-[.55em] outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10" placeholder="••••••" /></label>
              <div className="flex items-start gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-xs leading-5 text-emerald-950"><ShieldCheck size={16} className="mt-0.5 shrink-0" />Your transfer is sanctions-screened and recorded to a balanced double-entry ledger.</div>
              <StepFooter onBack={() => setStep(2)} onNext={confirmTransfer} nextLabel={busy ? 'Sending securely…' : 'Confirm and send'} disabled={busy || !kycApproved || pin.length !== 6} />
            </form>}
          </section>
          <p className="mt-4 flex items-start justify-center gap-2 text-center text-[11px] leading-5 text-slate-400"><CircleHelp size={14} className="mt-0.5 shrink-0" />Demo market data only. This prototype does not initiate real bank transfers. Your demo quote is held for 45 seconds.</p>
        </div>
      </ConsumerLayout>
    </>
  );
}

function Field({ label, className = '', ...props }) {
  return <label className={`block ${className}`}><span className="text-sm font-bold text-slate-700">{label}</span><input {...props} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-ink outline-none placeholder:text-slate-400 focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10" /></label>;
}

function QuoteCard({ quote, country }) {
  return <div className="overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50/60">
    <div className="flex items-center justify-between border-b border-emerald-100 px-4 py-3"><span className="inline-flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-emerald-900"><Sparkles size={15} />Your locked quote</span><span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-emerald-800"><Clock3 size={12} />45 sec</span></div>
    <div className="grid gap-3 p-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center"><div><p className="text-xs font-semibold text-slate-500">You send</p><p className="mt-1 text-xl font-extrabold text-ink">{Number(quote.amount).toLocaleString()} <span className="text-sm text-slate-500">PKR</span></p></div><div className="grid h-8 w-8 place-items-center rounded-full bg-white text-emerald-800"><ArrowRight size={16} className="hidden sm:block" /><ArrowDown size={16} className="sm:hidden" /></div><div><p className="text-xs font-semibold text-slate-500">They receive · {countries[country].short}</p><p className="mt-1 text-xl font-extrabold text-emerald-900">{Number(quote.payoutAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-sm">{quote.payoutCurrency}</span></p></div></div>
    <div className="grid grid-cols-2 gap-y-3 border-t border-emerald-100 px-4 py-4 text-xs sm:grid-cols-3"><div><span className="text-slate-500">Exchange rate</span><p className="mt-1 font-extrabold text-ink">1 PKR = {Number(quote.exchangeRate).toFixed(6)} {quote.payoutCurrency}</p></div><div><span className="text-slate-500">Transfer fee</span><p className="mt-1 font-extrabold text-ink">{Number(quote.feeAmount).toLocaleString()} PKR</p></div><div className="col-span-2 border-t border-emerald-100 pt-3 sm:col-span-1 sm:border-0 sm:pt-0"><span className="text-slate-500">Total from wallet</span><p className="mt-1 font-extrabold text-ink">{Number(quote.totalDebited).toLocaleString()} PKR</p></div></div>
  </div>;
}

function StepFooter({ onBack, onNext, nextLabel, disabled }) {
  return <div className="flex flex-col-reverse justify-between gap-3 border-t border-slate-100 pt-5 sm:flex-row"><button type="button" onClick={onBack} className="rounded-xl px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-100">Back</button><button type="button" onClick={onNext} disabled={disabled} className="inline-flex items-center justify-center gap-2 rounded-xl bg-ink px-5 py-3 text-sm font-extrabold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50">{nextLabel}<ArrowRight size={16} /></button></div>;
}
