import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Archive, FileDown, Pencil, Plus, RotateCcw, Upload } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useBluehourData } from "../../app/providers/BluehourDataProvider";
import { findRuleProposals, matchesRule } from "../../domain/categorisation/rules";
import { formatDisplayDate } from "../../domain/dates";
import {
  activeCycleForIncome,
  createExtraIncomeAllocation,
  linkProtectedExtraIncomeTransfer,
  updateExtraIncomeAllocation,
  type ExtraIncomeAllocationDraft
} from "../../domain/income/extraIncomeAllocation";
import { detectDelimiter, hashText, parseCsv, parseCsvDate } from "../../domain/imports/csv";
import {
  createImportRowAudit,
  fingerprintImportRow,
  markImportAuditRolledBack,
  type ImportAuditCandidate,
  type NormalisedImportRow
} from "../../domain/imports/importAudit";
import { rankDuplicateCandidates } from "../../domain/imports/importMatching";
import { parseMoneyInput } from "../../domain/money";
import { createRecordMeta, touchRecord } from "../../domain/records";
import { createTransactionRecords, editTransactionRecords, type SplitDraft, type TransactionDraft } from "../../domain/transactions/commands";
import type {
  BluehourSnapshot,
  CategorisationRule,
  ExtraIncomeAllocation,
  ImportBatch,
  ImportProfile,
  RecordMeta,
  Transaction,
  TransactionLeg,
  TransactionSplit
} from "../../domain/types";
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
  const [pendingExtraIncome, setPendingExtraIncome] = useState<{
    transactionId: string;
    amountMinor: number;
    budgetCycleId?: string;
  } | null>(null);
  const [pendingTransferLink, setPendingTransferLink] = useState<{
    transferTransactionId: string;
    allocationIds: string[];
  } | null>(null);
  const [editingExtraIncomeId, setEditingExtraIncomeId] = useState<string | null>(null);
  const [editingTransactionId, setEditingTransactionId] = useState<string | null>(null);
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
  const activeAccounts = snapshot.accounts.filter(isActive).sort((left, right) => left.sortOrder - right.sortOrder);
  const activeCategories = snapshot.categories.filter((category) => isActive(category) && category.active).sort((left, right) => left.sortOrder - right.sortOrder);
  const editableExtraIncomeAllocations = snapshot.extraIncomeAllocations
    .filter((allocation) => isActive(allocation) && allocation.status !== "completed")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const editingExtraIncome = editingExtraIncomeId ? editableExtraIncomeAllocations.find((allocation) => allocation.id === editingExtraIncomeId) : undefined;
  const editingTransaction = editingTransactionId ? allTransactions.find((transaction) => transaction.id === editingTransactionId) : undefined;

  async function handleImport(text: string, options: CsvImportOptions) {
    if (!snapshot) {
      return;
    }

    const delimiter = detectDelimiter(text);
    const parsed = parseCsv(text, delimiter);
    const fileHash = await hashText(text);
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
      fileHash,
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
    const workingSnapshot = {
      ...snapshot,
      transactions: [...snapshot.transactions],
      transactionLegs: [...snapshot.transactionLegs],
      transactionSplits: [...snapshot.transactionSplits]
    };

    for (const [rowIndex, row] of parsed.rows.entries()) {
      const date = parseCsvDate(valueForColumn(row, options.mapping.date), options.dateFormat);
      const signedAmount = signedAmountFromCsvRow(row, options.mapping);
      const description = valueForColumn(row, options.mapping.description) || "Imported transaction";
      const reference = options.mapping.reference ? valueForColumn(row, options.mapping.reference) : "";
      const amountMinor = Math.abs(signedAmount);
      const type = signedAmount >= 0 ? "income" : "expense";
      const normalisedRow: NormalisedImportRow = {
        importBatchId: batch.id,
        rowIndex,
        fileHash,
        occurredOn: date,
        description,
        signedAmountMinor: signedAmount,
        accountId: options.accountId,
        sourceReference: reference || undefined,
        rowFingerprint: fingerprintImportRow({
          fileHash,
          rowIndex,
          occurredOn: date,
          description,
          signedAmountMinor: signedAmount,
          sourceReference: reference || undefined
        })
      };
      const previousAudit = snapshot.importRowAudits.find(
        (audit) => audit.fileHash === fileHash && audit.rowFingerprint === normalisedRow.rowFingerprint && audit.linkedTransactionId
      );
      const candidates = rankDuplicateCandidates(
        {
          sourceReference: reference || undefined,
          accountId: options.accountId,
          signedAmountMinor: signedAmount,
          occurredOn: date,
          description,
          importFingerprint: reference || normalisedRow.rowFingerprint
        },
        workingSnapshot
      ).map(
        (candidate): ImportAuditCandidate => ({
          transactionId: candidate.transactionId,
          score: candidate.score,
          reasons: candidate.reasons
        })
      );
      const duplicate = candidates[0];

      if (previousAudit?.linkedTransactionId) {
        batch.matchedCount += 1;
        mutations.push({
          storeName: "importRowAudits",
          record: createImportRowAudit({
            row: normalisedRow,
            outcome: "strong_linked",
            candidates,
            linkedTransactionId: previousAudit.linkedTransactionId,
            decisionSource: "automatic"
          })
        });
        continue;
      }

      if (duplicate && duplicate.score >= 75) {
        batch.matchedCount += 1;
        mutations.push({
          storeName: "importRowAudits",
          record: createImportRowAudit({
            row: normalisedRow,
            outcome: "strong_linked",
            candidates,
            linkedTransactionId: duplicate.transactionId,
            decisionSource: "automatic"
          })
        });
        continue;
      }

      if (duplicate && duplicate.score >= 50) {
        batch.reviewCount += 1;
        mutations.push({
          storeName: "importRowAudits",
          record: createImportRowAudit({
            row: normalisedRow,
            outcome: "uncertain",
            candidates,
            decisionSource: "none"
          })
        });
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
          importFingerprint: normalisedRow.rowFingerprint
        },
        workingSnapshot
      );
      batch.newCount += 1;
      mutations.push({ storeName: "transactions", record: result.transaction });
      result.legs.forEach((record) => mutations.push({ storeName: "transactionLegs", record }));
      result.splits.forEach((record) => mutations.push({ storeName: "transactionSplits", record }));
      mutations.push({
        storeName: "importRowAudits",
        record: createImportRowAudit({
          row: normalisedRow,
          outcome: "created",
          candidates,
          linkedTransactionId: result.transaction.id,
          decisionSource: "automatic"
        })
      });
      workingSnapshot.transactions.push(result.transaction);
      workingSnapshot.transactionLegs.push(...result.legs);
      workingSnapshot.transactionSplits.push(...result.splits);
      if (result.updatedRule) {
        mutations.push({ storeName: "categorisationRules", record: result.updatedRule });
      }
    }

    mutations[1] = { storeName: "importBatches", record: batch };
    await saveRecords(mutations, "CSV import");
    setMessage(
      `Imported ${batch.newCount} new rows. ${batch.matchedCount} strong duplicates linked. ${batch.reviewCount} uncertain matches saved for review.`
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
    const batchAudits = loadedSnapshot.importRowAudits.filter((audit) => audit.importBatchId === batch.id && isActive(audit));
    const rollbackNote = `Rollback requested for ${batch.fileName}; only transactions created by this batch were archived.`;
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
    batchAudits.forEach((audit) => mutations.push({ storeName: "importRowAudits", record: markImportAuditRolledBack(audit, rollbackNote) }));

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
        <button
          className="primary-action"
          type="button"
          onClick={() => {
            setEditingTransactionId(null);
            setSearchParams({ new: "1" });
          }}
        >
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
            const result = await saveTransaction(draft);
            setSearchParams({});
            if (result.transaction.type === "income" && !isMainSalaryIncomeDraft(draft, loadedSnapshot)) {
              const cycle = activeCycleForIncome(result.transaction, loadedSnapshot.budgetCycles);
              setPendingExtraIncome({
                transactionId: result.transaction.id,
                amountMinor: draft.amountMinor,
                budgetCycleId: cycle?.id
              });
              setMessage("Income saved. Choose how the extra income should affect safe-to-spend.");
              return;
            }
            if (result.transaction.type === "transfer") {
              const candidates = matchingProtectedExtraIncomeAllocations(draft, loadedSnapshot);
              if (candidates.length > 0) {
                setPendingTransferLink({
                  transferTransactionId: result.transaction.id,
                  allocationIds: candidates.map((allocation) => allocation.id)
                });
                setMessage("Transfer saved. Confirm whether it completes a protected extra-income allocation.");
                return;
              }
            }
            setMessage("Transaction saved locally.");
          }}
        />
      ) : null}

      {editingTransaction ? (
        <TransactionComposer
          key={editingTransaction.id}
          accounts={activeAccounts}
          categories={activeCategories}
          transactions={allTransactions}
          defaultDate={asOfDate}
          initialDraft={transactionDraftForEdit(editingTransaction, loadedSnapshot)}
          heading="Edit transaction"
          saveLabel="Save changes"
          onCancel={() => setEditingTransactionId(null)}
          onSave={async (draft) => {
            const result = editTransactionRecords(editingTransaction, draft, loadedSnapshot);
            await saveRecords(
              [
                { storeName: "transactions", record: result.transaction },
                ...result.archivedLegs.map((record) => ({ storeName: "transactionLegs" as const, record })),
                ...result.archivedSplits.map((record) => ({ storeName: "transactionSplits" as const, record })),
                ...result.legs.map((record) => ({ storeName: "transactionLegs" as const, record })),
                ...result.splits.map((record) => ({ storeName: "transactionSplits" as const, record }))
              ],
              "transaction edit"
            );
            setEditingTransactionId(null);
            setMessage(
              editingTransaction.type === "income" &&
                loadedSnapshot.extraIncomeAllocations.some((allocation) => isActive(allocation) && allocation.incomeTransactionId === editingTransaction.id)
                ? "Transaction updated. Review the linked extra income allocation if this amount changed."
                : "Transaction updated."
            );
          }}
        />
      ) : null}

      {pendingExtraIncome ? (
        <ExtraIncomeAllocationPanel
          allocation={pendingExtraIncome}
          protectedAccounts={activeAccounts.filter((account) => account.role === "protected")}
          onSave={async (record) => {
            await saveRecords([{ storeName: "extraIncomeAllocations", record }], "extra income allocation");
            setPendingExtraIncome(null);
            setMessage("Extra income allocation saved. Protected amounts remain pending until you record and link the transfer.");
          }}
          onCancel={() => {
            void saveRecords(
              [
                {
                  storeName: "extraIncomeAllocations",
                  record: createExtraIncomeAllocation({
                    incomeTransactionId: pendingExtraIncome.transactionId,
                    budgetCycleId: pendingExtraIncome.budgetCycleId,
                    incomeAmountMinor: pendingExtraIncome.amountMinor,
                    availableMinor: pendingExtraIncome.amountMinor,
                    protectedMinor: 0,
                    status: "deferred"
                  })
                }
              ],
              "deferred extra income allocation"
            ).then(() => {
              setPendingExtraIncome(null);
              setMessage("Extra income allocation deferred for Daily Review.");
            });
          }}
        />
      ) : null}

      {editingExtraIncome ? (
        <ExtraIncomeAllocationPanel
          allocation={{
            transactionId: editingExtraIncome.incomeTransactionId,
            amountMinor: editingExtraIncome.incomeAmountMinor,
            budgetCycleId: editingExtraIncome.budgetCycleId,
            existingAllocation: editingExtraIncome
          }}
          protectedAccounts={activeAccounts.filter((account) => account.role === "protected")}
          cancelActionLabel="Close"
          onSave={async (record) => {
            await saveRecords([{ storeName: "extraIncomeAllocations", record }], "extra income allocation edit");
            setEditingExtraIncomeId(null);
            setMessage("Extra income allocation updated.");
          }}
          onCancel={() => setEditingExtraIncomeId(null)}
        />
      ) : null}

      {pendingTransferLink ? (
        <ProtectedTransferLinkPanel
          allocations={snapshot.extraIncomeAllocations.filter((allocation) => pendingTransferLink.allocationIds.includes(allocation.id) && isActive(allocation))}
          transactions={snapshot.transactions}
          accounts={snapshot.accounts}
          transferTransactionId={pendingTransferLink.transferTransactionId}
          onLink={async (allocation) => {
            await saveRecords(
              [
                {
                  storeName: "extraIncomeAllocations",
                  record: linkProtectedExtraIncomeTransfer(allocation, pendingTransferLink.transferTransactionId)
                }
              ],
              "extra income transfer link"
            );
            setPendingTransferLink(null);
            setMessage("Protected extra-income transfer linked. Safe-to-spend no longer holds that pending reserve.");
          }}
          onDismiss={() => {
            setPendingTransferLink(null);
            setMessage("Transfer saved locally without linking an extra-income allocation.");
          }}
        />
      ) : null}

      {!pendingExtraIncome && !editingExtraIncome ? (
        <ExtraIncomeAllocationBacklog
          allocations={editableExtraIncomeAllocations}
          transactions={snapshot.transactions}
          accounts={snapshot.accounts}
          onEdit={(allocation) => setEditingExtraIncomeId(allocation.id)}
        />
      ) : null}

      <CsvImportPanel
        accounts={activeAccounts}
        importBatches={snapshot.importBatches.filter(isActive)}
        defaultDate={asOfDate}
        onImport={handleImport}
      />

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

      <ImportBatchPanel
        batches={snapshot.importBatches.filter(isActive)}
        audits={snapshot.importRowAudits.filter(isActive)}
        transactions={snapshot.transactions}
        onRollback={rollbackImportBatch}
      />

      <section className="dashboard-band">
        <div className="band-header">
          <div>
            <p className="eyebrow">Recent activity</p>
            <h2>Ledger records</h2>
          </div>
        </div>
        <div className="data-table transaction-table" role="region" aria-label="Transactions">
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
                <span className="inline-actions">
                  {isEditableTransactionType(transaction.type) ? (
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`Edit ${transaction.description}`}
                      onClick={() => {
                        setSearchParams({});
                        setEditingTransactionId(transaction.id);
                      }}
                    >
                      <Pencil size={16} aria-hidden="true" />
                    </button>
                  ) : null}
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={`Archive ${transaction.description}`}
                    onClick={() => void archiveRecord("transactions", transaction.id)}
                  >
                    <Archive size={16} aria-hidden="true" />
                  </button>
                </span>
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

function isMainSalaryIncomeDraft(draft: TransactionDraft, snapshot: { planInstances: Array<{ id: string; isMainSalaryEstimate?: boolean }> }): boolean {
  if (draft.type !== "income") {
    return false;
  }
  const linkedPlan = draft.planInstanceId ? snapshot.planInstances.find((plan) => plan.id === draft.planInstanceId) : undefined;
  return Boolean(linkedPlan?.isMainSalaryEstimate);
}

function matchingProtectedExtraIncomeAllocations(draft: TransactionDraft, snapshot: BluehourSnapshot): ExtraIncomeAllocation[] {
  if (draft.type !== "transfer" || !draft.toAccountId) {
    return [];
  }

  const destinationAccount = snapshot.accounts.find((account) => account.id === draft.toAccountId && isActive(account));
  if (destinationAccount?.role !== "protected") {
    return [];
  }

  return snapshot.extraIncomeAllocations
    .filter(
      (allocation) =>
        isActive(allocation) &&
        allocation.status === "pending_transfer" &&
        allocation.protectedMinor === draft.amountMinor &&
        (!allocation.protectedAccountId || allocation.protectedAccountId === draft.toAccountId)
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function isEditableTransactionType(type: Transaction["type"]): type is (typeof transactionTypes)[number] {
  return transactionTypes.includes(type as (typeof transactionTypes)[number]);
}

function transactionDraftForEdit(transaction: Transaction, snapshot: BluehourSnapshot): TransactionDraft {
  if (!isEditableTransactionType(transaction.type)) {
    throw new Error("This transaction type is edited through its original workflow.");
  }

  const legs = snapshot.transactionLegs.filter((legRecord) => legRecord.transactionId === transaction.id && isActive(legRecord));
  const splits = snapshot.transactionSplits.filter((splitRecord) => splitRecord.transactionId === transaction.id && isActive(splitRecord));
  const sourceLeg = transaction.type === "transfer" ? legs.find((legRecord) => legRecord.deltaMinor < 0) ?? legs[0] : legs[0];
  const destinationLeg = transaction.type === "transfer" ? legs.find((legRecord) => legRecord.deltaMinor > 0) : undefined;
  const amountMinor =
    transaction.type === "transfer"
      ? Math.abs(destinationLeg?.deltaMinor ?? sourceLeg?.deltaMinor ?? 0)
      : splits.reduce((total, splitRecord) => total + splitRecord.amountMinor, 0) || Math.abs(sourceLeg?.deltaMinor ?? 0);
  const categoryId = splits.length === 1 ? splits[0].categoryId : undefined;

  return {
    type: transaction.type,
    occurredOn: transaction.occurredOn,
    description: transaction.description,
    amountMinor,
    accountId: sourceLeg?.accountId ?? snapshot.accounts.find(isActive)?.id ?? "",
    toAccountId: destinationLeg?.accountId,
    categoryId,
    splits:
      transaction.type !== "transfer" && splits.length > 1
        ? splits.map((splitRecord) => ({ categoryId: splitRecord.categoryId, amountMinor: splitRecord.amountMinor }))
        : undefined,
    note: transaction.note,
    refundOfTransactionId: transaction.refundOfTransactionId
  };
}

function ProtectedTransferLinkPanel({
  allocations,
  transactions,
  accounts,
  transferTransactionId,
  onLink,
  onDismiss
}: {
  allocations: ExtraIncomeAllocation[];
  transactions: Transaction[];
  accounts: Array<{ id: string; name: string }>;
  transferTransactionId: string;
  onLink: (allocation: ExtraIncomeAllocation) => Promise<void>;
  onDismiss: () => void;
}) {
  if (allocations.length === 0) {
    return null;
  }

  return (
    <section className="dashboard-band" aria-label="Protected transfer link">
      <div className="band-header">
        <div>
          <p className="eyebrow">Protected transfer</p>
          <h2>Link extra income transfer</h2>
        </div>
      </div>
      <div className="stack-list">
        {allocations.map((allocation) => {
          const income = transactions.find((transaction) => transaction.id === allocation.incomeTransactionId);
          const accountName = allocation.protectedAccountId ? accounts.find((account) => account.id === allocation.protectedAccountId)?.name : undefined;
          return (
            <div className="stack-row" key={allocation.id}>
              <span>
                <strong>{income?.description ?? "Extra income allocation"}</strong>
                <small>
                  {accountName ? `${accountName} · ` : ""}
                  transfer {transferTransactionId.slice(0, 12)}
                </small>
              </span>
              <Amount value={allocation.protectedMinor} />
              <button className="primary-action" type="button" onClick={() => void onLink(allocation)}>
                Confirm link
              </button>
            </div>
          );
        })}
      </div>
      <div className="form-actions">
        <button className="secondary-action" type="button" onClick={onDismiss}>
          Skip linking
        </button>
      </div>
    </section>
  );
}

function ExtraIncomeAllocationBacklog({
  allocations,
  transactions,
  accounts,
  onEdit
}: {
  allocations: ExtraIncomeAllocation[];
  transactions: Transaction[];
  accounts: Array<{ id: string; name: string }>;
  onEdit: (allocation: ExtraIncomeAllocation) => void;
}) {
  if (allocations.length === 0) {
    return null;
  }

  return (
    <section className="dashboard-band" aria-label="Extra income decisions">
      <div className="band-header">
        <div>
          <p className="eyebrow">Extra income</p>
          <h2>Open allocation decisions</h2>
        </div>
      </div>
      <div className="stack-list">
        {allocations.map((allocation) => {
          const income = transactions.find((transaction) => transaction.id === allocation.incomeTransactionId);
          const protectedAccount = allocation.protectedAccountId ? accounts.find((account) => account.id === allocation.protectedAccountId)?.name : undefined;
          return (
            <div className="stack-row" key={allocation.id}>
              <span>
                <strong>{income?.description ?? "Extra income"}</strong>
                <small>
                  {allocation.status.replace("_", " ")} · available RM{(allocation.availableMinor / 100).toFixed(2)} · protected RM
                  {(allocation.protectedMinor / 100).toFixed(2)}
                  {protectedAccount ? ` · ${protectedAccount}` : ""}
                </small>
              </span>
              <button
                className="secondary-action"
                type="button"
                onClick={() => onEdit(allocation)}
                aria-label={`Edit ${income?.description ?? "extra income"} decision`}
              >
                Edit decision
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ExtraIncomeAllocationPanel({
  allocation,
  protectedAccounts,
  onSave,
  onCancel,
  cancelActionLabel = "Decide later"
}: {
  allocation: { transactionId: string; amountMinor: number; budgetCycleId?: string; existingAllocation?: ExtraIncomeAllocation };
  protectedAccounts: Array<{ id: string; name: string }>;
  onSave: (record: ExtraIncomeAllocation) => Promise<void>;
  onCancel: () => void;
  cancelActionLabel?: string;
}) {
  const [choice, setChoice] = useState<"available" | "protected" | "manual" | "defer">(() => initialExtraIncomeChoice(allocation.existingAllocation));
  const [available, setAvailable] = useState(((allocation.existingAllocation?.availableMinor ?? allocation.amountMinor) / 100).toFixed(2));
  const [protectedAmount, setProtectedAmount] = useState(((allocation.existingAllocation?.protectedMinor ?? 0) / 100).toFixed(2));
  const [protectedAccountId, setProtectedAccountId] = useState(allocation.existingAllocation?.protectedAccountId ?? protectedAccounts[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const availableMinor =
        choice === "available" || choice === "defer"
          ? allocation.amountMinor
          : choice === "protected"
            ? 0
            : parseMoneyInput(available);
      const protectedMinor =
        choice === "available" || choice === "defer"
          ? 0
          : choice === "protected"
            ? allocation.amountMinor
            : parseMoneyInput(protectedAmount);
      const draft: ExtraIncomeAllocationDraft = {
        incomeTransactionId: allocation.transactionId,
        budgetCycleId: allocation.budgetCycleId,
        incomeAmountMinor: allocation.amountMinor,
        availableMinor,
        protectedMinor,
        protectedAccountId: protectedMinor > 0 ? protectedAccountId || undefined : undefined,
        status: choice === "defer" ? "deferred" : undefined
      };
      await onSave(
        allocation.existingAllocation ? updateExtraIncomeAllocation(allocation.existingAllocation, draft) : createExtraIncomeAllocation(draft)
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not allocate extra income");
    }
  }

  return (
    <section className="dashboard-band" aria-label="Extra income allocation">
      <div className="band-header">
        <div>
          <p className="eyebrow">Extra income</p>
          <h2>Allocate received income</h2>
        </div>
        <Amount value={allocation.amountMinor} />
      </div>
      <form className="form-grid" onSubmit={submit}>
        <fieldset className="span-3 segmented-field">
          <legend>How should this extra income be allocated?</legend>
          {[
            ["available", "Make all available"],
            ["protected", "Protect all"],
            ["manual", "Split manually"],
            ["defer", "Decide later"]
          ].map(([value, label]) => (
            <label className="checkbox-label compact" key={value}>
              <input type="radio" name="extra-income-choice" value={value} checked={choice === value} onChange={() => setChoice(value as typeof choice)} />
              {label}
            </label>
          ))}
        </fieldset>
        {choice === "manual" ? (
          <>
            <label>
              Available
              <input value={available} onChange={(event) => setAvailable(event.target.value)} inputMode="decimal" />
            </label>
            <label>
              Protected
              <input value={protectedAmount} onChange={(event) => setProtectedAmount(event.target.value)} inputMode="decimal" />
            </label>
          </>
        ) : null}
        {choice === "protected" || choice === "manual" ? (
          <label>
            Protected account
            <select value={protectedAccountId} onChange={(event) => setProtectedAccountId(event.target.value)}>
              <option value="">Reserve without account</option>
              {protectedAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
            <small>The transfer is still recorded separately. Pending protected income reduces safe-to-spend until linked.</small>
          </label>
        ) : null}
        {choice === "defer" ? <p className="span-3">A Daily Review task will stay open until this decision is made.</p> : null}
        {error ? <p className="form-error span-3">{error}</p> : null}
        <div className="form-actions span-3">
          <button className="secondary-action" type="button" onClick={onCancel}>
            {cancelActionLabel}
          </button>
          <button className="primary-action" type="submit">
            Save allocation
          </button>
        </div>
      </form>
    </section>
  );
}

function initialExtraIncomeChoice(allocation?: ExtraIncomeAllocation): "available" | "protected" | "manual" | "defer" {
  if (!allocation) {
    return "available";
  }
  if (allocation.status === "deferred") {
    return "defer";
  }
  if (allocation.protectedMinor === 0) {
    return "available";
  }
  if (allocation.availableMinor === 0) {
    return "protected";
  }
  return "manual";
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

function ImportBatchPanel({
  batches,
  audits,
  transactions,
  onRollback
}: {
  batches: ImportBatch[];
  audits: Array<{ importBatchId: string; outcome: string; description: string; linkedTransactionId?: string }>;
  transactions: Transaction[];
  onRollback: (batch: ImportBatch) => Promise<void>;
}) {
  const [confirmingBatchId, setConfirmingBatchId] = useState<string | null>(null);
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
          <span>Audit</span>
          <span>Action</span>
        </div>
        {batches.map((batch) => {
          const batchAudits = audits.filter((audit) => audit.importBatchId === batch.id);
          const linkedAudits = batchAudits.filter((audit) => audit.linkedTransactionId);
          return (
          <div className="data-row" key={batch.id}>
            <span>
              <strong>{batch.fileName}</strong>
              <small>{batch.fileHash.slice(0, 12)}</small>
            </span>
            <span>{new Date(batch.importedAt).toLocaleString("en-MY")}</span>
            <span>{batch.rowCount}</span>
            <span>{batch.newCount}</span>
            <span>
              {batch.matchedCount} linked · {batch.reviewCount} review
              {linkedAudits.slice(0, 1).map((audit) => {
                const transaction = transactions.find((record) => record.id === audit.linkedTransactionId);
                return (
                  <small key={audit.description}>
                    {audit.description} linked to {transaction?.description ?? audit.linkedTransactionId}
                  </small>
                );
              })}
            </span>
            {confirmingBatchId === batch.id ? (
              <button className="secondary-action danger-action" type="button" onClick={() => void onRollback(batch)}>
                Confirm rollback
              </button>
            ) : (
              <button className="secondary-action" type="button" onClick={() => setConfirmingBatchId(batch.id)}>
                Roll back
              </button>
            )}
          </div>
          );
        })}
      </div>
    </section>
  );
}

function TransactionComposer({
  accounts,
  categories,
  transactions,
  defaultDate,
  initialDraft,
  heading = "New transaction",
  saveLabel = "Save",
  onCancel,
  onSave
}: {
  accounts: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string; nature: string }>;
  transactions: Transaction[];
  defaultDate: string;
  initialDraft?: TransactionDraft;
  heading?: string;
  saveLabel?: string;
  onCancel: () => void;
  onSave: (draft: TransactionDraft) => Promise<void>;
}) {
  const [type, setType] = useState<TransactionDraft["type"]>(initialDraft?.type ?? "expense");
  const [description, setDescription] = useState(initialDraft?.description ?? "");
  const [amount, setAmount] = useState(initialDraft ? (initialDraft.amountMinor / 100).toFixed(2) : "");
  const [accountId, setAccountId] = useState(initialDraft?.accountId ?? accounts[0]?.id ?? "");
  const [toAccountId, setToAccountId] = useState(initialDraft?.toAccountId ?? accounts[1]?.id ?? accounts[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState(
    initialDraft?.categoryId ?? categories.find((category) => category.nature !== "administrative")?.id ?? categories[0]?.id ?? ""
  );
  const [occurredOn, setOccurredOn] = useState(initialDraft?.occurredOn ?? defaultDate);
  const [refundOfTransactionId, setRefundOfTransactionId] = useState(initialDraft?.refundOfTransactionId ?? "");
  const [note, setNote] = useState(initialDraft?.note ?? "");
  const [splits, setSplits] = useState<SplitDraft[]>(initialDraft?.splits ?? []);
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
          <h2>{heading}</h2>
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
            {saveLabel}
          </button>
        </div>
      </form>
    </section>
  );
}

function CsvImportPanel({
  accounts,
  importBatches,
  defaultDate,
  onImport
}: {
  accounts: Array<{ id: string; name: string }>;
  importBatches: ImportBatch[];
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
  const [textHash, setTextHash] = useState("");
  const [proceedWithReimport, setProceedWithReimport] = useState(false);
  const duplicateBatch = importBatches.find((batch) => batch.fileHash === textHash);

  useEffect(() => {
    let cancelled = false;
    void hashText(text).then((hash) => {
      if (!cancelled) {
        setTextHash(hash);
        setProceedWithReimport(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [text]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      if (!encodingConfirmed) {
        throw new Error("Confirm the CSV is UTF-8 before importing");
      }
      const currentHash = textHash || (await hashText(text));
      const currentDuplicateBatch = importBatches.find((batch) => batch.fileHash === currentHash);
      if (currentDuplicateBatch && !proceedWithReimport) {
        throw new Error("This file was previously imported. Inspect the previous batch or deliberately proceed with re-import.");
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
    setEncodingConfirmed(false);
    try {
      setText(await file.text());
      setFileName(file.name);
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
          {duplicateBatch ? (
            <label className="checkbox-label span-3">
              <input
                type="checkbox"
                checked={proceedWithReimport}
                onChange={(event) => setProceedWithReimport(event.target.checked)}
              />
              This file was previously imported as {duplicateBatch.fileName}; proceed with re-import
            </label>
          ) : null}
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
