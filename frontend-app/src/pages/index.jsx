import Head from 'next/head';
import Link from 'next/link';
import {
  ArrowDownLeft, ArrowRight, ArrowUpRight, BadgeCheck, Banknote, Check, ChevronDown,
  CircleDollarSign, ClipboardList, CreditCard, FileCheck2, Fingerprint,
  Landmark, LockKeyhole, Network, RefreshCw, ShieldCheck, UserRound, WalletCards,
} from 'lucide-react';
import { PublicFooter, PublicHeader } from '../components/PublicSite.jsx';

export default function HomePage() {
  return (
    <>
      <Head>
        <title>KitePay | Cross-border payments, made clearer</title>
        <meta name="description" content="Explore KitePay, a cross-border payment orchestration prototype for transparent quotes, payment records and a more connected future." />
        <meta name="theme-color" content="#0d1728" />
      </Head>
      <PublicHeader />
      <main>
        <section id="home" className="relative overflow-hidden bg-[#0d1728] text-white">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_75%_45%,rgba(38,99,160,.18),transparent_42%)]" />
          <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[1.02fr_.98fr] lg:gap-10 lg:py-28">
            <div className="max-w-2xl">
              <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[.04] px-3 py-1.5 text-xs font-bold uppercase tracking-[.14em] text-blue-200">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-300" /> Cross-border payment prototype
              </p>
              <h1 className="mt-7 text-4xl font-extrabold leading-[1.08] tracking-[-.04em] sm:text-6xl lg:text-[4.25rem]">
                Moving money across borders. <span className="text-blue-300">Simplified.</span>
              </h1>
              <p className="mt-6 max-w-xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
                An intelligent cross-border payment platform designed to make international payments more transparent, efficient and accessible.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/register" className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3.5 text-sm font-extrabold text-ink transition hover:bg-blue-50">
                  Get started <ArrowUpRight size={17} />
                </Link>
                <a href="#how-it-works" className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/20 px-5 py-3.5 text-sm font-bold text-white transition hover:bg-white/10">
                  Explore how it works <ArrowDownLeft size={16} />
                </a>
              </div>
              <p className="mt-5 flex items-start gap-2 text-xs leading-5 text-slate-400">
                <ShieldCheck className="mt-0.5 shrink-0 text-blue-300" size={15} />
                Demonstration software. Payments are simulated; no real-money settlement occurs.
              </p>
            </div>
            <CorridorVisual />
          </div>
          <div className="border-t border-white/10">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-5 text-xs text-slate-400 sm:px-8">
              <span className="font-bold uppercase tracking-[.13em] text-slate-500">Prototype corridors</span>
              <div className="flex flex-wrap gap-x-6 gap-y-2 font-semibold"><span>PKR ↔ AED</span><span>PKR ↔ SAR</span><span>Sample rates · simulated execution</span></div>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="scroll-mt-24 bg-white py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <SectionHeading eyebrow="A clear path from start to finish" title="Know what happens at every step." description="The experience is designed to show the important details before a transfer is confirmed. The current software records a simulated payment flow only." />
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['01', UserRound, 'Create an account', 'Register with your details and set a separate payment PIN.'],
                ['02', FileCheck2, 'Verify your identity', 'Submit an identity document for the configured review workflow.'],
                ['03', Landmark, 'Add a beneficiary', 'Save the recipient and destination bank details for a transfer.'],
                ['04', CircleDollarSign, 'Review an FX quote', 'See the exchange rate, destination amount and disclosed fee.'],
                ['05', ClipboardList, 'Check the details', 'Review the beneficiary, amount, fee and quote before proceeding.'],
                ['06', Fingerprint, 'Confirm the payment', 'Confirm with your separate payment PIN and an active quote.'],
                ['07', RefreshCw, 'Track the recorded status', 'Follow the demo lifecycle; it does not represent bank acceptance or settlement.'],
              ].map(([number, Icon, title, detail]) => (
                <article key={number} className={`rounded-2xl border border-slate-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-card ${number === '07' ? 'sm:col-span-2 lg:col-span-1' : ''}`}>
                  <div className="flex items-center justify-between"><span className="text-xs font-extrabold tracking-[.14em] text-blue-700">{number}</span><Icon className="text-slate-400" size={19} /></div>
                  <h3 className="mt-6 text-base font-extrabold text-ink">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-500">{detail}</p>
                </article>
              ))}
            </div>
            <div className="mt-8 flex items-start gap-3 rounded-2xl bg-blue-50 p-5 text-sm leading-6 text-blue-950">
              <BadgeCheck className="mt-0.5 shrink-0 text-blue-700" size={19} />
              <p><strong>Prototype disclosure:</strong> transfers are simulated inside this application. No live payment rail, bank submission or international settlement is performed.</p>
            </div>
          </div>
        </section>

        <section id="features" className="scroll-mt-24 bg-[#f5f7fa] py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <SectionHeading eyebrow="Built around clarity" title="Useful foundations, working together." description="The platform brings together the components currently implemented in this prototype—without promising services that are not connected." />
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {[
                [WalletCards, 'Multi-currency wallet architecture', 'Wallet and ledger models support multiple currencies; the consumer flow currently funds a PKR wallet.'],
                [Network, 'Payment orchestration', 'A controlled workflow coordinates validation, screening, ledger posting and simulated transfer status.'],
                [RefreshCw, 'FX quote generation', 'Quotes use configured corridor data and static demo market rates with an expiry and recorded rate details.'],
                [CircleDollarSign, 'Transparent fee presentation', 'The consumer flow presents the amount, rate, destination amount and applicable fee for review.'],
                [Landmark, 'Beneficiary management', 'Save and select recipient details for supported prototype payout destinations.'],
                [ClipboardList, 'Transaction tracking', 'View wallet activity and recorded transfer status events in the consumer application.'],
                [ShieldCheck, 'KYC review workflow', 'Submit identity documents for review; application-layer encryption is available when operator keys are configured.'],
                [Banknote, 'Financial ledger architecture', 'Double-entry records capture simulated activity and financial controls, not evidence of settlement.'],
              ].map(([Icon, title, detail]) => (
                <article key={title} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-800"><Icon size={19} /></span>
                  <h3 className="mt-5 text-sm font-extrabold leading-5 text-ink">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-500">{detail}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="overflow-hidden bg-white py-20 sm:py-24">
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 sm:px-8 lg:grid-cols-[.9fr_1.1fr]">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[.16em] text-blue-700">A wider horizon</p>
              <h2 className="mt-4 text-3xl font-extrabold leading-tight tracking-tight text-ink sm:text-4xl">Designed with a global payment vision.</h2>
              <p className="mt-5 text-base leading-7 text-slate-600">
                Our long-term direction is to support more currencies and international corridors through a transparent, well-controlled platform. The current prototype is intentionally narrower.
              </p>
              <p className="mt-4 text-sm leading-6 text-slate-500">
                Today’s consumer demo covers PKR-funded flows to UAE and Saudi Arabia, with prototype PKR/AED and PKR/SAR corridor configurations. Coverage, banks and payment rails beyond those configured flows are future possibilities—not active connectivity.
              </p>
              <Link href="/register" className="mt-7 inline-flex items-center gap-2 text-sm font-extrabold text-blue-800 hover:text-blue-950">Explore the prototype <ArrowRight size={16} /></Link>
            </div>
            <GlobalCorridors />
          </div>
        </section>

        <section id="security" className="scroll-mt-24 bg-[#0d1728] py-20 text-white sm:py-24">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="grid gap-12 lg:grid-cols-[.85fr_1.15fr]">
              <div>
                <p className="text-xs font-extrabold uppercase tracking-[.16em] text-blue-300">Designed with controls in mind</p>
                <h2 className="mt-4 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">Trust is built into the workflow.</h2>
                <p className="mt-5 max-w-lg text-sm leading-7 text-slate-300">The prototype includes security and audit mechanisms as software controls. It is not a regulated financial service and has no verified certifications or bank partnerships.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  ['Secure authentication', 'Consumer sessions use signed tokens and protected API routes.'],
                  ['Separate payment PIN', 'A dedicated PIN is required to confirm a simulated transfer.'],
                  ['KYC workflow', 'Identity submissions are routed through staff review controls.'],
                  ['Encrypted documents', 'KYC document encryption is supported when keys are configured.'],
                  ['Role-based staff access', 'Staff routes enforce identity and role checks from an external provider.'],
                  ['Auditable operations', 'Financial activity and selected staff actions are recorded for traceability.'],
                ].map(([title, detail]) => (
                  <div key={title} className="flex gap-3 rounded-xl border border-white/10 bg-white/[.04] p-4">
                    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-blue-300/10 text-blue-200"><LockKeyhole size={16} /></span>
                    <div><h3 className="text-sm font-bold">{title}</h3><p className="mt-1 text-xs leading-5 text-slate-400">{detail}</p></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="about" className="scroll-mt-24 bg-white py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <SectionHeading eyebrow="About KitePay" title="A practical prototype for a more understandable payment journey." description="KitePay explores how payment orchestration, clear FX quotes and auditable records can fit together. It is a working software prototype—not a live remittance provider." />
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              <AboutPoint title="Clarity before confirmation" detail="Bring rates, fees and recipient details into the review step before a payment is simulated." />
              <AboutPoint title="Controls at each step" detail="Use authentication, identity review, validation and ledger safeguards in the application flow." />
              <AboutPoint title="A measured roadmap" detail="Treat new corridors and real settlement as future work requiring appropriate partners, controls and approvals." />
            </div>
          </div>
        </section>

        <section className="bg-[#f5f7fa] py-20 sm:py-24">
          <div className="mx-auto max-w-4xl px-5 sm:px-8">
            <SectionHeading eyebrow="Frequently asked questions" title="A few useful details." />
            <div className="mt-9 divide-y divide-slate-200 border-y border-slate-200">
              {[
                ['What is the platform?', 'KitePay is a cross-border payment orchestration software prototype. It demonstrates account, KYC, quote, beneficiary, ledger and simulated transfer workflows.'],
                ['How do international payments work?', 'In this prototype, a user creates an account, submits identity details, adds a beneficiary, reviews a quote and confirms with a separate PIN. The resulting transfer is simulated; no money is sent internationally.'],
                ['Which currencies are currently supported?', 'The consumer flow is funded in PKR and demonstrates payout quotes in AED or SAR. Other backend currency and corridor models do not mean consumer access or live coverage is available.'],
                ['How are exchange rates calculated?', 'Quotes use static demo market-rate data, configured spreads and a quote expiry. They are illustrative and are not live market prices.'],
                ['Is identity verification required?', 'The transfer workflow requires approved KYC status. Document review depends on staff identity services and encryption keys being configured by the operator.'],
                ['Can I track my transactions?', 'The app displays recorded wallet activity and a simulated status timeline. A recorded status does not show that a bank accepted or settled a payment.'],
                ['Is the platform processing real payments?', 'No. This version is a demonstration/prototype and does not execute real-money international settlement or connect to live payment rails.'],
              ].map(([question, answer]) => (
                <details key={question} className="group py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left text-sm font-extrabold text-ink">
                    {question}<ChevronDown className="shrink-0 text-slate-400 transition group-open:rotate-180" size={18} />
                  </summary>
                  <p className="mt-3 max-w-3xl pr-8 text-sm leading-6 text-slate-600">{answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-white px-5 py-16 sm:px-8 sm:py-20">
          <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-7 rounded-3xl bg-blue-50 px-6 py-9 sm:px-10 md:flex-row md:items-center">
            <div><p className="text-xs font-extrabold uppercase tracking-[.15em] text-blue-800">Explore the platform</p><h2 className="mt-3 text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">See a clearer payment journey in action.</h2><p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">Create a demo account to explore the current consumer experience. Transfers are simulated.</p></div>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <Link href="/register" className="inline-flex items-center justify-center gap-2 rounded-xl bg-ink px-5 py-3.5 text-sm font-extrabold text-white hover:bg-slate-700">Get started <ArrowUpRight size={16} /></Link>
              <Link href="/login" className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-5 py-3.5 text-sm font-bold text-ink hover:bg-slate-50">Sign in</Link>
            </div>
          </div>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}

function SectionHeading({ eyebrow, title, description }) {
  return (
    <div className="max-w-2xl">
      {eyebrow && <p className="text-xs font-extrabold uppercase tracking-[.16em] text-blue-700">{eyebrow}</p>}
      <h2 className="mt-3 text-3xl font-extrabold leading-tight tracking-tight text-ink sm:text-4xl">{title}</h2>
      {description && <p className="mt-4 text-base leading-7 text-slate-600">{description}</p>}
    </div>
  );
}

function CorridorVisual() {
  return (
    <div aria-label="Illustration of the prototype payment orchestration flow between PKR and destination currencies" role="img" className="relative mx-auto w-full max-w-[34rem]">
      <div className="absolute inset-8 rounded-full bg-blue-400/10 blur-3xl" />
      <div className="relative rounded-[2rem] border border-white/10 bg-[#13223a] p-5 shadow-2xl sm:p-7">
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-slate-400">Payment orchestration</p><p className="mt-1 text-sm font-extrabold text-white">A clear route, step by step</p></div>
          <span className="rounded-full border border-blue-300/20 bg-blue-300/10 px-2.5 py-1 text-[10px] font-bold text-blue-200">DEMO FLOW</span>
        </div>
        <div className="py-8 sm:py-10">
          <div className="flex items-center justify-between gap-2">
            <CurrencyNode code="PKR" name="Source" tone="blue" />
            <div className="relative mx-1 flex-1">
              <div className="h-px bg-gradient-to-r from-blue-300/20 via-blue-300 to-blue-300/20" />
              <span className="absolute left-1/2 top-1/2 grid h-8 w-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-blue-200/30 bg-[#13223a] text-blue-200"><Network size={15} /></span>
            </div>
            <CurrencyNode code="AED" name="UAE corridor" tone="mint" />
          </div>
          <div className="mx-auto my-6 h-9 w-px border-l border-dashed border-blue-200/40" />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-500">Configured corridor</span>
            <div className="h-px flex-1 border-t border-dashed border-white/15" />
            <CurrencyNode code="SAR" name="Saudi corridor" tone="mint" compact />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 border-t border-white/10 pt-4">
          <FlowStep icon={CreditCard} label="Review details" />
          <FlowStep icon={RefreshCw} label="Quote expires" />
          <FlowStep icon={Check} label="Record demo status" />
        </div>
      </div>
      <div className="absolute -bottom-5 -left-2 rounded-xl border border-white/10 bg-[#1a2c47] px-4 py-3 shadow-xl sm:-left-6">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Rate & fee</p>
        <p className="mt-1 flex items-center gap-2 text-xs font-bold text-white"><CircleDollarSign size={15} className="text-blue-300" /> Shown before confirmation</p>
      </div>
    </div>
  );
}

function CurrencyNode({ code, name, tone, compact = false }) {
  return (
    <div className={`relative z-10 rounded-2xl border border-white/10 bg-[#1a2c47] text-center ${compact ? 'px-3 py-2' : 'min-w-[6.4rem] px-4 py-4'}`}>
      <span className={`mx-auto grid place-items-center rounded-xl ${compact ? 'h-8 w-8 text-xs' : 'h-10 w-10 text-sm'} font-extrabold ${tone === 'blue' ? 'bg-blue-300/15 text-blue-200' : 'bg-mint/10 text-mint'}`}>{code}</span>
      <span className={`mt-2 block font-bold text-white ${compact ? 'text-[10px]' : 'text-xs'}`}>{name}</span>
    </div>
  );
}

function FlowStep({ icon: Icon, label }) {
  return <div className="flex items-center gap-2 rounded-lg bg-white/[.04] px-2 py-2.5 text-[10px] font-semibold leading-4 text-slate-300"><Icon className="shrink-0 text-blue-300" size={14} />{label}</div>;
}

function GlobalCorridors() {
  return (
    <div role="img" aria-label="Illustrative map highlighting prototype corridors between Pakistan, the UAE and Saudi Arabia" className="relative overflow-hidden rounded-[2rem] border border-slate-200 bg-[#f5f8fc] p-5 sm:p-8">
      <div className="absolute inset-0 opacity-60" style={{ backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)', backgroundSize: '18px 18px' }} />
      <svg viewBox="0 0 640 360" className="relative w-full" aria-hidden="true">
        <path d="M75 110l30-25 46 8 21 20-8 22-25 8-11 24-25-3-7-27-26-8zM205 170l28-22 35 6 22 17-11 17-25 2-13 18-21-9zM310 85l47-18 50 10 38-15 58 16 31 31-23 23-45 2-26 20-39-4-31 16-33-14-26 3-13-30-31-13zM355 205l39-15 48 10 23 30-28 25-42-5-27-18zM530 220l39-13 31 19-9 24-42 7-25-18z" fill="#dbe4ef" stroke="#c5d0df" strokeWidth="2" />
        <path d="M354 190 Q375 140 421 150" fill="none" stroke="#2563eb" strokeWidth="3" strokeDasharray="7 7" />
        <path d="M354 190 Q389 220 419 238" fill="none" stroke="#2563eb" strokeWidth="3" strokeDasharray="7 7" />
        <circle cx="354" cy="190" r="10" fill="#0d1728" stroke="white" strokeWidth="4" />
        <circle cx="421" cy="150" r="9" fill="#2563eb" stroke="white" strokeWidth="4" />
        <circle cx="419" cy="238" r="9" fill="#2563eb" stroke="white" strokeWidth="4" />
        <text x="332" y="177" fill="#0d1728" fontSize="13" fontWeight="700">Pakistan</text>
        <text x="432" y="147" fill="#0d1728" fontSize="12" fontWeight="600">UAE</text>
        <text x="430" y="247" fill="#0d1728" fontSize="12" fontWeight="600">Saudi Arabia</text>
      </svg>
      <div className="relative mt-2 flex flex-col justify-between gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2 text-xs font-bold text-ink"><span className="h-2 w-2 rounded-full bg-blue-600" /> Prototype routes only</div>
        <p className="text-xs leading-5 text-slate-500">Illustrative, not a map of active bank or payment-rail connectivity.</p>
      </div>
    </div>
  );
}

function AboutPoint({ title, detail }) {
  return <div className="rounded-2xl border border-slate-200 p-5"><p className="text-sm font-extrabold text-ink">{title}</p><p className="mt-2 text-sm leading-6 text-slate-500">{detail}</p></div>;
}
