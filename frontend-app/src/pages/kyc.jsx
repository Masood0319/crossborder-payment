import Head from 'next/head';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, CheckCircle2, FileCheck2, ShieldCheck, UploadCloud } from 'lucide-react';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { ConsumerLayout } from '../components/ConsumerLayout.jsx';
import { useConsumerSession } from '../components/useConsumerSession.js';
import { submitKycDocument } from '../services/api.js';

export default function KycPage() {
  const router = useRouter();
  const { session, ready } = useConsumerSession();
  const [documentType, setDocumentType] = useState('CNIC');
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  if (ready && !session) {
    router.replace('/login');
    return null;
  }
  if (!ready || !session) return null;

  const submit = async event => {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (!file) {
      setError('Choose a clear photo or PDF of your identity document.');
      return;
    }
    setBusy(true);
    try {
      await submitKycDocument(documentType, file);
      setSuccess('Your document is securely submitted. Transfers unlock after a reviewer approves your identity.');
      setFile(null);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Head><title>Verify your identity · KitePay</title></Head>
      <ConsumerLayout active="Identity check">
        <div className="mx-auto max-w-2xl">
          <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-ink"><ArrowLeft size={16} />Back to wallet</Link>
          <div className="mt-6 overflow-hidden rounded-3xl bg-white shadow-card ring-1 ring-slate-200">
            <div className="bg-ink px-6 py-7 text-white sm:px-9 sm:py-9">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-mint text-ink"><ShieldCheck size={24} /></span>
              <p className="mt-5 text-xs font-extrabold uppercase tracking-[.16em] text-mint">A quick identity check</p>
              <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Let’s verify it’s you.</h1>
              <p className="mt-2 max-w-lg text-sm leading-6 text-slate-300">Your identity document is sent for review. The backend encrypts submitted documents when its required encryption keys are configured.</p>
            </div>
            <form onSubmit={submit} className="space-y-6 p-6 sm:p-9">
              <div className="grid grid-cols-2 gap-3">
                {['CNIC', 'PASSPORT'].map(type => <button key={type} type="button" onClick={() => setDocumentType(type)} className={`rounded-xl border px-4 py-3 text-sm font-bold ${documentType === type ? 'border-emerald-700 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-700/10' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{type === 'CNIC' ? 'Pakistani CNIC' : 'Passport'}</button>)}
              </div>
              <label className="flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 text-center hover:border-emerald-600 hover:bg-emerald-50/50">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-white text-emerald-800 shadow-sm"><UploadCloud size={21} /></span>
                <span className="mt-3 text-sm font-bold text-ink">{file ? file.name : 'Choose your identity document'}</span>
                <span className="mt-1 text-xs text-slate-500">JPG, PNG or PDF · up to 8 MB</span>
                <input type="file" accept="image/jpeg,image/png,application/pdf" className="sr-only" onChange={event => setFile(event.target.files?.[0] || null)} />
              </label>
              {error && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</p>}
              {success && <p role="status" className="flex items-start gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold leading-5 text-emerald-900"><CheckCircle2 className="mt-0.5 shrink-0" size={17} />{success}</p>}
              <div className="flex flex-col gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-center gap-2 text-xs text-slate-500"><FileCheck2 size={16} />Current status: <strong className="text-ink">{success ? 'PENDING' : session.user.kycStatus || 'NOT_SUBMITTED'}</strong></p>
                <div className="flex gap-3">
                  <Link href="/dashboard" className="rounded-xl px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-100">Later</Link>
                  <button disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-ink px-5 py-3 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-60">{busy ? 'Submitting securely…' : 'Submit for review'}<ArrowRight size={16} /></button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </ConsumerLayout>
    </>
  );
}
