import Head from 'next/head';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, FileText, LogOut, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Brand } from '../components/PublicSite.jsx';
import {
  clearStaffSession,
  fetchKycDocument,
  getKycApplicants,
  getKycReviewHistory,
  getStaffSession,
  reviewKycApplicant,
} from '../services/api.js';

const reviewerRoles = ['KYC_REVIEWER', 'KYC_ADMIN'];

export default function CompliancePage() {
  const [staffSession, setStaffSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [applicants, setApplicants] = useState([]);
  const [selected, setSelected] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [reason, setReason] = useState('');
  const [decision, setDecision] = useState('');
  const [documentUrl, setDocumentUrl] = useState('');
  const [documentType, setDocumentType] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const roles = staffSession?.user?.roles || [];
  const canAccess = roles.some(role => reviewerRoles.includes(role));
  const canReview = roles.includes('KYC_REVIEWER');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getKycApplicants();
      setApplicants(result.applicants || []);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setStaffSession(getStaffSession());
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready && canAccess) refresh();
    else if (ready) setLoading(false);
  }, [ready, canAccess, refresh]);

  useEffect(() => {
    let active = true;
    if (!selected) {
      setReviews([]);
      return () => { active = false; };
    }
    getKycReviewHistory(selected.id)
      .then(result => { if (active) setReviews(result.reviews || []); })
      .catch(requestError => { if (active) setError(requestError.message); });
    return () => { active = false; };
  }, [selected]);

  useEffect(() => () => {
    if (documentUrl) URL.revokeObjectURL(documentUrl);
  }, [documentUrl]);

  const openDocument = async document => {
    setError('');
    setDocumentUrl('');
    setDocumentType('');
    try {
      const blob = await fetchKycDocument(selected.id, document.id);
      setDocumentType(blob.type);
      setDocumentUrl(URL.createObjectURL(blob));
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const submitDecision = async event => {
    event.preventDefault();
    if (!selected || !decision || reason.trim().length < 3) {
      setError('Choose an outcome and provide a review reason of at least three characters.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await reviewKycApplicant(selected.id, decision, reason.trim());
      setNotice(`KYC application ${decision.toLowerCase()} with an attributed review event.`);
      setApplicants(current => current.filter(applicant => applicant.id !== selected.id));
      setReviews(current => result.review ? [...current, result.review] : current);
      setSelected(null);
      setReason('');
      setDecision('');
      setDocumentUrl('');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const signOut = () => {
    clearStaffSession();
    window.location.assign('/login');
  };

  if (!ready) return <Loading />;
  if (!staffSession || !canAccess) return <AccessDenied />;

  return (
    <>
      <Head><title>KYC operations · KitePay</title><meta name="description" content="Role-restricted KYC document review and attributed decisions." /></Head>
      <main className="min-h-screen bg-canvas">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
            <div className="flex items-center gap-4"><Brand /><span className="hidden border-l border-slate-200 pl-4 text-sm font-bold text-slate-500 sm:block">Compliance review</span></div>
            <div className="flex items-center gap-2"><Link href="/operations" className="rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Operations</Link><button type="button" onClick={signOut} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"><LogOut size={15} />Sign out</button></div>
          </div>
        </header>

        <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-8 sm:py-9">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div><p className="text-xs font-extrabold uppercase tracking-[.15em] text-emerald-800">Restricted staff workspace</p><h1 className="mt-2 text-3xl font-extrabold tracking-tight text-ink">Identity review queue</h1><p className="mt-2 text-sm text-slate-500">Review encrypted identity submissions and record a reasoned, staff-attributed decision.</p></div>
            <button type="button" onClick={refresh} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} />Refresh queue</button>
          </div>
          <div role="note" className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-950"><AlertCircle className="mt-0.5 shrink-0" size={18} /><p><strong>Review limitations:</strong> automated risk flags and authoritative sanctions screening are not available in this queue. Do not treat demo screening or document format checks as compliance clearance. Document contents are sensitive and access should be limited to the assigned reviewer.</p></div>
          {error && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</p>}
          {notice && <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">{notice}</p>}
          {!canReview && <p role="note" className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">Your KYC admin role can view applications and review history. Approve/reject decisions require the separate KYC reviewer role; correction endpoints are available only for previously finalized cases.</p>}

          <div className="grid gap-5 lg:grid-cols-[minmax(300px,.8fr)_minmax(0,1.3fr)]">
            <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="font-extrabold text-ink">Pending applications</h2><p className="mt-1 text-xs text-slate-500">Applicant status from the backend</p></div><span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-900">{applicants.length} pending</span></div>
              {loading ? <Loading /> : applicants.length ? <ul className="divide-y divide-slate-100">{applicants.map(applicant => <li key={applicant.id}><button type="button" onClick={() => { setSelected(applicant); setError(''); setDocumentUrl(''); }} className={`w-full px-5 py-4 text-left hover:bg-slate-50 ${selected?.id === applicant.id ? 'bg-emerald-50/60' : ''}`}><span className="flex items-center justify-between gap-2"><span className="font-bold text-ink">{applicant.fullName}</span><span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-extrabold text-amber-900">PENDING</span></span><span className="mt-1 block text-xs text-slate-500">{applicant.email}</span><span className="mt-2 block text-[10px] text-slate-400">{applicant.kycDocuments.length} document(s) · updated {new Date(applicant.updatedAt).toLocaleString()}</span></button></li>)}</ul> : <Empty title="No pending cases" detail="New applications will appear here after submission." />}
            </section>

            <section className="space-y-5">
              {selected ? (
                <>
                  <article className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
                    <div className="border-b border-slate-100 px-5 py-4"><div className="flex items-center justify-between gap-3"><h2 className="font-extrabold text-ink">Application review</h2><span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-extrabold text-amber-900">PENDING</span></div><p className="mt-1 text-xs text-slate-500">{selected.fullName} · {selected.email}</p><p className="mt-1 break-all font-mono text-[10px] text-slate-400">{selected.id}</p></div>
                    <div className="p-5">
                      <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">Submitted documents</h3>
                      {selected.kycDocuments.length ? <ul className="mt-3 space-y-2">{selected.kycDocuments.map(document => <li key={document.id} className="flex flex-col justify-between gap-2 rounded-xl border border-slate-200 p-3 sm:flex-row sm:items-center"><div className="flex min-w-0 items-center gap-3"><FileText className="shrink-0 text-emerald-800" size={18} /><div className="min-w-0"><p className="truncate text-sm font-bold text-ink">{document.documentType} · {document.fileName}</p><p className="text-[10px] text-slate-500">{new Date(document.createdAt).toLocaleString()}</p></div></div><button type="button" onClick={() => openDocument(document)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Securely view</button></li>)}</ul> : <p className="mt-3 text-sm text-slate-500">No document metadata available.</p>}
                      {documentUrl && <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="mb-2 flex items-center justify-between gap-2"><p className="text-xs font-bold text-slate-700">Sensitive document preview · do not share</p><button type="button" onClick={() => setDocumentUrl('')} className="text-xs font-bold text-slate-600 underline">Close</button></div>{documentType.startsWith('image/') ? <img src={documentUrl} alt="Applicant identity document" className="mx-auto max-h-[480px] max-w-full object-contain" /> : <iframe title="Applicant PDF document" src={documentUrl} className="h-[480px] w-full rounded-lg" />}</div>}
                    </div>
                    {canReview && <form onSubmit={submitDecision} className="space-y-3 border-t border-slate-100 p-5"><label className="block text-xs font-bold text-slate-700">Decision reason<textarea value={reason} onChange={event => setReason(event.target.value)} minLength={3} maxLength={1000} required rows={3} placeholder="Record the evidence-based reason for your decision" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" /></label><div className="flex flex-col gap-2 sm:flex-row"><button type="button" onClick={() => setDecision('APPROVED')} className={`flex-1 rounded-xl border px-4 py-3 text-sm font-bold ${decision === 'APPROVED' ? 'border-emerald-700 bg-emerald-50 text-emerald-900' : 'border-slate-200 text-slate-700'}`}>Approve</button><button type="button" onClick={() => setDecision('REJECTED')} className={`flex-1 rounded-xl border px-4 py-3 text-sm font-bold ${decision === 'REJECTED' ? 'border-rose-700 bg-rose-50 text-rose-900' : 'border-slate-200 text-slate-700'}`}>Reject</button><button disabled={busy || !decision || reason.trim().length < 3} className="flex-1 rounded-xl bg-ink px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Recording…' : 'Record decision'}</button></div><p className="text-[10px] leading-4 text-slate-500">Decisions are persisted with reviewer ID, issuer, previous status and reason. Existing cases cannot be silently reopened.</p></form>}
                  </article>
                  <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200"><h2 className="font-extrabold text-ink">Compliance review events</h2>{reviews.length ? <ol className="mt-3 space-y-3">{reviews.map(event => <li key={event.id} className="border-l-2 border-emerald-300 pl-3 text-xs"><p className="font-bold text-ink">{event.action} · {event.previousStatus || 'NEW'} → {event.decision}</p><p className="mt-1 leading-5 text-slate-600">{event.reason}</p><p className="mt-1 text-[10px] text-slate-400">{event.reviewerId} · {event.reviewerIssuer} · {new Date(event.createdAt).toLocaleString()}</p></li>)}</ol> : <p className="mt-2 text-xs text-slate-500">No prior review events recorded.</p>}</section>
                </>
              ) : <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200"><ShieldCheck className="mx-auto text-slate-400" size={25} /><p className="mt-3 font-bold text-ink">Select an application</p><p className="mt-1 text-sm text-slate-500">Review documents and attributable decisions are shown in this panel.</p></div>}
            </section>
          </div>
        </div>
      </main>
    </>
  );
}

function Empty({ title, detail }) {
  return <div className="px-5 py-10 text-center"><CheckCircle2 className="mx-auto text-emerald-600" size={22} /><p className="mt-2 text-sm font-bold text-ink">{title}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div>;
}

function Loading() {
  return <div className="grid min-h-32 place-items-center text-sm font-semibold text-slate-500"><span className="flex items-center gap-2"><RefreshCw className="animate-spin" size={16} />Loading compliance records…</span></div>;
}

function AccessDenied() {
  return <main className="grid min-h-screen place-items-center bg-canvas px-5"><section className="w-full max-w-lg rounded-3xl bg-white p-8 text-center shadow-card ring-1 ring-slate-200"><Brand /><span className="mx-auto mt-7 grid h-12 w-12 place-items-center rounded-xl bg-rose-50 text-rose-700"><XCircle size={23} /></span><h1 className="mt-4 text-2xl font-extrabold text-ink">KYC staff access required</h1><p className="mt-2 text-sm leading-6 text-slate-600">This queue is restricted to staff with an authorized KYC role. Staff identity is managed by the configured external provider.</p><Link href="/" className="mt-6 inline-flex rounded-xl bg-ink px-5 py-3 text-sm font-bold text-white">Return to home</Link></section></main>;
}
