import Link from 'next/link';
import { ArrowLeftRight, CircleUserRound, ContactRound, LayoutDashboard, LogOut, ReceiptText, ShieldCheck, WalletCards } from 'lucide-react';
import { logout } from '../services/api.js';

const navigation = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/transfers', label: 'Activity', icon: ReceiptText },
  { href: '/beneficiaries', label: 'Recipients', icon: ContactRound },
  { href: '/send', label: 'Send money', icon: ArrowLeftRight },
  { href: '/kyc', label: 'Identity check', icon: ShieldCheck },
];

export function ConsumerLayout({ children, active = 'Overview' }) {
  const handleLogout = async () => {
    await logout().catch(() => {});
    window.location.assign('/login');
  };

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <Link href="/dashboard" className="flex items-center gap-2.5" aria-label="KitePay home">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-ink text-mint">
              <WalletCards size={19} />
            </span>
            <span className="text-lg font-extrabold tracking-tight text-ink">kite<span className="text-emerald-600">pay</span></span>
          </Link>
          <nav className="hidden items-center gap-1 sm:flex" aria-label="Main navigation">
            {navigation.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={active === label ? 'page' : undefined}
                className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${
                  active === label ? 'bg-emerald-50 text-emerald-800' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Icon size={16} />{label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <span className="hidden text-sm font-semibold text-slate-600 md:inline">My account</span>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              <CircleUserRound size={17} /><span className="hidden sm:inline">Sign out</span><LogOut className="sm:hidden" size={15} />
            </button>
          </div>
        </div>
        <nav className="grid grid-cols-5 border-t border-slate-100 bg-white px-1 py-2 sm:hidden" aria-label="Mobile navigation">
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} aria-current={active === label ? 'page' : undefined} className={`grid min-w-0 justify-items-center gap-1 px-0.5 py-1 text-[10px] font-bold leading-3 ${active === label ? 'text-emerald-700' : 'text-slate-500'}`}>
              <Icon size={18} /><span className="text-center">{label}</span>
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}
