/**
 * MoneyFlow - Google Apps Script backend
 * - Syncs Transactions, Loans (computed), Categories, Budgets, Goals to a Spreadsheet
 * - Endpoints (GET/POST): action = getAll | replaceAll | status
 *
 * To use:
 *  - Set SPREADSHEET_ID to a specific spreadsheet or leave empty to use the active spreadsheet.
 *  - Deploy as Web App (Execute as: Me / Who has access: Anyone with link).
 */

const SPREADSHEET_ID = ''; // set to a spreadsheet ID or leave empty to use active spreadsheet

// Table headers
const TRANSACTION_HEADERS = ['id','type','amount','date','category','note','loanId','loanType','createdAt'];
const LOAN_HEADERS = ['id','name','principal','remaining','date','note','createdAt'];
const CATEGORY_HEADERS = ['name','type','createdAt'];
const BUDGET_HEADERS = ['category','amount'];
const GOAL_HEADERS = ['name','target','saved'];

/* ---------- Utilities ---------- */

function ss() {
  return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function safeParse(s) {
  try { return JSON.parse(s); } catch (e) { return null; }
}

function fingerprint(obj) {
  const raw = JSON.stringify(obj);
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw, Utilities.Charset.UTF_8));
}

function formatDate(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(v).slice(0,10);
}

/* ---------- Sheet helpers ---------- */

function sheet(name, headers) {
  const spreadsheet = ss();
  let sh = spreadsheet.getSheetByName(name);
  if (!sh) {
    sh = spreadsheet.insertSheet(name);
    if (headers && headers.length) sh.getRange(1,1,1,headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  } else {
    // Ensure header row exists and at least headers.length columns
    try {
      const existing = sh.getRange(1,1,1,Math.max(sh.getLastColumn(), headers ? headers.length : 0)).getValues()[0] || [];
      if (!existing || existing.length < (headers ? headers.length : 0)) {
        if (headers && headers.length) sh.getRange(1,1,1,headers.length).setValues([headers]);
        sh.setFrozenRows(1);
      }
    } catch (e) {
      // noop
    }
  }
  return sh;
}

function readRows(name, headers) {
  const sh = sheet(name, headers);
  const vals = sh.getDataRange().getValues();
  if (!vals || vals.length < 2) return [];
  const data = [];
  for (let i = 1; i < vals.length; i++) {
    const row = vals[i];
    if (!row.some(cell => cell !== '' && cell !== null && typeof cell !== 'undefined')) continue;
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = row[j];
    }
    data.push(obj);
  }
  return data;
}

/* ---------- Normalizers ---------- */

function normalizeTransaction(x) {
  if (!x) return null;
  return {
    id: String(x.id || ''),
    type: String(x.type || 'expense'),
    amount: Number(x.amount || 0),
    date: formatDate(x.date),
    category: String(x.category || 'General'),
    note: String(x.note || ''),
    loanId: x.hasOwnProperty('loanId') && x.loanId !== null ? String(x.loanId) : '',
    loanType: String(x.loanType || ''),
    createdAt: x.createdAt ? (new Date(x.createdAt)).toISOString() : (new Date()).toISOString()
  };
}

function normalizeLoan(x) {
  if (!x) return null;
  return {
    id: String(x.id || ''),
    name: String(x.name || ''),
    principal: Number(x.principal || 0),
    remaining: Number(x.remaining || 0),
    date: formatDate(x.date),
    note: String(x.note || ''),
    createdAt: x.createdAt ? (new Date(x.createdAt)).toISOString() : (new Date()).toISOString()
  };
}

function normalizeCategory(x) {
  if (!x) return null;
  return {
    name: String(x.name || '').trim(),
    type: String(x.type || 'expense'),
    createdAt: x.createdAt ? (new Date(x.createdAt)).toISOString() : (new Date()).toISOString()
  };
}

function uniqueCategories(xs) {
  const out = [];
  xs.forEach(x => {
    const c = normalizeCategory(x);
    if (!c || !c.name) return;
    const exists = out.some(y => y.name.toLowerCase() === c.name.toLowerCase() && y.type === c.type);
    if (!exists) out.push(c);
  });
  return out;
}

/* ---------- Compute loans from transactions ---------- */

function computeLoansFromTransactions(transactions) {
  const txs = (transactions || []).map(t => Object.assign({}, t));
  txs.sort((a,b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : (a.date ? new Date(a.date).getTime() : 0);
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : (b.date ? new Date(b.date).getTime() : 0);
    return ta - tb;
  });

  const loansById = {};

  txs.forEach(tx => {
    const type = String(tx.type || '').toLowerCase();
    const category = String(tx.category || '').toLowerCase();
    const loanId = tx.loanId ? String(tx.loanId) : '';

    const isLoanOrigination = (type === 'income') && (tx.loanType === 'loan' || category.includes('loan'));
    const isRepayment = (type === 'expense') && !!loanId;

    if (isLoanOrigination) {
      const id = loanId || `loan-${tx.id || ('t' + Math.abs(new Date(tx.createdAt || tx.date || Date.now()).getTime()))}`;
      if (!loansById[id]) {
        loansById[id] = {
          id,
          name: tx.note || tx.category || 'Loan',
          principal: 0,
          remaining: 0,
          date: formatDate(tx.date),
          note: tx.note || '',
          createdAt: tx.createdAt || (new Date()).toISOString()
        };
      }
      const amt = Number(tx.amount || 0);
      loansById[id].principal = Number(loansById[id].principal || 0) + amt;
      loansById[id].remaining = Number(loansById[id].remaining || 0) + amt;
    }

    if (isRepayment) {
      const id = loanId;
      if (!loansById[id]) {
        loansById[id] = {
          id,
          name: tx.note || tx.category || 'Loan',
          principal: 0,
          remaining: 0,
          date: '',
          note: '',
          createdAt: tx.createdAt || (new Date()).toISOString()
        };
      }
      const amt = Number(tx.amount || 0);
      loansById[id].remaining = Math.max(0, Number(loansById[id].remaining || 0) - amt);
    }
  });

  const loans = Object.keys(loansById).map(k => {
    const l = loansById[k];
    return {
      id: String(l.id || ''),
      name: String(l.name || ''),
      principal: Number(l.principal || 0),
      remaining: Number(l.remaining || 0),
      date: formatDate(l.date),
      note: String(l.note || ''),
      createdAt: l.createdAt ? new Date(l.createdAt).toISOString() : new Date().toISOString()
    };
  });

  return loans;
}

/* ---------- Read / Write all ---------- */

function readAll() {
  const transactions = readRows('Transactions', TRANSACTION_HEADERS).map(normalizeTransaction).filter(Boolean);
  const loans = readRows('Loans', LOAN_HEADERS).map(normalizeLoan).filter(Boolean);
  const categories = uniqueCategories(readRows('Categories', CATEGORY_HEADERS));
  const budgets = readRows('Budgets', BUDGET_HEADERS).map(r => ({ category: String(r.category || ''), amount: Number(r.amount || 0) }));
  const goals = readRows('Goals', GOAL_HEADERS).map(r => ({ name: String(r.name || ''), target: Number(r.target || 0), saved: Number(r.saved || 0) }));
  const d = { transactions, loans, categories, budgets, goals };
  d.revision = fingerprint(d);
  return d;
}

function writeAll(payload) {
  const transactions = (payload.transactions || []).map(normalizeTransaction).filter(Boolean);

  // Compute loans server-side (authoritative)
  const computedLoans = computeLoansFromTransactions(transactions || []);

  const categories = uniqueCategories(payload.categories || []);
  const budgets = (payload.budgets || []).map(item => [String(item.category || ''), Number(item.amount || 0)]);
  const goals = (payload.goals || []).map(item => [String(item.name || ''), Number(item.target || 0), Number(item.saved || 0)]);

  writeTable('Transactions', TRANSACTION_HEADERS, transactions.map(tx => [
    tx.id, tx.type, tx.amount, tx.date, tx.category, tx.note, tx.loanId, tx.loanType, tx.createdAt
  ]));

  // Write Loans (computed)
  writeTable('Loans', LOAN_HEADERS, computedLoans.map(ln => [
    ln.id, ln.name, ln.principal, ln.remaining, ln.date, ln.note, ln.createdAt
  ]));

  // Write Categories
  writeTable('Categories', CATEGORY_HEADERS, categories.map(c => [c.name, c.type, c.createdAt]));

  // Write Budgets
  writeTable('Budgets', BUDGET_HEADERS, budgets);

  // Write Goals
  writeTable('Goals', GOAL_HEADERS, goals);
}

function writeTable(name, headers, rows) {
  const sh = sheet(name, headers);
  sh.clearContents();
  if (headers && headers.length) sh.getRange(1,1,1,headers.length).setValues([headers]);
  if (rows && rows.length) {
    sh.getRange(2,1,rows.length, headers.length).setValues(rows);
  }
  sh.setFrozenRows(1);
}

/* ---------- Web endpoints ---------- */

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) ? String(e.parameter.action) : 'status';
    if (action === 'getAll') {
      return out({ ok: true, data: readAll() });
    }
    if (action === 'status') {
      return out({ ok: true, data: status() });
    }
    return out({ ok: true, message: 'MoneyFlow Apps Script endpoint' });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    const payload = safeParse(e && e.postData && e.postData.contents ? e.postData.contents : '{}') || {};
    const action = payload.action || payload?.body?.action || 'status';
    if (action === 'getAll') {
      return out({ ok: true, data: readAll() });
    }
    if (action === 'status') {
      return out({ ok: true, data: status() });
    }
    if (action === 'replaceAll' || action === 'writeAll') {
      // payload.payload or payload.body or payload itself may contain the data
      const data = payload.payload || payload.body || payload;
      writeAll(data);
      // Return the authoritative dataset (transactions, computed loans, categories, budgets, goals)
      const result = readAll();
      return out({ ok: true, message: 'Replaced data', data: result });
    }
    return out({ ok: false, error: 'unknown action' });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

function status() {
  const d = readAll();
  return {
    revision: d.revision,
    transactionCount: (d.transactions || []).length,
    loanCount: (d.loans || []).length,
    categoryCount: (d.categories || []).length,
    budgetCount: (d.budgets || []).length,
    goalCount: (d.goals || []).length
  };
}
