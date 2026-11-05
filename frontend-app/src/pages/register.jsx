import Head from 'next/head';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, Globe2, ShieldCheck, WalletCards } from 'lucide-react';
import { useState } from 'react';
import { useRouter } from 'next/router';
import { register, saveSession } from '../services/api.js';

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '', pin: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const update = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }));
  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const session = await register(form);
      saveSession(session);
      router.push('/kyc');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Head><title>Create your KitePay wallet</title><meta name="description" content="Register for cross-border transfers between Pakistan and the Gulf." /></Head>
      <main className="grid min-h-screen lg:grid-cols-[1.02fr_.98fr]">
        <section className="relative hidden overflow-hidden bg-ink p-12 text-white lg:flex lg:flex-col lg:justify-between">
          <Link href="/login" className="inline-flex w-fit items-center gap-2 text-lg font-extrabold"><span className="grid h-10 w-10 place-items-center rounded-xl bg-mint text-ink"><WalletCards size={20} /></span>kitepay</Link>
          <div className="relative z-10 max-w-lg pb-14">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-bold text-mint"><Globe2 size={14} /> MONEY WITHOUT BORDERS</span>
            <h1 className="mt-6 text-5xl font-extrabold leading-[1.08] tracking-tight">Your people are never far away.</h1>
            <p className="mt-5 max-w-md text-base leading-7 text-slate-300">Explore a simulated payment journey from Pakistan to the UAE and Saudi Arabia.</p>
            <div className="mt-9 space-y-4 text-sm text-slate-200">
              {['Review the illustrative rate and fee before confirming', 'Track the recorded demo status', 'Account, PIN and identity-review controls'].map(item => <p key={item} className="flex items-center gap-3"><CheckCircle2 className="text-mint" size={18} />{item}</p>)}
            </div>
          </div>
          <p className="text-xs text-slate-500">Demo software only · payments are simulated.</p>
          <div className="absolute -bottom-48 -right-20 h-[30rem] w-[30rem] rounded-full border border-white/10" />
          <div className="absolute -bottom-28 -right-4 h-[22rem] w-[22rem] rounded-full border border-white/10" />
        </section>
        <section className="flex items-center justify-center px-5 py-10 sm:px-10">
          <div className="w-full max-w-md">
            <Link href="/login" className="inline-flex items-center gap-2 text-lg font-extrabold text-ink lg:hidden"><span className="grid h-10 w-10 place-items-center rounded-xl bg-ink text-mint"><WalletCards size={20} /></span>kitepay</Link>
            <div className="mt-8 lg:mt-0">
              <p className="text-xs font-extrabold uppercase tracking-[.16em] text-emerald-700">Get started</p>
              <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-ink">Create your wallet</h2>
              <p className="mt-2 text-sm text-slate-500">It only takes a couple of minutes to get started.</p>
            </div>
            <form onSubmit={submit} className="mt-7 space-y-4">
              <Field label="Full name" name="fullName" value={form.fullName} onChange={update} autoComplete="name" required />
              <Field label="Email address" name="email" value={form.email} onChange={update} type="email" autoComplete="email" required />
              <Field label="Mobile number" name="phone" value={form.phone} onChange={update} type="tel" autoComplete="tel" placeholder="+92 300 1234567" required />
              <Field label="Password" name="password" value={form.password} onChange={update} type="password" autoComplete="new-password" minLength={10} required hint="At least 10 characters." />
              <Field label="6-digit payment PIN" name="pin" value={form.pin} onChange={update} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required hint="Used to confirm each transfer." />
              {error && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</p>}
              <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-ink px-5 py-3.5 text-sm font-bold text-white transition hover:bg-slate-700 disabled:opacity-60">{busy ? 'Creating secure wallet…' : 'Create my account'}<ArrowRight size={17} /></button>
            </form>
            <div className="mt-5 flex items-start gap-2 rounded-xl bg-white px-4 py-3 text-xs leading-5 text-slate-500 ring-1 ring-slate-200"><ShieldCheck className="mt-0.5 shrink-0 text-emerald-700" size={17} />Demo only: wallet activity and transfers are simulated; no real-money settlement is performed. Identity verification is required in the transfer workflow.</div>
            <p className="mt-6 text-center text-sm text-slate-500">Already have a wallet? <Link href="/login" className="font-bold text-emerald-800 hover:underline">Sign in</Link></p>
          </div>
        </section>
      </main>
    </>
  );
}

function Field({ label, hint, ...props }) {
  return <label className="block"><span className="text-sm font-bold text-slate-700">{label}</span><input {...props} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-ink outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10" />{hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}</label>;
}
