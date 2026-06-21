import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Archive, FileDown, Plus, RotateCcw, Upload } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useBluehourData } from "../../app/providers/BluehourDataProvider";
import { findRuleProposals, matchesRule } from "../../domain/categorisation/rules";
import { formatDisplayDate } from "../../domain/dates";
import { detectDelimiter, hashText, parseCsv, parseCsvDate } from "../../domain/imports/csv";
import { scoreDuplicateMatch } from "../../domain/imports/duplicateMatching";
import { parseMoneyInput } from "../../domain/money";
import { createRecordMeta, touchRecord } from "../../domain/records";
import { createTransactionRecords, type SplitDraft, type TransactionDraft } from "../../domain/transactions/commands";
import type { CategorisationRule, ImportBatch, ImportProfile, RecordMeta, ReviewSession, Transaction, TransactionLeg, TransactionSplit } from "../../domain/types";
import { isActive } from "../../domain/types";
import { Amount } from "../../ui/Amount";
import type { LocalMutation } from "../../data/local-db/localDb";

const transactionTypes = ["expense", "income", "transfer", "refund", "reimbursement"] as const;

interface CsvImportOptions {
  accountId: string;
  fileName: string;
  dateFormat: ImportProfile["dateFormat"];
  mapping: {
    date: string;
    description: string;
    signedAmount?: string;
    debit?: string;
    credit?: string;
    reference?: string;
  };
}

export function TransactionsPage() {
  const { snapshot, asOfDate, loading, error, saveTransaction, saveRecords, archiveRecord } = useBluehourData();
  const [searchParams, setSearchParams] = useSearchParams();
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | Transaction["type"]>("all");
  const searchRef = useRef<HTMLInputElement>(null);

  const openComposer = searchParams.get("new") === "1";

  const allTransactions = useMemo(
    () =>
      [...(snapshot?.transactions ?? [])]
        .filter(isActive)
        .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.createdAt.localeCompare(a.createdAt)),
    [snapshot]
  );
  const transactions = useMemo(
    () =>
      allTransactions.filter((transaction) => {
        const matchesType = typeFilter === "all" || transaction.type === typeFilter;
        const matchesQuery = query.trim().length === 0 || transaction.description.toLowerCase().includes(query.trim().toLowerCase());
        return matchesType && matchesQuery;
      }),
    [allTransactions, query, typeFilter]
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "/" && event.target instanceof HTMLElement && !["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (loading) {
    return <div className="loading-state">Opening transactions…</div>;
  }

  if (error || !snapshot) {
    return (
      <section className="empty-state">
        <h1>Transactions</h1>
        <p>{error ?? "Transaction data is unavailable."}</p>
      </section>
    );
  }

  const loadedSnapshot = snapshot;
  const accountsById = new Map(snapshot.accounts.map((account) => [account.id, account]));
  const categoriesById = new Map(snapshot.categories.map((category) => [category.id, category]));
  const activeAccounts = snapshot.accounts.filter(isActive);
  const activeCategories = snapshot.categories.filter((category) => isActive(category) && category.active);

  async function handleImport(text: string, options: CsvImportOptions) {
    if (!snapshot) {
      return;
    }

    const delimiter = detectDelimiter(text);
    const parsed = parseCsv(text, delimiter);
    const profile: ImportProfile = {
      ...createRecordMeta("profile"),
      name: `CSV profile ${new Date().toLocaleDateString("en-MY")}`,
      accountId: options.accountId,
      delimiter,
      encoding: "utf-8",
      dateFormat: options.dateFormat,
      columnMappingJson: JSON.stringify(options.mapping),
      signRulesJson: JSON.stringify({ signedAmount: Boolean(options.mapping.signedAmount), debitIsExpense: true })
    };
    const batch: ImportBatch = {
      ...createRecordMeta("batch"),
      importProfileId: profile.id,
      fileName: options.fileName,
      fileHash: await hashText(text),
      importedAt: new Date().toISOString(),
      rowCount: parsed.rows.length,
      newCount: 0,
      matchedCount: 0,
      reviewCount: 0
    };

    const mutations: LocalMutation[] = [
      { storeName: "importProfiles", record: profile },
      { storeName: "importBatches", record: batch }
    ];
    const uncertainItems: Array<{ row: Record<string, string>; score: number; reasons: string[] }> = [];

    for (const row of parsed.rows) {
      const date = parseCsvDate(valueForColumn(row, options.mapping.date), options.dateFormat);
      const signedAmount = signedAmountFromCsvRow(row, options.mapping);
      const description = valueForColumn(row, options.mapping.description) || "Imported transaction";
      const reference = options.mapping.reference ? valueForColumn(row, options.mapping.reference) : "";
      const amountMinor = Math.abs(signedAmount);
      const type = signedAmount >= 0 ? "income" : "expense";
      const duplicate = allTransactions
        .map((transaction) =>
          scoreDuplicateMatch(
            {
              sourceReference: reference,
              accountId: options.accountId,
              amountMinor: signedAmount,
              occurredOn: date,
              description,
              importFingerprint: reference || undefined
            },
            {
              sourceReference: transaction.importFingerprint,
              accountId: options.accountId,
              amountMinor: signedAmountForTransaction(transaction),
              occurredOn: transaction.occurredOn,
              description: transaction.description,
              importFingerprint: transaction.importFingerprint
            }
          )
        )
        .sort((a, b) => b.score - a.score)[0];

      if (duplicate?.outcome === "strong") {
        batch.matchedCount += 1;
        continue;
      }

      if (duplicate?.outcome === "uncertain") {
        batch.reviewCount += 1;
        uncertainItems.push({ row, score: duplicate.score, reasons: duplicate.reasons });
        continue;
      }

      const result = createTransactionRecords(
        {
          type,
          occurredOn: date,
          description,
          amountMinor,
          accountId: options.accountId,
          categoryId: type === "income" ? "cat-income" : "cat-uncategorised",
          source: "csv_import",
          importBatchId: batch.id,
          importFingerprint: reference || `${date}-${description}-${signedAmount}`
        },
        snapshot
      );
      batch.newCount += 1;
      mutations.push({ storeName: "transactions", record: result.transaction });
      result.legs.forEach((record) => mutations.push({ storeName: "transactionLegs", record }));
      result.splits.forEach((record) => mutations.push({ storeName: "transactionSplits", record }));
      if (result.updatedRule) {
        mutations.push({ storeName: "categorisationRules", record: result.updatedRule });
      }
    }

    if (uncertainItems.length > 0) {
      const review: ReviewSession = {
        ...createRecordMeta("review"),
        type: "daily",
        periodKey: `csv:${batch.id}`,
        status: "open",
        itemsJson: JSON.stringify(uncertainItems)
      };
      mutations.push({ storeName: "reviewSessions", record: review });
    }

    mutations[1] = { storeName: "importBatches", record: batch };
    await saveRecords(mutations, "CSV import");
    setMessage(
      `Imported ${batch.newCount} new rows. ${batch.matchedCount} strong duplicates skipped. ${batch.reviewCount} uncertain matches saved for review.`
    );
  }

  function signedAmountForTransaction(transaction: Transaction): number {
    const splitTotal = snapshot?.transactionSplits
      .filter((split) => split.transactionId === transaction.id && isActive(split))
      .reduce((total, split) => {
        if (split.direction === "income" || split.direction === "reversal") {
          return total + split.amountMinor;
        }

        return total - split.amountMinor;
      }, 0);

    return splitTotal ?? 0;
  }

  async function rollbackImportBatch(batch: ImportBatch) {
    const importedTransactions = loadedSnapshot.transactions.filter((transaction) => transaction.importBatchId === batch.id && isActive(transaction));
    const transactionIds = new Set(importedTransactions.map((transaction) => transaction.id));
    const mutations: LocalMutation[] = [
      { storeName: "importBatches", record: archiveRecordValue(batch) }
    ];

    importedTransactions.forEach((transaction) => mutations.push({ storeName: "transactions", record: archiveRecordValue(transaction) }));
    loadedSnapshot.transactionLegs
      .filter((leg) => transactionIds.has(leg.transactionId) && isActive(leg))
      .forEach((leg) => mutations.push({ storeName: "transactionLegs", record: archiveRecordValue(leg) }));
    loadedSnapshot.transactionSplits
      .filter((split) => transactionIds.has(split.transactionId) && isActive(split))
      .forEach((split) => mutations.push({ storeName: "transactionSplits", record: archiveRecordValue(split) }));

    await saveRecords(mutations, "import rollback");
    setMessage(`Archived ${importedTransactions.length} imported transaction${importedTransactions.length === 1 ? "" : "s"} from ${batch.fileName}.`);
  }

  async function applyRuleToHistory(rule: CategorisationRule) {
    const mutations: LocalMutation[] = [];
    const reviewItems: Array<{ transactionId: string; description: string; existingCategoryIds: string[]; proposedCategoryId: string }> = [];
    let updatedSplitCount = 0;

    for (const transaction of loadedSnapshot.transactions.filter((record) => isActive(record) && record.type === "expense")) {
      const firstLeg = loadedSnapshot.transactionLegs.find((leg) => isActive(leg) && leg.transactionId === transaction.id);
      if (
        !matchesRule(
          {
            description: transaction.description,
            merchantNormalized: transaction.merchantNormalized,
            accountId: firstLeg?.accountId,
            amountMinor: Math.abs(signedAmountForTransaction(transaction))
          },
          rule
        )
      ) {
        continue;
      }

      const splits = loadedSnapshot.transactionSplits.filter((split) => isActive(split) && split.transactionId === transaction.id);
      const uncategorised = splits.filter((split) => split.categoryId === "cat-uncategorised");
      const conflicting = splits.filter((split) => split.categoryId !== "cat-uncategorised" && split.categoryId !== rule.categoryId);

      uncategorised.forEach((split) => {
        mutations.push({ storeName: "transactionSplits", record: { ...touchRecord(split), categoryId: rule.categoryId } });
        updatedSplitCount += 1;
      });

      if (conflicting.length > 0) {
        reviewItems.push({
          transactionId: transaction.id,
          description: transaction.description,
          existingCategoryIds: [...new Set(conflicting.map((split) => split.categoryId))],
          proposedCategoryId: rule.categoryId
        });
      }
    }

    if (updatedSplitCount > 0) {
      mutations.push({
        storeName: "categorisationRules",
        record: {
          ...touchRecord(rule),
          hitCount: rule.hitCount + updatedSplitCount,
          lastUsedAt: new Date().toISOString()
        }
      });
    }

    if (reviewItems.length > 0) {
      mutations.push({
        storeName: "reviewSessions",
        record: {
          ...createRecordMeta("review"),
          type: "daily",
          periodKey: `rule:${rule.id}`,
          status: "open",
          itemsJson: JSON.stringify(reviewItems)
        }
      });
    }

    if (mutations.length === 0) {
      setMessage("No matching historical uncategorised transactions were found.");
      return;
    }

    await saveRecords(mutations, "categorisation history");
    setMessage(`${updatedSplitCount} split${updatedSplitCount === 1 ? "" : "s"} updated. ${reviewItems.length} conflict${reviewItems.length === 1 ? "" : "s"} saved for review.`);
  }

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Ledger</p>
          <h1>Transactions</h1>
        </div>
        <button className="primary-action" type="button" onClick={() => setSearchParams({ new: "1" })}>
          <Plus size={18} aria-hidden="true" />
          <span>Transaction</span>
        </button>
      </div>

      {message ? <section className="alert-band">{message}</section> : null}

      {openComposer ? (
        <TransactionComposer
          accounts={activeAccounts}
          categories={activeCategories}
          transactions={transactions}
          defaultDate={asOfDate}
          onCancel={() => setSearchParams({})}
          onSave={async (draft) => {
            await saveTransaction(draft);
            setSearchParams({});
            setMessage("Transaction saved locally.");
          }}
        />
      ) : null}

      <CsvImportPanel accounts={activeAccounts} defaultDate={asOfDate} onImport={handleImport} />

      <section className="dashboard-band">
        <div className="filter-bar">
          <label>
            Search
            <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Description or merchant" />
          </label>
          <label>
            Type
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as "all" | Transaction["type"])}>
              <option value="all">All types</option>
              {["expense", "income", "transfer", "refund", "reimbursement", "reconciliation_adjustment", "opening_adjustment"].map((type) => (
                <option key={type} value={type}>
                  {type.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <RuleReviewPanel
        rules={snapshot.categorisationRules.filter(isActive)}
        transactions={allTransactions}
        transactionLegs={snapshot.transactionLegs.filter(isActive)}
        transactionSplits={snapshot.transactionSplits.filter(isActive)}
        categories={activeCategories}
        onSaveRule={async (rule) => {
          await saveRecords([{ storeName: "categorisationRules", record: rule }], "categorisation rule");
          setMessage("Categorisation rule saved for future transactions.");
        }}
        onApplyRule={applyRuleToHistory}
      />

      <ImportBatchPanel batches={snapshot.importBatches.filter(isActive)} onRollback={rollbackImportBatch} />

      <section className="dashboard-band">
        <div className="band-header">
          <div>
            <p className="eyebrow">Recent activity</p>
            <h2>Ledger records</h2>
          </div>
        </div>
        <div className="data-table" role="region" aria-label="Transactions">
          <div className="data-row header">
            <span>Date</span>
            <span>Description</span>
            <span>Account</span>
            <span>Category</span>
            <span>Amount</span>
            <span>Action</span>
          </div>
          {transactions.map((transaction) => {
            const legs = snapshot.transactionLegs.filter((leg) => leg.transactionId === transaction.id && isActive(leg));
            const splits = snapshot.transactionSplits.filter((split) => split.transactionId === transaction.id && isActive(split));
            const primaryLeg = legs[0];
            const amount = Math.abs(signedAmountForTransaction(transaction) || primaryLeg?.deltaMinor || 0);
            return (
              <div className="data-row" key={transaction.id}>
                <span>{formatDisplayDate(transaction.occurredOn)}</span>
                <span>
                  <strong>{transaction.description}</strong>
                  <small>{transaction.type.replaceAll("_", " ")}</small>
                </span>
                <span>{primaryLeg ? accountsById.get(primaryLeg.accountId)?.name : "Multiple"}</span>
                <span>{splits.map((split) => categoriesById.get(split.categoryId)?.name ?? split.categoryId).join(", ") || "Transfer"}</span>
                <Amount value={amount} />
                <button className="icon-button" type="button" aria-label={`Archive ${transaction.description}`} onClick={() => void archiveRecord("transactions", transaction.id)}>
                  <Archive size={16} aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

function archiveRecordValue<T extends RecordMeta>(record: T): T {
  const now = new Date().toISOString();
  return {
    ...record,
    archivedAt: now,
    updatedAt: now,
    revision: record.revision + 1
  };
}

function RuleReviewPanel({
  rules,
  transactions,
  transactionLegs,
  transactionSplits,
  categories,
  onSaveRule,
  onApplyRule
}: {
  rules: CategorisationRule[];
  transactions: Transaction[];
  transactionLegs: TransactionLeg[];
  transactionSplits: TransactionSplit[];
  categories: Array<{ id: string; name: string }>;
  onSaveRule: (rule: CategorisationRule) => Promise<void>;
  onApplyRule: (rule: CategorisationRule) => Promise<void>;
}) {
  const [proposalCategoryId, setProposalCategoryId] = useState(categories[0]?.id ?? "");
  const proposals = findRuleProposals(transactions).filter((proposal) =>
    !rules.some((rule) => rule.active && rule.operator === "contains" && rule.pattern.toLowerCase() === proposal.merchant.toLowerCase())
  );
  const nextPriority = Math.max(0, ...rules.map((rule) => rule.priority)) + 10;
  const transactionAmount = (transactionId: string) =>
    transactionSplits
      .filter((split) => split.transactionId === transactionId)
      .reduce((total, split) => total + split.amountMinor, 0);
  const historicalMatchCount = (rule: CategorisationRule) =>
    transactions.filter((transaction) => {
      const firstLeg = transactionLegs.find((leg) => leg.transactionId === transaction.id);
      return matchesRule(
        {
          description: transaction.description,
          merchantNormalized: transaction.merchantNormalized,
          accountId: firstLeg?.accountId,
          amountMinor: transactionAmount(transaction.id)
        },
        rule
      );
    }).length;

  return (
    <section className="dashboard-band">
      <div className="band-header">
        <div>
          <p className="eyebrow">Rules</p>
          <h2>Categorisation review</h2>
        </div>
      </div>
      <div className="data-table">
        <div className="data-row header">
          <span>Name</span>
          <span>Match</span>
          <span>Category</span>
          <span>Hits</span>
          <span>Status</span>
          <span>Action</span>
        </div>
        {rules.map((rule) => (
          <div className="data-row" key={rule.id}>
            <span>
              <strong>{rule.name}</strong>
              <small>priority {rule.priority}</small>
            </span>
            <span>
              {rule.operator} · {rule.pattern}
            </span>
            <span>{categories.find((category) => category.id === rule.categoryId)?.name ?? rule.categoryId}</span>
            <span>{rule.hitCount}</span>
            <span>{rule.active ? "active" : "disabled"}</span>
            <span className="inline-actions">
              <button className="secondary-action" type="button" onClick={() => void onApplyRule(rule)}>
                Apply to {historicalMatchCount(rule)}
              </button>
              <button
                className="secondary-action"
                type="button"
                onClick={() => void onSaveRule({ ...touchRecord(rule), active: !rule.active })}
              >
                {rule.active ? "Disable" : "Enable"}
              </button>
            </span>
          </div>
        ))}
      </div>
      {proposals.length > 0 ? (
        <div className="stack-list rule-proposals">
          {proposals.map((proposal) => (
            <div className="stack-row" key={proposal.merchant}>
              <span>
                <strong>{proposal.merchant}</strong>
                <small>{proposal.count} similar transactions</small>
              </span>
              <select value={proposalCategoryId} onChange={(event) => setProposalCategoryId(event.target.value)}>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              <button
                className="primary-action"
                type="button"
                onClick={() =>
                  void onSaveRule({
                    ...createRecordMeta("rule"),
                    name: `${proposal.merchant} rule`,
                    priority: nextPriority,
                    matchField: "description",
                    operator: "contains",
                    pattern: proposal.merchant,
                    categoryId: proposalCategoryId,
                    autoApply: true,
                    active: true,
                    hitCount: 0
                  })
                }
              >
                Approve rule
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ImportBatchPanel({ batches, onRollback }: { batches: ImportBatch[]; onRollback: (batch: ImportBatch) => Promise<void> }) {
  if (batches.length === 0) {
    return null;
  }

  return (
    <section className="dashboard-band">
      <div className="band-header">
        <div>
          <p className="eyebrow">Imports</p>
          <h2>Import batches</h2>
        </div>
      </div>
      <div className="data-table">
        <div className="data-row header">
          <span>File</span>
          <span>Imported</span>
          <span>Rows</span>
          <span>New</span>
          <span>Review</span>
          <span>Action</span>
        </div>
        {batches.map((batch) => (
          <div className="data-row" key={batch.id}>
            <span>
              <strong>{batch.fileName}</strong>
              <small>{batch.fileHash.slice(0, 12)}</small>
            </span>
            <span>{new Date(batch.importedAt).toLocaleString("en-MY")}</span>
            <span>{batch.rowCount}</span>
            <span>{batch.newCount}</span>
            <span>{batch.reviewCount}</span>
            <button className="secondary-action" type="button" onClick={() => void onRollback(batch)}>
              Roll back
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function TransactionComposer({
  accounts,
  categories,
  transactions,
  defaultDate,
  onCancel,
  onSave
}: {
  accounts: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string; nature: string }>;
  transactions: Transaction[];
  defaultDate: string;
  onCancel: () => void;
  onSave: (draft: TransactionDraft) => Promise<void>;
}) {
  const [type, setType] = useState<TransactionDraft["type"]>("expense");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [toAccountId, setToAccountId] = useState(accounts[1]?.id ?? accounts[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState(categories.find((category) => category.nature !== "administrative")?.id ?? categories[0]?.id ?? "");
  const [occurredOn, setOccurredOn] = useState(defaultDate);
  const [refundOfTransactionId, setRefundOfTransactionId] = useState("");
  const [note, setNote] = useState("");
  const [splits, setSplits] = useState<SplitDraft[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await onSave({
        type,
        occurredOn: occurredOn as TransactionDraft["occurredOn"],
        description,
        amountMinor: parseMoneyInput(amount),
        accountId,
        toAccountId: type === "transfer" ? toAccountId : undefined,
        categoryId: type === "transfer" || splits.length > 0 ? undefined : categoryId,
        splits: splits.length > 0 ? splits : undefined,
        refundOfTransactionId: refundOfTransactionId || undefined,
        note
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save transaction");
    }
  }

  const parsedAmount = amount ? parseMoneyInputSafe(amount) : 0;
  const splitTotal = splits.reduce((total, split) => total + split.amountMinor, 0);
  const splitRemainder = Math.max(0, parsedAmount - splitTotal);

  return (
    <section className="dashboard-band">
      <div className="band-header">
        <div>
          <p className="eyebrow">Quick entry</p>
          <h2>New transaction</h2>
        </div>
      </div>
      <form className="form-grid" onSubmit={submit}>
        <label>
          Type
          <select value={type} onChange={(event) => setType(event.target.value as TransactionDraft["type"])}>
            {transactionTypes.map((item) => (
              <option key={item} value={item}>
                {item.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="span-2">
          Description
          <input value={description} onChange={(event) => setDescription(event.target.value)} required />
        </label>
        <label>
          Amount
          <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="RM42.00" required />
        </label>
        <label>
          Date
          <input type="date" value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} required />
        </label>
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
        {type === "transfer" ? (
          <label>
            To account
            <select value={toAccountId} onChange={(event) => setToAccountId(event.target.value)}>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label>
            Category
            <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {type === "refund" || type === "reimbursement" ? (
          <label>
            Original transaction
            <select value={refundOfTransactionId} onChange={(event) => setRefundOfTransactionId(event.target.value)}>
              <option value="">Not linked</option>
              {transactions
                .filter((transaction) => transaction.type === "expense")
                .slice(0, 20)
                .map((transaction) => (
                  <option key={transaction.id} value={transaction.id}>
                    {transaction.description}
                  </option>
                ))}
            </select>
          </label>
        ) : null}
        <label className="span-3">
          Note
          <input value={note} onChange={(event) => setNote(event.target.value)} />
        </label>

        {type !== "transfer" ? (
          <div className="span-3 split-box">
            <div className="inline-heading">
              <strong>Splits</strong>
              <button
                type="button"
                className="secondary-action"
                onClick={() => setSplits((current) => [...current, { categoryId, amountMinor: splitRemainder }])}
              >
                Add split
              </button>
            </div>
            {splits.map((split, index) => (
              <div className="split-row" key={`${split.categoryId}-${index}`}>
                <select
                  value={split.categoryId}
                  onChange={(event) =>
                    setSplits((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, categoryId: event.target.value } : item)))
                  }
                >
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
                <input
                  inputMode="decimal"
                  value={(split.amountMinor / 100).toFixed(2)}
                  onChange={(event) =>
                    setSplits((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, amountMinor: parseMoneyInputSafe(event.target.value) } : item
                      )
                    )
                  }
                />
                <button className="icon-button" type="button" aria-label="Remove split" onClick={() => setSplits((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                  <RotateCcw size={15} aria-hidden="true" />
                </button>
              </div>
            ))}
            {splits.length > 0 ? <small>Remainder: RM{(splitRemainder / 100).toFixed(2)}</small> : null}
          </div>
        ) : null}

        {error ? <p className="form-error span-3">{error}</p> : null}
        <div className="form-actions span-3">
          <button type="button" className="secondary-action" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary-action">
            Save
          </button>
        </div>
      </form>
    </section>
  );
}

function CsvImportPanel({
  accounts,
  defaultDate,
  onImport
}: {
  accounts: Array<{ id: string; name: string }>;
  defaultDate: string;
  onImport: (text: string, options: CsvImportOptions) => Promise<void>;
}) {
  const [text, setText] = useState(`date,description,amount,reference\n${defaultDate},Example Grocer,-12.30,SAMPLE-001`);
  const [fileName, setFileName] = useState("Manual paste");
  const [encodingConfirmed, setEncodingConfirmed] = useState(true);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const parsed = useMemo(() => parseCsv(text), [text]);
  const firstHeader = parsed.headers[0] ?? "";
  const [dateColumn, setDateColumn] = useState("date");
  const [descriptionColumn, setDescriptionColumn] = useState("description");
  const [signedAmountColumn, setSignedAmountColumn] = useState("amount");
  const [debitColumn, setDebitColumn] = useState("");
  const [creditColumn, setCreditColumn] = useState("");
  const [referenceColumn, setReferenceColumn] = useState("reference");
  const [dateFormat, setDateFormat] = useState<ImportProfile["dateFormat"]>("YYYY-MM-DD");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      if (!encodingConfirmed) {
        throw new Error("Confirm the CSV is UTF-8 before importing");
      }
      await onImport(text, {
        accountId,
        fileName,
        dateFormat,
        mapping: {
          date: dateColumn || firstHeader,
          description: descriptionColumn || firstHeader,
          signedAmount: signedAmountColumn || undefined,
          debit: debitColumn || undefined,
          credit: creditColumn || undefined,
          reference: referenceColumn || undefined
        }
      });
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "CSV import failed");
    }
  }

  async function loadFile(file: File | undefined) {
    if (!file) {
      return;
    }

    setError(null);
    try {
      setText(await file.text());
      setFileName(file.name);
      setEncodingConfirmed(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not read CSV file");
    }
  }

  return (
    <section className="dashboard-band">
      <div className="band-header">
        <div>
          <p className="eyebrow">CSV import</p>
          <h2>Bank or wallet rows</h2>
        </div>
        <button className="secondary-action" type="button" onClick={() => setOpen((current) => !current)}>
          <Upload size={16} aria-hidden="true" />
          Import
        </button>
      </div>
      {open ? (
        <form className="form-grid" onSubmit={submit}>
          <label className="span-2">
            CSV file
            <input type="file" accept=".csv,text/csv,text/plain" onChange={(event) => void loadFile(event.target.files?.[0])} />
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={encodingConfirmed} onChange={(event) => setEncodingConfirmed(event.target.checked)} />
            UTF-8 confirmed
          </label>
          <label>
            Target account
            <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date format
            <select value={dateFormat} onChange={(event) => setDateFormat(event.target.value as ImportProfile["dateFormat"])}>
              <option value="YYYY-MM-DD">YYYY-MM-DD</option>
              <option value="DD/MM/YYYY">DD/MM/YYYY</option>
            </select>
          </label>
          <label>
            Date column
            <ColumnSelect headers={parsed.headers} value={dateColumn} onChange={setDateColumn} required />
          </label>
          <label>
            Description column
            <ColumnSelect headers={parsed.headers} value={descriptionColumn} onChange={setDescriptionColumn} required />
          </label>
          <label>
            Signed amount column
            <ColumnSelect headers={parsed.headers} value={signedAmountColumn} onChange={setSignedAmountColumn} />
          </label>
          <label>
            Debit column
            <ColumnSelect headers={parsed.headers} value={debitColumn} onChange={setDebitColumn} />
          </label>
          <label>
            Credit column
            <ColumnSelect headers={parsed.headers} value={creditColumn} onChange={setCreditColumn} />
          </label>
          <label>
            Reference column
            <ColumnSelect headers={parsed.headers} value={referenceColumn} onChange={setReferenceColumn} />
          </label>
          <label className="span-3">
            CSV rows · {fileName}
            <textarea
              rows={6}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setFileName("Manual paste");
              }}
            />
          </label>
          <p className="form-note span-3">{parsed.rows.length} row{parsed.rows.length === 1 ? "" : "s"} ready for local preview and duplicate analysis.</p>
          {error ? <p className="form-error span-3">{error}</p> : null}
          <div className="form-actions span-3">
            <button className="secondary-action" type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="primary-action" type="submit">
              <FileDown size={16} aria-hidden="true" />
              Analyse and import
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function ColumnSelect({
  headers,
  value,
  onChange,
  required = false
}: {
  headers: string[];
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} required={required}>
      <option value="">Not mapped</option>
      {headers.map((header) => (
        <option key={header} value={header}>
          {header}
        </option>
      ))}
    </select>
  );
}

function signedAmountFromCsvRow(row: Record<string, string>, mapping: CsvImportOptions["mapping"]): number {
  if (mapping.signedAmount) {
    return parseMoneyInput(valueForColumn(row, mapping.signedAmount));
  }

  const debit = mapping.debit ? Math.abs(parseMoneyInput(valueForColumn(row, mapping.debit) || "0")) : 0;
  const credit = mapping.credit ? Math.abs(parseMoneyInput(valueForColumn(row, mapping.credit) || "0")) : 0;
  if (debit === 0 && credit === 0) {
    throw new Error("Map either a signed amount column or debit/credit columns");
  }

  return credit - debit;
}

function valueForColumn(row: Record<string, string>, column: string): string {
  return row[column] ?? "";
}

function parseMoneyInputSafe(value: string): number {
  try {
    return parseMoneyInput(value);
  } catch {
    return 0;
  }
}
