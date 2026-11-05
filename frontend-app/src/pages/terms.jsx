import Head from 'next/head';
import Link from 'next/link';
import { ArrowLeft, CircleAlert } from 'lucide-react';
import { PublicFooter, PublicHeader } from '../components/PublicSite.jsx';

export default function TermsPage() {
  return (
    <>
      <Head>
        <title>Prototype terms · KitePay</title>
        <meta name="description" content="Important prototype limitations for the KitePay demonstration." />
      </Head>
      <PublicHeader />
      <main className="mx-auto max-w-3xl px-5 py-14 sm:px-8 sm:py-20">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-ink"><ArrowLeft size={16} />Back to KitePay</Link>
        <div className="mt-8 flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-amber-50 text-amber-800"><CircleAlert size={20} /></span><p className="text-xs font-extrabold uppercase tracking-[.15em] text-amber-800">Prototype disclosure</p></div>
        <h1 className="mt-5 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">Prototype terms</h1>
        <p className="mt-4 text-sm leading-6 text-slate-600">KitePay in this deployment is demonstration software, not an offer or provision of a financial service.</p>
        <div className="mt-9 space-y-7 text-sm leading-7 text-slate-600">
          <section><h2 className="font-extrabold text-ink">No real payments</h2><p className="mt-2">Wallet top-ups and international transfers are simulated records. The platform does not initiate real-money transfers, submit payments to banks or payment rails, or confirm settlement.</p></section>
          <section><h2 className="font-extrabold text-ink">Illustrative rates and corridors</h2><p className="mt-2">Exchange rates are generated from static demonstration data and may not reflect market rates. Displayed corridors do not imply active coverage, bank connectivity or availability of a payment rail.</p></section>
          <section><h2 className="font-extrabold text-ink">No financial or regulatory claims</h2><p className="mt-2">The prototype does not claim regulatory authorization, licensing, deposit protection, insurance, bank partnerships or financial advice. Do not rely on demo data to make a financial decision.</p></section>
          <section><h2 className="font-extrabold text-ink">Deployment-specific arrangements</h2><p className="mt-2">No legal entity, governing law, commercial terms or support contact has been configured here. These prototype notes are not a substitute for reviewed legal terms before any live service is made available.</p></section>
        </div>
        <p className="mt-10 rounded-xl bg-blue-50 p-4 text-xs leading-5 text-blue-950">Use the platform only with test data in an environment controlled by its operator.</p>
      </main>
      <PublicFooter />
    </>
  );
}
