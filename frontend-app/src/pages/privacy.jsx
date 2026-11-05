import Head from 'next/head';
import Link from 'next/link';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { PublicFooter, PublicHeader } from '../components/PublicSite.jsx';

export default function PrivacyPage() {
  return (
    <>
      <Head>
        <title>Privacy overview · KitePay</title>
        <meta name="description" content="A plain-language overview of data handling in the KitePay prototype." />
      </Head>
      <PublicHeader />
      <main className="mx-auto max-w-3xl px-5 py-14 sm:px-8 sm:py-20">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-ink"><ArrowLeft size={16} />Back to KitePay</Link>
        <div className="mt-8 flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-blue-50 text-blue-800"><ShieldCheck size={20} /></span><p className="text-xs font-extrabold uppercase tracking-[.15em] text-blue-800">Prototype information</p></div>
        <h1 className="mt-5 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">Privacy overview</h1>
        <p className="mt-4 text-sm leading-6 text-slate-600">This page describes the current software prototype at a high level. It is not a formal privacy policy for a live financial service.</p>
        <div className="mt-9 space-y-7 text-sm leading-7 text-slate-600">
          <section><h2 className="font-extrabold text-ink">Information used in the demo</h2><p className="mt-2">The application collects account and contact details for registration, beneficiary details supplied for payment demonstrations, and identity documents submitted to the KYC workflow. Simulated wallet and transfer activity is also recorded by the backend.</p></section>
          <section><h2 className="font-extrabold text-ink">Identity documents and access</h2><p className="mt-2">The backend supports application-layer encryption of KYC documents when encryption keys are configured. Access to staff review routes depends on an external staff identity provider and role checks. This describes available software controls, not a security certification.</p></section>
          <section><h2 className="font-extrabold text-ink">Browser session storage</h2><p className="mt-2">The current frontend stores session tokens and basic session information in browser local storage. Do not use real identity, payment or account information in an untrusted demo environment.</p></section>
          <section><h2 className="font-extrabold text-ink">Retention and contact</h2><p className="mt-2">Retention periods, data controller details and a privacy contact have not been configured or verified for this prototype. No company, legal entity or contact details are represented on this page.</p></section>
        </div>
        <p className="mt-10 rounded-xl bg-amber-50 p-4 text-xs leading-5 text-amber-950">Do not submit real identity documents or personal financial information unless you operate this deployment and have separately established the required privacy, security and retention arrangements.</p>
      </main>
      <PublicFooter />
    </>
  );
}
