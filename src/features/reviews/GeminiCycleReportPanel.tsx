import { useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, Check, Send, Sparkles, X } from "lucide-react";
import { buildGeminiCycleReportPayload, type GeminiCycleReport, type GeminiNextCycleBudgetItem } from "../../domain/ai/geminiCycleReport";
import { formatDisplayDate } from "../../domain/dates";
import type { BluehourSnapshot, BudgetCycle, IsoDate } from "../../domain/types";
import { Amount } from "../../ui/Amount";
import { DEFAULT_GEMINI_CYCLE_REPORT_MODEL, generateGeminiCycleReport } from "../../data/gemini/geminiCycleReportClient";

export interface SelectedGeminiNextBudgetPlan {
  model: string;
  selectedAt: string;
  recommendations: GeminiNextCycleBudgetItem[];
}

export function GeminiCycleReportPanel({
  snapshot,
  cycle,
  asOfDate,
  isDemo,
  selectedPlan,
  onSelectNextBudget,
  onClearNextBudget
}: {
  snapshot: BluehourSnapshot;
  cycle: BudgetCycle;
  asOfDate: IsoDate;
  isDemo: boolean;
  selectedPlan: SelectedGeminiNextBudgetPlan | null;
  onSelectNextBudget: (plan: SelectedGeminiNextBudgetPlan) => void;
  onClearNextBudget: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(DEFAULT_GEMINI_CYCLE_REPORT_MODEL);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<GeminiCycleReport | null>(null);
  const payload = useMemo(() => buildGeminiCycleReportPayload(snapshot, cycle, asOfDate), [asOfDate, cycle, snapshot]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (isDemo) {
      setError("Gemini reports are disabled for the fictional demonstration profile.");
      return;
    }
    if (!consent) {
      setError("Confirm approval before sending live profile data to Gemini.");
      return;
    }

    setBusy(true);
    setError(null);
    setStatus("Sending cycle data to Gemini...");
    try {
      const nextReport = await generateGeminiCycleReport({ apiKey, model, payload });
      setReport(nextReport);
      setStatus("Gemini report received. Review the proposal before selecting it for cycle close.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Gemini report failed.");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  function selectPlan() {
    if (!report || report.nextCycleBudget.length === 0) {
      return;
    }
    onSelectNextBudget({
      model: model.trim() || DEFAULT_GEMINI_CYCLE_REPORT_MODEL,
      selectedAt: new Date().toISOString(),
      recommendations: report.nextCycleBudget
    });
    setStatus("Gemini next-cycle budget selected. It will be applied only when you close the salary cycle.");
  }

  return (
    <section className="dashboard-band gemini-report-panel">
      <div className="band-header">
        <div>
          <p className="eyebrow">Gemini</p>
          <h2>Cycle report and next-cycle budget</h2>
        </div>
        <Sparkles size={20} aria-hidden="true" />
      </div>

      <p className="form-note">
        This sends a redacted copy of this salary cycle to Gemini for an educational budgeting report. The API key stays in this tab session.
      </p>
      <p className="form-note danger-text">
        Do not use this as investment, tax, legal, credit, or regulated financial advice. Bluehour will not apply the proposal until you approve it during cycle close.
      </p>

      {isDemo ? <div className="alert-band danger">Gemini reports are disabled for the fictional demonstration profile.</div> : null}
      {selectedPlan ? (
        <div className="alert-band">
          <Check size={18} aria-hidden="true" />
          <span>
            Gemini proposal selected for next cycle close: {selectedPlan.recommendations.length} allocation
            {selectedPlan.recommendations.length === 1 ? "" : "s"} from {selectedPlan.model}.
          </span>
          <button className="secondary-action" type="button" onClick={onClearNextBudget}>
            <X size={15} aria-hidden="true" />
            Clear
          </button>
        </div>
      ) : null}

      <div className="gemini-payload-summary" aria-label="Gemini payload summary">
        <GeminiSummary label="Cycle" value={`${formatDisplayDate(payload.cycle.startedOn)} to ${formatDisplayDate(payload.cycle.endedOn)}`} />
        <GeminiSummary label="Transactions" value={String(payload.transactions.length)} />
        <GeminiSummary label="Budget categories" value={String(payload.budgetProgress.length)} />
        <GeminiSummary label="Planned items" value={String(payload.plannedItems.length)} />
      </div>

      <form className="form-grid" onSubmit={submit}>
        <label className="span-2">
          Gemini API key
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            autoComplete="off"
            disabled={busy || isDemo}
            required
          />
        </label>
        <label>
          Model
          <input value={model} onChange={(event) => setModel(event.target.value)} disabled={busy || isDemo} required />
        </label>
        <label className="checkbox-label span-3">
          <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} disabled={busy || isDemo} />
          I approve sending this live cycle's redacted transaction, budget, plan, subscription, and goal data to Gemini.
        </label>
        {error ? (
          <p className="form-error span-3">
            <AlertTriangle size={16} aria-hidden="true" />
            {error}
          </p>
        ) : null}
        {status ? <p className="form-note span-3">{status}</p> : null}
        <div className="form-actions span-3">
          <button className="primary-action" type="submit" disabled={busy || isDemo || !consent || !apiKey.trim()}>
            <Send size={16} aria-hidden="true" />
            {busy ? "Generating..." : "Generate Gemini report"}
          </button>
        </div>
      </form>

      {report ? (
        <div className="gemini-report-output">
          <section className="coach-section">
            <div className="band-header compact">
              <div>
                <p className="eyebrow">Report</p>
                <h3>{report.reportTitle}</h3>
              </div>
            </div>
            <p>{report.executiveSummary}</p>
            <div className="checklist">
              {report.currentCycleAnalysis.map((item) => (
                <div className="check-item" key={item}>
                  <Check size={16} aria-hidden="true" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="coach-section">
            <div className="band-header compact">
              <div>
                <p className="eyebrow">Savings</p>
                <h3>Advice and reductions</h3>
              </div>
            </div>
            <div className="coach-grid">
              {report.savingAdvice.map((advice) => (
                <div className="coach-card" key={`${advice.title}-${advice.categoryId ?? "general"}`}>
                  <strong>{advice.title}</strong>
                  <small>{advice.rationale}</small>
                  <span>
                    Estimated saving <Amount value={advice.estimatedSavingMinor} />
                  </span>
                </div>
              ))}
              {report.reductions.map((item) => (
                <div className="coach-card" key={item.categoryId}>
                  <strong>{item.categoryName}</strong>
                  <small>{item.rationale}</small>
                  <span>
                    Next cycle <Amount value={item.recommendedNextCycleMinor} />
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="coach-section">
            <div className="band-header compact">
              <div>
                <p className="eyebrow">Next cycle</p>
                <h3>Proposed allocation template</h3>
              </div>
            </div>
            <div className="data-table gemini-budget-table" role="region" aria-label="Gemini next-cycle budget proposal">
              <div className="data-row header">
                <span>Category</span>
                <span>Amount</span>
                <span>Priority</span>
                <span>Confidence</span>
                <span>Rationale</span>
              </div>
              {report.nextCycleBudget.map((item) => (
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
              <button className="primary-action" type="button" onClick={selectPlan} disabled={report.nextCycleBudget.length === 0}>
                <Check size={16} aria-hidden="true" />
                Use for next cycle close
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function GeminiSummary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}
