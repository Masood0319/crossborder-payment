import Head from 'next/head';
import Link from 'next/link';
import { ArrowLeft, Pencil, Plus, Trash2, UserRound } from 'lucide-react';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';
import { ConsumerLayout } from '../components/ConsumerLayout.jsx';
import { useConsumerSession } from '../components/useConsumerSession.js';
import { addBeneficiary, deleteBeneficiary, getBeneficiaries, updateBeneficiary } from '../services/api.js';

const emptyBeneficiary = { fullName: '', iban: '', bic: '', bankName: '', country: 'AE' };

export default function BeneficiariesPage() {
  const router = useRouter();
  const { session, ready } = useConsumerSession();
  const [beneficiaries, setBeneficiaries] = useState([]);
  const [form, setForm] = useState(emptyBeneficiary);
  const [editingId, setEditingId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadBeneficiaries = useCallback(async () => {
    try {
      const result = await getBeneficiaries();
      setBeneficiaries(result.beneficiaries);
      setError('');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready && !session) router.replace('/login');
    if (ready && session) loadBeneficiaries();
  }, [ready, session, router, loadBeneficiaries]);

  const resetForm = () => {
    setEditingId('');
    setForm(emptyBeneficiary);
    setShowForm(false);
  };

  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (editingId) {
        await updateBeneficiary(editingId, form);
        setNotice('Recipient details updated. Bank account ownership is not verified.');
      } else {
        await addBeneficiary(form);
        setNotice('Recipient added. Bank account ownership is not verified.');
      }
      resetForm();
      await loadBeneficiaries();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const beginEdit = beneficiary => {
    setEditingId(beneficiary.id);
    setForm({
      fullName: beneficiary.fullName,
      iban: beneficiary.iban,
      bic: beneficiary.bic,
      bankName: beneficiary.bankName,
      country: beneficiary.country,
    });
    setShowForm(true);
    setError('');
    setNotice('');
  };

  const remove = async beneficiary => {
    if (!window.confirm(`Remove ${beneficiary.fullName} from your saved recipients?`)) return;
    setBusyId(beneficiary.id);
    setError('');
    setNotice('');
    try {
      await deleteBeneficiary(beneficiary.id);
      setNotice('Recipient removed.');
      await loadBeneficiaries();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyId('');
    }
  };

  if (!ready || !session) {
    return <main className="grid min-h-screen place-items-center text-sm font-semibold text-slate-500">Loading recipients…</main>;
  }

  return (
    <>
      <Head><title>Recipients · KitePay</title></Head>
      <ConsumerLayout active="Recipients">
        <div className="mx-auto max-w-4xl space-y-6">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-ink"><ArrowLeft size={16} />Wallet overview</Link>
              <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-ink">Saved recipients</h1>
              <p className="mt-2 text-sm text-slate-500">Manage bank details for your simulated transfers.</p>
            </div>
            <button type="button" onClick={() => { resetForm(); setShowForm(true); }} className="inline-flex items-center justify-center gap-2 rounded-xl bg-ink px-4 py-3 text-sm font-bold text-white hover:bg-slate-700"><Plus size={17} />Add recipient</button>
          </div>

          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
            Bank details are checked for format only. Account ownership is not verified. Recipients with transfer history are locked to preserve historical records.
          </p>
          {error && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</p>}
          {notice && <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">{notice}</p>}

          {showForm && <form onSubmit={submit} className="space-y-4 rounded-2xl bg-white p-5 shadow-card ring-1 ring-slate-200 sm:p-6">
            <div><h2 className="text-lg font-extrabold text-ink">{editingId ? 'Edit recipient' : 'Add recipient'}</h2><p className="mt-1 text-xs text-slate-500">IBAN and BIC format will be validated by the server.</p></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" name="fullName" value={form.fullName} onChange={value => setForm(current => ({ ...current, fullName: value }))} required />
              <Field label="Bank name" name="bankName" value={form.bankName} onChange={value => setForm(current => ({ ...current, bankName: value }))} required />
              <Field label="IBAN" name="iban" value={form.iban} onChange={value => setForm(current => ({ ...current, iban: value.toUpperCase() }))} required autoComplete="off" />
              <Field label="BIC / SWIFT" name="bic" value={form.bic} onChange={value => setForm(current => ({ ...current, bic: value.toUpperCase() }))} required autoComplete="off" />
              <label className="block"><span className="text-sm font-bold text-slate-700">Country</span><select value={form.country} onChange={event => setForm(current => ({ ...current, country: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm"><option value="AE">United Arab Emirates (AED)</option><option value="SA">Saudi Arabia (SAR)</option></select></label>
            </div>
            <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
              <button type="button" onClick={resetForm} className="rounded-xl px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-100">Cancel</button>
              <button type="submit" disabled={busy} className="rounded-xl bg-ink px-5 py-3 text-sm font-extrabold text-white disabled:opacity-60">{busy ? 'Saving…' : editingId ? 'Save changes' : 'Add recipient'}</button>
            </div>
          </form>}

          <section className="space-y-3">
            {loading ? <p className="rounded-xl bg-white p-8 text-center text-sm font-semibold text-slate-500">Loading saved recipients…</p>
              : beneficiaries.length === 0 ? <div className="rounded-2xl bg-white p-10 text-center shadow-card ring-1 ring-slate-200"><UserRound className="mx-auto text-slate-400" size={28} /><h2 className="mt-3 font-extrabold text-ink">No saved recipients yet</h2><p className="mt-2 text-sm text-slate-500">Add a recipient to prepare a simulated transfer.</p></div>
                : beneficiaries.map(beneficiary => <article key={beneficiary.id} className="flex flex-col gap-4 rounded-2xl bg-white p-5 shadow-card ring-1 ring-slate-200 sm:flex-row sm:items-center">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-800"><UserRound size={20} /></span>
                  <div className="min-w-0 flex-1"><h2 className="font-extrabold text-ink">{beneficiary.fullName}</h2><p className="mt-1 text-sm text-slate-600">{beneficiary.bankName} · {beneficiary.country}</p><p className="mt-1 font-mono text-xs text-slate-500">{beneficiary.iban.slice(0, 4)}••••{beneficiary.iban.slice(-4)} · {beneficiary.bic}</p><p className="mt-1 text-xs text-amber-700">{beneficiary.verificationStatus.replaceAll('_', ' ')} · ownership not verified</p></div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => beginEdit(beneficiary)} aria-label={`Edit ${beneficiary.fullName}`} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"><Pencil size={15} />Edit</button>
                    <button type="button" disabled={busyId === beneficiary.id} onClick={() => remove(beneficiary)} aria-label={`Remove ${beneficiary.fullName}`} className="inline-flex items-center gap-2 rounded-xl border border-rose-200 px-3 py-2.5 text-sm font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50"><Trash2 size={15} />Remove</button>
                  </div>
                </article>)}
          </section>
        </div>
      </ConsumerLayout>
    </>
  );
}

function Field({ label, name, value, onChange, ...props }) {
  return <label className="block"><span className="text-sm font-bold text-slate-700">{label}</span><input name={name} value={value} onChange={event => onChange(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10" {...props} /></label>;
}
