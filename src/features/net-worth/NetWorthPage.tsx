import { useMemo, useState, type FormEvent } from "react";
import { Save } from "lucide-react";
import { useDemoData } from "../../app/providers/DemoDataProvider";
import { calculateAccountBalances, calculateNetWorth } from "../../domain/accounts/calculations";
import { formatDisplayDate } from "../../domain/dates";
import { parseMoneyInput } from "../../domain/money";
import { createRecordMeta } from "../../domain/records";
import type { Account, BalanceSnapshot } from "../../domain/types";
import { isActive } from "../../domain/types";
import { Amount } from "../../ui/Amount";

export function NetWorthPage() {
  const { snapshot, asOfDate, loading, error, saveRecord } = useDemoData();
  const [message, setMessage] = useState<string | null>(null);

  const balances = useMemo(
    () =>
      snapshot
        ? calculateAccountBalances(snapshot.accounts, snapshot.balanceSnapshots, snapshot.transactions, snapshot.transactionLegs, asOfDate)
        : [],
    [snapshot, asOfDate]
  );

  if (loading) {
    return <div className="loading-state">Opening net worth…</div>;
  }

  if (error || !snapshot) {
    return (
      <section className="empty-state">
        <h1>Net Worth</h1>
        <p>{error ?? "Net-worth data is unavailable."}</p>
      </section>
    );
  }

  const netWorth = calculateNetWorth(balances);
  const assets = balances.filter(({ account }) => account.role !== "liability").reduce((total, item) => total + item.balanceMinor, 0);
  const liabilities = balances.filter(({ account }) => account.role === "liability").reduce((total, item) => total + Math.abs(item.balanceMinor), 0);

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Manual valuation</p>
          <h1>Net Worth</h1>
        </div>
        <div className="date-chip">As of {formatDisplayDate(asOfDate)}</div>
      </div>

      {message ? <section className="alert-band">{message}</section> : null}

      <section className="metric-grid">
        <SummaryMetric label="Current net worth" value={netWorth} />
        <SummaryMetric label="Assets" value={assets} />
        <SummaryMetric label="Liabilities" value={liabilities} />
        <SummaryMetric label="Valuation accounts" value={balances.filter(({ account }) => account.trackingMode !== "ledger").length} count />
      </section>

      <ValuationForm
        accounts={snapshot.accounts.filter((account) => isActive(account) && account.trackingMode !== "ledger")}
        date={asOfDate}
        onSave={async (snapshotRecord) => {
          await saveRecord("balanceSnapshots", snapshotRecord, "valuation snapshot");
          setMessage("Valuation snapshot saved.");
        }}
      />

      <section className="dashboard-band">
        <div className="band-header">
          <div>
            <p className="eyebrow">Accounts</p>
            <h2>Asset and liability values</h2>
          </div>
        </div>
        <div className="data-table">
          <div className="data-row header">
            <span>Account</span>
            <span>Role</span>
            <span>Tracking</span>
            <span>Last snapshot</span>
            <span>Value</span>
          </div>
          {balances.map(({ account, balanceMinor, snapshot: balanceSnapshot }) => (
            <div className="data-row" key={account.id}>
              <span>
                <strong>{account.name}</strong>
                <small>{account.institutionLabel ?? "Manual"}</small>
              </span>
              <span>{account.role}</span>
              <span>{account.trackingMode}</span>
              <span>{balanceSnapshot ? formatDisplayDate(balanceSnapshot.asOfDate) : "None"}</span>
              <Amount value={balanceMinor} />
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function SummaryMetric({ label, value, count = false }: { label: string; value: number; count?: boolean }) {
  return (
    <div className="metric-card static">
      <span>{label}</span>
      {count ? <span className="metric-value">{value}</span> : <Amount value={value} className="metric-value" />}
    </div>
  );
}

function ValuationForm({
  accounts,
  date,
  onSave
}: {
  accounts: Account[];
  date: string;
  onSave: (snapshot: BalanceSnapshot) => Promise<void>;
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await onSave({
        ...createRecordMeta("bal"),
        accountId,
        asOfDate: date as BalanceSnapshot["asOfDate"],
        amountMinor: parseMoneyInput(amount),
        source: "manual_valuation",
        note: note || undefined
      });
      setAmount("");
      setNote("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save valuation");
    }
  }

  return (
    <section className="dashboard-band">
      <div className="band-header">
        <div>
          <p className="eyebrow">Snapshot</p>
          <h2>Update manual value</h2>
        </div>
      </div>
      <form className="form-grid" onSubmit={submit}>
        <label>
          Account
          <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Value
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" required />
        </label>
        <label className="span-2">
          Note
          <input value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        {error ? <p className="form-error span-3">{error}</p> : null}
        <div className="form-actions span-3">
          <button className="primary-action" type="submit">
            <Save size={16} aria-hidden="true" />
            Save valuation
          </button>
        </div>
      </form>
    </section>
  );
}
