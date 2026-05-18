import fs from "fs";
import path from "path";

export type FinanceItemStatus = "pending" | "approved" | "rejected" | "completed" | "ready";
export type FinancePriority = "low" | "medium" | "high";

export interface FinanceInvoice {
  id: string;
  vendor: string;
  category: string;
  amount: number;
  currency: string;
  dueDate: string;
  status: FinanceItemStatus;
  priority: FinancePriority;
  notes: string;
}

export interface FinanceExpense {
  id: string;
  employeeId?: string;
  employeeName: string;
  department: string;
  amount: number;
  currency: string;
  submittedAt: string;
  type: string;
  status: FinanceItemStatus;
  notes: string;
}

export interface FinancePaymentRun {
  id: string;
  title: string;
  scheduledFor: string;
  status: FinanceItemStatus;
  items: number;
  totalAmount: number;
  currency: string;
}

export interface FinanceCashflow {
  monthBudget: number;
  actualSpend: number;
  committedSpend: number;
  payrollReserve: number;
  receivables: number;
}

interface FinanceStore {
  invoices: FinanceInvoice[];
  expenses: FinanceExpense[];
  paymentRuns: FinancePaymentRun[];
  cashflow: FinanceCashflow;
}

const FINANCE_FILE = path.join(process.cwd(), "data", "finance.json");

const EMPTY_STORE: FinanceStore = {
  invoices: [],
  expenses: [],
  paymentRuns: [],
  cashflow: {
    monthBudget: 0,
    actualSpend: 0,
    committedSpend: 0,
    payrollReserve: 0,
    receivables: 0,
  },
};

function ensureFinanceFile() {
  const dir = path.dirname(FINANCE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(FINANCE_FILE)) fs.writeFileSync(FINANCE_FILE, JSON.stringify(EMPTY_STORE, null, 2));
}

function readFinanceStore(): FinanceStore {
  ensureFinanceFile();
  try {
    return JSON.parse(fs.readFileSync(FINANCE_FILE, "utf-8")) as FinanceStore;
  } catch {
    return EMPTY_STORE;
  }
}

function writeFinanceStore(store: FinanceStore) {
  ensureFinanceFile();
  fs.writeFileSync(FINANCE_FILE, JSON.stringify(store, null, 2));
}

export function getFinanceSnapshot() {
  const store = readFinanceStore();
  const pendingInvoices = store.invoices.filter((invoice) => invoice.status === "pending");
  const pendingExpenses = store.expenses.filter((expense) => expense.status === "pending");
  const readyRuns = store.paymentRuns.filter((run) => run.status === "ready");

  return {
    ...store,
    summary: {
      pendingInvoiceCount: pendingInvoices.length,
      pendingInvoiceAmount: pendingInvoices.reduce((sum, invoice) => sum + invoice.amount, 0),
      pendingExpenseCount: pendingExpenses.length,
      pendingExpenseAmount: pendingExpenses.reduce((sum, expense) => sum + expense.amount, 0),
      readyRunCount: readyRuns.length,
      readyRunAmount: readyRuns.reduce((sum, run) => sum + run.totalAmount, 0),
      availableBudget: Math.max(
        0,
        store.cashflow.monthBudget - store.cashflow.actualSpend - store.cashflow.committedSpend
      ),
    },
  };
}

export function updateFinanceDecision(
  kind: "invoice" | "expense",
  id: string,
  decision: "approve" | "reject"
) {
  const store = readFinanceStore();
  const collection = kind === "invoice" ? store.invoices : store.expenses;
  const item = collection.find((entry) => entry.id === id);
  if (!item) return null;

  item.status = decision === "approve" ? "approved" : "rejected";
  writeFinanceStore(store);
  return item;
}

export function runFinanceBatch(id: string) {
  const store = readFinanceStore();
  const run = store.paymentRuns.find((entry) => entry.id === id);
  if (!run) return null;

  run.status = "completed";
  const approvedInvoices = store.invoices.filter((invoice) => invoice.status === "approved");
  const approvedExpenses = store.expenses.filter((expense) => expense.status === "approved");
  store.cashflow.actualSpend += run.totalAmount;
  store.cashflow.committedSpend = Math.max(0, store.cashflow.committedSpend - run.totalAmount);

  for (const invoice of approvedInvoices) {
    invoice.status = "completed";
  }

  for (const expense of approvedExpenses) {
    expense.status = "completed";
  }

  writeFinanceStore(store);
  return run;
}

export function createExpenseRequest(input: {
  employeeId?: string;
  employeeName: string;
  department: string;
  amount: number;
  currency?: string;
  type: string;
  notes: string;
}) {
  const store = readFinanceStore();
  const record: FinanceExpense = {
    id: `EXP-${Date.now()}`,
    employeeId: input.employeeId,
    employeeName: input.employeeName,
    department: input.department,
    amount: input.amount,
    currency: input.currency ?? "INR",
    submittedAt: new Date().toISOString(),
    type: input.type,
    status: "pending",
    notes: input.notes,
  };
  store.expenses.unshift(record);
  writeFinanceStore(store);
  return record;
}
