import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { AlertTriangle, Check, Send, Sparkles } from "lucide-react";
import { buildGeminiBudgetSetupPayload, type GeminiBudgetSetupReport, type GeminiFirstCycleBudgetItem } from "../../domain/ai/geminiBudgetSetup";
import type { BudgetCoachInput } from "../../domain/budgets/budgetCoach";
import type { BluehourSnapshot, IsoDate } from "../../domain/types";
import { Amount } from "../../ui/Amount";
import { DEFAULT_GEMINI_CYCLE_REPORT_MODEL } from "../../data/gemini/geminiCycleReportClient";
import { generateGeminiBudgetSetup } from "../../data/gemini/geminiBudgetSetupClient";

export function GeminiBudgetSetupPanel({
  snapshot,
  input,
  asOfDate,
  onAcceptBudget
}: {
  snapshot: BluehourSnapshot;
  input: BudgetCoachInput | null;
  asOfDate: IsoDate;
  onAcceptBudget: (items: GeminiFirstCycleBudgetItem[], model: string) => Promise<void>;
}) {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(DEFAULT_GEMINI_CYCLE_REPORT_MODEL);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<GeminiBudgetSetupReport | null>(null);
  const payload = useMemo(() => (input ? buildGeminiBudgetSetupPayload(snapshot, input, asOfDate) : null), [asOfDate, input, snapshot]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!payload) {
      setError("Add a main salary estimate before using Gemini for setup.");
      return;
    }
    if (!consent) {
      setError("Confirm approval before sending live setup data to Gemini.");
      return;
    }

    setBusy(true);
    setError(null);
    setStatus("Sending setup data to Gemini...");
    try {
      const nextReport = await generateGeminiBudgetSetup({ apiKey, model, payload });
      setReport(nextReport);
      setStatus("Gemini setup proposal received. Review it before accepting the first-cycle template.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Gemini setup helper failed.");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  async function acceptBudget() {
    if (!report || report.firstCycleBudget.length === 0) {
      return;
    }
    await onAcceptBudget(report.firstCycleBudget, model.trim() || DEFAULT_GEMINI_CYCLE_REPORT_MODEL);
    setStatus("Gemini first-cycle budget template accepted.");
  }

  return (
    <section className="dashboard-band gemini-report-panel">
      <div className="band-header">
        <div>
          <p className="eyebrow">Gemini</p>
          <h2>AI first-cycle budget setup</h2>
        </div>
        <Sparkles size={20} aria-hidden="true" />
      </div>

      <p className="form-note">
        This sends redacted onboarding setup data to Gemini for a first salary-cycle envelope proposal. The API key stays in this tab session.
      </p>
      <p className="form-note danger-text">
        Gemini proposals are educational budgeting guidance only. They do not create budget records until you accept the template and start the first salary cycle.
      </p>

      {payload ? (
        <div className="gemini-payload-summary" aria-label="Gemini setup payload summary">
          <GeminiSummary label="Salary estimate" value={<Amount value={payload.setup.salaryMinor} />} />
          <GeminiSummary label="Accounts" value={String(payload.accounts.length)} />
          <GeminiSummary label="Commitments" value={String(payload.knownCommitments.length)} />
          <GeminiSummary label="Envelope categories" value={String(payload.categories.filter((category) => category.reservationMode === "envelope").length)} />
        </div>
      ) : (
        <div className="alert-band danger">Add a main salary estimate before using Gemini for budget setup.</div>
      )}

      <form className="form-grid" onSubmit={submit}>
        <label className="span-2">
          Gemini API key
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            autoComplete="off"
            disabled={busy || !payload}
            required
          />
        </label>
        <label>
          Model
          <input value={model} onChange={(event) => setModel(event.target.value)} disabled={busy || !payload} required />
        </label>
        <label className="checkbox-label span-3">
          <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} disabled={busy || !payload} />
          I approve sending this live setup's redacted salary, account, planned obligation, category, and preference data to Gemini.
        </label>
        {error ? (
          <p className="form-error span-3">
            <AlertTriangle size={16} aria-hidden="true" />
            {error}
          </p>
        ) : null}
        {status ? <p className="form-note span-3">{status}</p> : null}
        <div className="form-actions span-3">
          <button className="primary-action" type="submit" disabled={busy || !payload || !consent || !apiKey.trim()}>
            <Send size={16} aria-hidden="true" />
            {busy ? "Generating..." : "Generate setup proposal"}
          </button>
        </div>
      </form>

      {report ? (
        <div className="gemini-report-output">
          <section className="coach-section">
            <div className="band-header compact">
              <div>
                <p className="eyebrow">Proposal</p>
                <h3>{report.reportTitle}</h3>
              </div>
            </div>
            <p>{report.executiveSummary}</p>
          </section>

          <section className="coach-section">
            <div className="band-header compact">
              <div>
                <p className="eyebrow">First cycle</p>
                <h3>Envelope template</h3>
              </div>
            </div>
            <div className="data-table gemini-budget-table" role="region" aria-label="Gemini first-cycle budget proposal">
              <div className="data-row header">
                <span>Category</span>
                <span>Amount</span>
                <span>Priority</span>
                <span>Confidence</span>
                <span>Rationale</span>
              </div>
              {report.firstCycleBudget.map((item) => (
                <div className="data-row" key={item.categoryId}>
                  <span>
                    <strong>{item.categoryName}</strong>
                    {item.warnings.length > 0 ? <small>{item.warnings.join(" ")}</small> : null}
                  </span>
                  <Amount value={item.amountMinor} />
                  <span>{item.priority}</span>
                  <span>{item.confidence}</span>
                  <span>{item.rationale}</span>
                </div>
              ))}
            </div>
            {report.riskFlags.length > 0 ? (
              <div className="alert-band danger">
                <AlertTriangle size={18} aria-hidden="true" />
                <span>{report.riskFlags.join(" ")}</span>
              </div>
            ) : null}
            <div className="checklist">
              {report.actionPlan.map((item) => (
                <div className="check-item" key={item}>
                  <Check size={16} aria-hidden="true" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
            <p className="form-note">{report.disclaimer}</p>
            <div className="form-actions">
              <button className="primary-action" type="button" onClick={() => void acceptBudget()} disabled={report.firstCycleBudget.length === 0}>
                <Check size={16} aria-hidden="true" />
                Accept Gemini setup template
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function GeminiSummary({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}
