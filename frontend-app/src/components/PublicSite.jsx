import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Menu, WalletCards, X } from 'lucide-react';

const navigation = [
  { href: '/#home', label: 'Home' },
  { href: '/#how-it-works', label: 'How it works' },
  { href: '/#features', label: 'Features' },
  { href: '/#security', label: 'Security' },
  { href: '/#about', label: 'About' },
];

export function Brand({ inverted = false }) {
  return (
    <Link
      href="/"
      aria-label="KitePay home"
      className={`inline-flex items-center gap-2.5 text-lg font-extrabold tracking-tight ${inverted ? 'text-white' : 'text-ink'}`}
    >
      <span className={`grid h-10 w-10 place-items-center rounded-xl ${inverted ? 'bg-mint text-ink' : 'bg-ink text-mint'}`}>
        <WalletCards size={20} />
      </span>
      <span>kite<span className={inverted ? 'text-mint' : 'text-emerald-700'}>pay</span></span>
    </Link>
  );
}

export function PublicHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3.5 sm:px-8">
        <Brand />
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Main navigation">
          {navigation.map(item => (
            <a key={item.href} href={item.href} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-ink">
              {item.label}
            </a>
          ))}
        </nav>
        <div className="hidden items-center gap-3 lg:flex">
          <Link href="/login" className="px-3 py-2 text-sm font-bold text-ink transition hover:text-blue-700">Sign in</Link>
          <Link href="/register" className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-bold text-white transition hover:bg-slate-700">
            Get started <ArrowUpRight size={16} />
          </Link>
        </div>
        <button
          type="button"
          className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-ink lg:hidden"
          aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={menuOpen}
          aria-controls="mobile-navigation"
          onClick={() => setMenuOpen(open => !open)}
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
      {menuOpen && (
        <nav id="mobile-navigation" className="border-t border-slate-100 bg-white px-5 py-4 lg:hidden" aria-label="Mobile navigation">
          <div className="mx-auto grid max-w-7xl gap-1">
            {navigation.map(item => (
              <a key={item.href} href={item.href} onClick={() => setMenuOpen(false)} className="rounded-lg px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                {item.label}
              </a>
            ))}
            <div className="mt-2 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4">
              <Link href="/login" onClick={() => setMenuOpen(false)} className="rounded-xl border border-slate-200 px-4 py-3 text-center text-sm font-bold text-ink">Sign in</Link>
              <Link href="/register" onClick={() => setMenuOpen(false)} className="rounded-xl bg-ink px-4 py-3 text-center text-sm font-bold text-white">Get started</Link>
            </div>
          </div>
        </nav>
      )}
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="bg-[#0d1728] text-white">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-12 sm:px-8 md:grid-cols-[1.4fr_.8fr_.8fr] md:py-16">
        <div>
          <Brand inverted />
          <p className="mt-4 max-w-sm text-sm leading-6 text-slate-400">
            A cross-border payment orchestration prototype focused on clear quotes, careful records and a more connected future.
          </p>
        </div>
        <div>
          <h2 className="text-sm font-bold text-white">Explore</h2>
          <div className="mt-4 grid gap-3 text-sm text-slate-400">
            <a className="hover:text-white" href="/#how-it-works">How it works</a>
            <a className="hover:text-white" href="/#features">Platform features</a>
            <a className="hover:text-white" href="/#security">Security</a>
            <Link className="hover:text-white" href="/login">Sign in</Link>
            <Link className="hover:text-white" href="/register">Create an account</Link>
          </div>
        </div>
        <div>
          <h2 className="text-sm font-bold text-white">Information</h2>
          <div className="mt-4 grid gap-3 text-sm text-slate-400">
            <Link className="hover:text-white" href="/privacy">Privacy overview</Link>
            <Link className="hover:text-white" href="/terms">Prototype terms</Link>
            <a className="hover:text-white" href="/#about">About the platform</a>
          </div>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-5 text-xs leading-5 text-slate-500 sm:px-8 md:flex-row md:items-center md:justify-between">
          <p>© {new Date().getFullYear()} KitePay · Demonstration software, not a money transfer service.</p>
          <p>Payments are simulated. No real-money settlement is performed.</p>
        </div>
      </div>
    </footer>
  );
}
