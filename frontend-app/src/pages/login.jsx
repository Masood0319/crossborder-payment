import Head from 'next/head';
import Link from 'next/link';
import { ArrowRight, LockKeyhole, WalletCards } from 'lucide-react';
import { useState } from 'react';
import { useRouter } from 'next/router';
import { login, saveSession } from '../services/api.js';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      saveSession(await login({ email, password }));
      router.push('/dashboard');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Head><title>Sign in to KitePay</title></Head>
      <main className="grid min-h-screen lg:grid-cols-[1.02fr_.98fr]">
        <section className="hidden flex-col justify-between bg-ink p-12 text-white lg:flex">
          <Link href="/login" className="inline-flex w-fit items-center gap-2 text-lg font-extrabold"><span className="grid h-10 w-10 place-items-center rounded-xl bg-mint text-ink"><WalletCards size={20} /></span>kitepay</Link>
          <div className="max-w-lg pb-16">
            <p className="text-xs font-extrabold uppercase tracking-[.18em] text-mint">Your money. Your move.</p>
            <h1 className="mt-5 text-5xl font-extrabold leading-tight tracking-tight">A clearer way to explore cross-border payments.</h1>
            <p className="mt-5 max-w-md leading-7 text-slate-300">Explore simulated payment flows between Pakistan, the UAE and Saudi Arabia.</p>
            <div className="mt-9 rounded-2xl border border-white/10 bg-white/[.06] p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">See the details before confirmation</p>
              <div className="mt-3 flex items-end justify-between"><p className="text-3xl font-extrabold">Clear by design.</p><span className="rounded-full bg-mint/10 px-3 py-1 text-xs font-bold text-mint">Demo quote</span></div>
            </div>
          </div>
          <p className="text-xs text-slate-500">Prototype only · no real-money settlement is performed.</p>
        </section>
        <section className="flex items-center justify-center px-5 py-12 sm:px-10">
          <div className="w-full max-w-md">
            <Link href="/login" className="inline-flex items-center gap-2 text-lg font-extrabold text-ink lg:hidden"><span className="grid h-10 w-10 place-items-center rounded-xl bg-ink text-mint"><WalletCards size={20} /></span>kitepay</Link>
            <div className="mt-12 lg:mt-0"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-100 text-emerald-800"><LockKeyhole size={21} /></span><h2 className="mt-6 text-3xl font-extrabold tracking-tight text-ink">Welcome back</h2><p className="mt-2 text-sm text-slate-500">Sign in to your wallet to pick up where you left off.</p></div>
            <form onSubmit={submit} className="mt-8 space-y-5">
              <label className="block"><span className="text-sm font-bold text-slate-700">Email address</span><input type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10" placeholder="you@example.com" /></label>
              <label className="block"><span className="text-sm font-bold text-slate-700">Password</span><input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10" /></label>
              {error && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</p>}
              <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-ink px-5 py-3.5 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-60">{busy ? 'Signing in…' : 'Sign in securely'}<ArrowRight size={17} /></button>
            </form>
            <p className="mt-7 text-center text-sm text-slate-500">New to KitePay? <Link href="/register" className="font-bold text-emerald-800 hover:underline">Create an account</Link></p>
            <p className="mt-8 text-center text-xs leading-5 text-slate-400">Your account is protected with secure authentication and a separate payment PIN.</p>
          </div>
        </section>
      </main>
    </>
  );
}
