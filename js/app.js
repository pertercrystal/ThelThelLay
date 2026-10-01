// js/app.js
(() => {
  'use strict';

  const KEY = 'moneyflow-v3';
  const $ = id => document.getElementById(id);
  const q = sel => document.querySelector(sel);
  const today = new Date().toISOString().slice(0,10);

  const money = n => `${Math.round(Number(n) || 0).toLocaleString()} MMK`;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function safeParse(s, fallback = {}) {
    try { return JSON.parse(s); } catch (e) { return fallback; }
  }

  function defaultCategories() {
    // start with no default categories
    return [];
  }

  function fallback() {
    return {
      transactions: [],
      categories: defaultCategories(),
      budgets: [], // {id, category, amount}
      goals: [],
      loans: [],
      settings: { theme: 'light', syncUrl: '', carryOverEnabled: true, carryOverConfirm: false, txPageSize: 50 },
      reportMonth: today.slice(0,7),
      currentType: 'expense'
    };
  }

  function readState() {
    try {
      return Object.assign({}, fallback(), safeParse(localStorage.getItem(KEY) || 'null', {}));
    } catch (e) {
      return fallback();
    }
  }

  function writeState(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
  }

  let state = readState();

  function toast(msg) {
    const t = $('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('on'); t.style.display = 'block';
    clearTimeout(t._t); t._t = setTimeout(() => { t.classList.remove('on'); t.style.display = 'none'; }, 2200);
  }

  function uid(prefix='id') { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`; }

  function saveState() {
    writeState(state);
  }

  function repairTransactionIds() {
    let changed = false; (state.transactions || []).forEach(tx => {
      if (!tx.id) { tx.id = uid('tx'); changed = true; }
      if (!tx.createdAt) { tx.createdAt = Date.now(); changed = true; }
      if (!tx.date) { tx.date = today; changed = true; }
    });
    if (changed) {
      saveState();
      scheduleSync();
    }
  }

  function currentMonth() { return state.reportMonth || today.slice(0,7); }

  // -------------------------
  // Transaction pagination config
  // -------------------------
  const TX_PAGE_SIZE = 50; // default page size for history
  let txCurrentPage = 1;
  let txTotalPages = 1;
  let txInfiniteScrollBound = false;

  // initialize page size from settings
  if (!window.__moneyflow_tx_page_size) window.__moneyflow_tx_page_size = Number(state.settings?.txPageSize) || TX_PAGE_SIZE;

  function getAllTxSortedDesc() {
    return (state.transactions || []).slice().sort((a,b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });
  }

  function ensureTxPaginationControls() {
    const txPanel = $('txRows') ? $('txRows').closest('.panel') || $('txRows').parentElement : null;
    if (!txPanel) return;
    // container for pagination
    let container = txPanel.querySelector('#txPagination');
    if (!container) {
      container = document.createElement('div');
      container.id = 'txPagination';
      // match app style: use small buttons and muted page info
      container.className = 'head';
      container.style.display = 'flex';
      container.style.gap = '8px';
      container.style.alignItems = 'center';
      container.style.marginTop = '8px';
      container.style.justifyContent = 'center';
      txPanel.appendChild(container);
    }
    // render controls using existing "small" button style
    const pageSize = Number(window.__moneyflow_tx_page_size || TX_PAGE_SIZE) || TX_PAGE_SIZE;
    container.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px">
        <button id="txPrev" class="small">Prev</button>
        <div id="txPageInfo" class="muted">Page 1 / 1</div>
        <button id="txNext" class="small">Next</button>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-left:12px">
        <label class="small muted" for="txPageSize">Rows</label>
        <select id="txPageSize" style="min-width:64px">
          <option value="20"${pageSize===20?' selected':''}>20</option>
          <option value="50"${pageSize===50?' selected':''}>50</option>
          <option value="100"${pageSize===100?' selected':''}>100</option>
        </select>
      </div>
    `;
    container.querySelector('#txPrev')?.addEventListener('click', () => {
      if (txCurrentPage > 1) { txCurrentPage--; renderTransactions(); scrollTxPanelToTop(); }
    });
    container.querySelector('#txNext')?.addEventListener('click', () => {
      if (txCurrentPage < txTotalPages) { txCurrentPage++; renderTransactions(); scrollTxPanelToTop(); }
    });
    container.querySelector('#txPageSize')?.addEventListener('change', (e) => {
      const v = Number(e.target.value) || TX_PAGE_SIZE;
      txCurrentPage = 1;
      window.__moneyflow_tx_page_size = v;
      // persist preference to settings so it survives reloads
      state.settings = state.settings || {};
      state.settings.txPageSize = v;
      saveState();
      renderTransactions();
    });
  }

  function scrollTxPanelToTop() {
    const txPanel = $('txRows') ? $('txRows').closest('.panel') || $('txRows').parentElement : null;
    if (txPanel) txPanel.scrollTop = 0;
  }

  function attachTxInfiniteScroll() {
    if (txInfiniteScrollBound) return;
    const txPanel = $('txRows') ? $('txRows').closest('.panel') || $('txRows').parentElement : null;
    if (!txPanel) return;
    txPanel.addEventListener('scroll', () => {
      // if near bottom, load next page
      const atBottom = txPanel.scrollHeight - txPanel.scrollTop - txPanel.clientHeight < 60;
      if (atBottom && txCurrentPage < txTotalPages) {
        txCurrentPage++;
        renderTransactions();
      }
    });
    txInfiniteScrollBound = true;
  }

  // --- Categories management (UI + logic) ---
  function renderCategoriesList() {
    const holder = $('categoriesList');
    if (!holder) return;
    const cats = (state.categories || []);
    // Make the container scrollable so many categories don't expand the page
    holder.style.maxHeight = '320px';
    holder.style.overflowY = 'auto';
    holder.style.overflowX = 'hidden';

    if (!cats.length) {
      holder.innerHTML = `<div class="muted">No categories</div>`;
      fillCategorySelects();
      return;
    }
    holder.innerHTML = cats.map((c, idx) => {
      return `<div class="row" data-idx="${idx}">
        <div class="meta"><strong>${esc(c.name)}</strong><div class="small-muted">${esc(c.type)}</div></div>
        <div>
          <button class="small edit" data-idx="${idx}">Edit</button>
          <button class="small delete" data-idx="${idx}">Delete</button>
        </div>
      </div>`;
    }).join('');
    // wire inline events
    holder.querySelectorAll('button.edit').forEach(btn => btn.addEventListener('click', e => {
      const idx = +btn.dataset.idx;
      const c = state.categories[idx];
      const newName = prompt('Edit category name', c.name);
      if (!newName) return;
      const newType = prompt('Type (expense|income|loan|credit)', c.type) || c.type;
      // avoid duplicates (case-insensitive) across all types
      const normalized = newName.trim().toLowerCase();
      const dup = state.categories.some((x,i) => i!==idx && x.name.trim().toLowerCase() === normalized);
      if (dup) { toast('Category with this name already exists'); return; }
      state.categories[idx].name = newName.trim();
      state.categories[idx].type = newType;
      saveState();
      renderCategoriesList();
      populateCategories();
      fillCategorySelects();
      scheduleSync();
      toast('Category updated');
    }));
    holder.querySelectorAll('button.delete').forEach(btn => btn.addEventListener('click', e => {
      const idx = +btn.dataset.idx;
      const c = state.categories[idx];
      if (!confirm(`Delete category "${c.name}" (${c.type})? This will not delete existing transactions.`)) return;
      state.categories.splice(idx,1);
      saveState();
      renderCategoriesList();
      populateCategories();
      fillCategorySelects();
      scheduleSync();
      toast('Category deleted');
    }));
    fillCategorySelects();
  }

  function addCategoryFromUI() {
    const name = ($('newCategoryName')?.value || '').trim();
    const type = ($('newCategoryType')?.value || 'expense');
    if (!name) { toast('Category name required'); return; }
    // check duplicate by name only (case-insensitive) to avoid unlimited similar categories
    const normalized = name.trim().toLowerCase();
    if (state.categories.some(c => c.name.trim().toLowerCase() === normalized)) { toast('Category exists'); return; }
    state.categories.push({ name, type, createdAt: new Date().toISOString() });
    saveState();
    scheduleSync();
    $('newCategoryName').value = '';
    renderCategoriesList();
    populateCategories();
    fillCategorySelects();
    toast('Category added');
  }

  function resetDefaultCategories() {
    if (!confirm('Reset categories to defaults? This will replace your categories list.')) return;
    state.categories = defaultCategories();
    saveState();
    scheduleSync();
    renderCategoriesList();
    populateCategories();
    fillCategorySelects();
    toast('Categories reset to defaults');
  }

  // fill any category select inputs (category select in add form and budget category select)
  function fillCategorySelects() {
    const categorySelect = $('category');
    // Show all created categories (not filtered by transaction type)
    if (categorySelect) {
      const list = (state.categories || []);
      categorySelect.innerHTML = list.map(c => `<option>${esc(c.name)}</option>`).join('') || `<option>General</option>`;
      // limit visual growth of select's parent if necessary (panel styling handled in CSS/JS)
      categorySelect.style.maxHeight = '220px';
    }
    const budgetCategorySelect = $('budgetCategorySelect');
    if (budgetCategorySelect) {
      // show unique category names, include type in label for clarity
      const entries = state.categories || [];
      // dedupe by name while preserving type (last wins)
      const seen = new Map();
      entries.forEach(c => { seen.set(c.name, c); });
      const unique = Array.from(seen.values());
      budgetCategorySelect.innerHTML = unique.map(c => `<option value="${esc(c.name)}">${esc(c.name)} • ${esc(c.type)}</option>`).join('') || `<option value="General">General • expense</option>`;
      budgetCategorySelect.style.maxHeight = '220px';
    }
  }

  // --- Budgets management ---
  function renderBudgetsList() {
    const holder = $('budgetsList');
    if (!holder) return;
    // Make the container scrollable so many budgets don't expand the page
    holder.style.maxHeight = '320px';
    holder.style.overflowY = 'auto';
    holder.style.overflowX = 'hidden';

    const bs = state.budgets || [];
    if (!bs.length) { holder.innerHTML = `<div class="muted">No budgets set</div>`; return; }
    holder.innerHTML = bs.map((b, idx) => {
      return `<div class="row" data-idx="${idx}">
        <div class="meta"><strong>${esc(b.category)}</strong><div class="small-muted">${money(b.amount)}</div></div>
        <div>
          <button class="small edit-budget" data-idx="${idx}">Edit</button>
          <button class="small delete-budget" data-idx="${idx}">Delete</button>
        </div>
      </div>`;
    }).join('');
    holder.querySelectorAll('button.edit-budget').forEach(btn => btn.addEventListener('click', () => {
      const idx = +btn.dataset.idx;
      const b = state.budgets[idx];
      const newAmount = prompt('Budget amount (MMK)', String(b.amount || 0));
      if (newAmount === null) return;
      const n = Number(newAmount || 0);
      if (isNaN(n) || n < 0) { toast('Invalid amount'); return; }
      state.budgets[idx].amount = n;
      saveState();
      scheduleSync();
      renderBudgetsList();
      toast('Budget updated');
    }));
    holder.querySelectorAll('button.delete-budget').forEach(btn => btn.addEventListener('click', () => {
      const idx = +btn.dataset.idx;
      const b = state.budgets[idx];
      if (!confirm(`Delete budget for ${b.category}?`)) return;
      state.budgets.splice(idx,1);
      saveState();
      scheduleSync();
      renderBudgetsList();
      toast('Budget deleted');
    }));
  }

  function addBudgetFromUI() {
    const category = ($('budgetCategorySelect')?.value || '').trim();
    const amount = Number(($('newBudgetAmount')?.value || 0));
    if (!category) { toast('Choose a category'); return; }
    if (!amount || amount <= 0) { toast('Enter budget amount greater than 0'); return; }
    // replace existing budget for same category
    state.budgets = state.budgets || [];
    const existing = state.budgets.find(b => b.category === category);
    if (existing) {
      existing.amount = amount;
    } else {
      state.budgets.push({ id: uid('bud'), category, amount, createdAt: new Date().toISOString() });
    }
    saveState();
    scheduleSync();
    $('newBudgetAmount').value = '';
    renderBudgetsList();
    toast('Budget saved');
  }

  function clearBudgets() {
    if (!confirm('Clear all budgets?')) return;
    state.budgets = [];
    saveState();
    scheduleSync();
    renderBudgetsList();
    toast('All budgets cleared');
  }

  // --- existing app logic (transactions, loans, sync) adapted to use saveState() and new category/budget flows ---
  function totals(xs) {
    return xs.reduce((r,t) => {
      const n = Number(t.amount) || 0;
      if (t.type === 'income') r.income += n;
      else if (t.type === 'expense') r.expense += n;
      else if (t.type === 'loan') r.loan += n;
      else if (t.type === 'credit') r.credit += n;
      return r;
    }, { income:0, expense:0, loan:0, credit:0 });
  }

  function updateLoanRepaymentField() {
    const holder = $('loanSelectHolder');
    if (!holder) return;
    const loans = (state.loans || []).filter(l => Number(l.remaining) > 0);
    if (!loans.length) { holder.style.display = 'none'; holder.innerHTML = ''; return; }
    holder.style.display = '';
    if (!holder.querySelector('select')) {
      const label = document.createElement('label'); label.textContent = 'Select loan to repay';
      const select = document.createElement('select'); select.id = 'loanRepaySelect'; select.name = 'loanRepaySelect';
      holder.appendChild(label); holder.appendChild(select);
    }
    const select = holder.querySelector('select');
    select.innerHTML = `<option value="">-- choose loan --</option>` + loans.map(l => `<option value="${esc(String(l.id))}">${esc(l.name || 'Loan')} — ${money(l.remaining)}</option>`).join('');
  }

  function populateCategories() {
    const s = $('category');
    if (!s) return;
    // Show all categories (not filtered by currentType) so user sees everything
    const list = (state.categories || []);
    s.innerHTML = list.map(c => `<option>${esc(c.name)}</option>`).join('') || `<option>General</option>`;
  }

  function repairLoanRecords() {
    state.loans = Array.isArray(state.loans) ? state.loans : [];
    let changed = false;
    (state.transactions || []).forEach(tx => {
      const cat = String(tx.category || '').toLowerCase();
      const isLoanReceipt = cat.includes('loan') || tx.loanType === 'loan' || tx.type === 'loan';
      const isPayback = (cat.includes('repay') || cat.includes('payback') || tx.loanType === 'payback');
      if (isLoanReceipt && tx.type !== 'income') { tx.type = 'income'; changed = true; }
      if (isPayback && tx.type !== 'expense') { tx.type = 'expense'; changed = true; }
      if (isLoanReceipt && !tx.loanId) { tx.loanId = `loan-${tx.id || tx.createdAt || Date.now()}`; changed = true; }
    });
    (state.transactions || []).filter(tx => tx.type === 'income' && tx.loanId).forEach(tx => {
      const found = state.loans.find(l => String(l.id) === String(tx.loanId));
      if (!found) {
        state.loans.push({
          id: tx.loanId,
          name: tx.note || 'Loan',
          principal: Number(tx.amount) || 0,
          remaining: Number(tx.amount) || 0,
          date: tx.date,
          note: tx.note || '',
          createdAt: tx.createdAt || Date.now()
        });
        changed = true;
      }
    });
    if (changed) {
      saveState();
      scheduleSync();
    }
  }

  function applyRepayments() {
    state.loans = Array.isArray(state.loans) ? state.loans : [];
    let changed = false;
    const loansById = {};
    state.loans.forEach(l => { loansById[String(l.id)] = l; });
    const txs = (state.transactions || []).slice().sort((a,b) => (a.createdAt||0) - (b.createdAt||0));
    txs.forEach(tx => {
      if (tx.type === 'expense' && tx.loanId && !tx._loanApplied) {
        const loan = loansById[String(tx.loanId)];
        if (loan) {
          const amt = Number(tx.amount) || 0;
          loan.remaining = Math.max(0, (Number(loan.remaining) || 0) - amt);
          tx._loanApplied = true;
          changed = true;
        }
      }
    });
    if (changed) {
      saveState();
      scheduleSync();
    }
  }

  // Carry over function: compute remaining from previous month and add a "Carry Over" income tx at first day of current month if not already present.
  function prevMonthKey(monthKey) {
    // monthKey: 'YYYY-MM'
    const [y, m] = monthKey.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, 1));
    date.setUTCMonth(date.getUTCMonth() - 1);
    const py = date.getUTCFullYear();
    const pm = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${py}-${pm}`;
  }

  function carryOverIfMissingForMonth(monthKey) {
    if (!monthKey) return;
    // respect settings toggle
    if (!state.settings?.carryOverEnabled) return;
    const prevKey = prevMonthKey(monthKey);
    const prevTxs = (state.transactions || []).filter(tx => String(tx.date || '').slice(0,7) === prevKey);
    if (!prevTxs.length) return;
    const t = totals(prevTxs);
    const remainingMoney = (t.income || 0) - (t.expense || 0) - (t.loan || 0) - (t.credit || 0);
    if (!(remainingMoney > 0)) return; // only carry positive remaining
    // Avoid duplicate carry-over for same month
    const exists = (state.transactions || []).some(tx => {
      return String(tx.date || '').slice(0,7) === monthKey && String((tx.category||'').trim().toLowerCase()) === 'carry over';
    });
    if (exists) return;

    // confirm if required
    if (state.settings?.carryOverConfirm) {
      const ok = confirm(`Previous month (${prevKey}) remaining: ${money(remainingMoney)}. Add "Carry Over" to ${monthKey}?`);
      if (!ok) return;
    }

    // create carry-over transaction on first day of month
    const newTx = {
      id: uid('tx'),
      type: 'income',
      amount: remainingMoney,
      category: 'Carry Over',
      note: `Carry over from ${prevKey}`,
      date: `${monthKey}-01`,
      createdAt: new Date().toISOString()
    };
    state.transactions = state.transactions || [];
    state.transactions.push(newTx);
    saveState();
    scheduleSync();
    toast(`Carry Over added: ${money(remainingMoney)}`);
  }

  function renderLoanSummary() {
    repairLoanRecords();
    applyRepayments();
    const host = $('loanBI');
    if (!host) return;
    const monthKey = currentMonth();
    const rows = (state.transactions || []).filter(tx => String(tx.date || '').slice(0,7) === monthKey);
    const payback = rows.filter(tx => tx.type === 'expense' && tx.loanId).reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const received = rows.filter(tx => tx.type === 'income' && tx.loanId).reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const outstanding = (state.loans || []).reduce((s, l) => s + (Number(l.remaining) || 0), 0);
    const loanRows = (state.loans || []).map(loan => {
      return `<div class="loan-bi-row"><span>${esc(loan.name||'Loan')}<small>Principal: ${money(loan.principal)}</small></span><b>${money(loan.remaining)}</b></div>`;
    }).join('') || `<div class="empty muted">No loan records yet</div>`;
    host.innerHTML = `
      <div class="loan-bi-grid">
        <div class="loan-bi-stat"><small>Loan received</small><strong>${money(received)}</strong></div>
        <div class="loan-bi-stat"><small>Loan payback</small><strong>${money(payback)}</strong></div>
        <div class="loan-bi-stat"><small>Outstanding liability</small><strong>${money(outstanding)}</strong></div>
      </div>
      <div class="loan-bi-list">${loanRows}</div>
    `;
  }

  // --- NEW: Budget summary & Goals rendering (used in Dashboard) ---
  function renderBudgetReportSummary() {
    const host = $('budgetReport');
    if (!host) return;
    const bs = state.budgets || [];
    if (!bs.length) { host.innerHTML = `<div class="muted">No budgets set</div>`; return; }

    const monthKey = currentMonth();
    // For each budget, calculate spent this month (expense transactions matching category)
    const rows = bs.map(b => {
      const spent = (state.transactions || []).filter(tx => String(tx.date || '').slice(0,7) === monthKey && tx.type === 'expense' && tx.category === b.category)
        .reduce((s,t) => s + (Number(t.amount) || 0), 0);
      const remaining = Math.max(0, (Number(b.amount) || 0) - spent);
      return { category: b.category, budget: Number(b.amount) || 0, spent, remaining };
    });

    host.innerHTML = rows.map(r => {
      return `<div class="row" style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px dashed var(--line)">
        <div><strong>${esc(r.category)}</strong><small class="muted">Budget</small></div>
        <div style="text-align:right">
          <div><small class="muted">Spent</small><div><b>${money(r.spent)}</b></div></div>
          <div style="margin-top:4px"><small class="muted">Remaining</small><div><b>${money(r.remaining)}</b></div></div>
        </div>
      </div>`;
    }).join('');
  }

  function renderGoalsList() {
    const host = $('goalsList');
    if (!host) return;
    const gs = state.goals || [];
    if (!gs.length) { host.innerHTML = `<div class="muted">No goals yet</div>`; return; }
    host.innerHTML = gs.map(g => {
      const progress = Number(g.progress) || 0;
      const target = Number(g.target) || 0;
      const pct = target > 0 ? Math.round((progress / target) * 100) : 0;
      return `<div class="row" style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px dashed var(--line)">
        <div><strong>${esc(g.title || g.name || 'Goal')}</strong><small class="muted">${esc(g.note || '')}</small></div>
        <div style="text-align:right"><small class="muted">${pct}%</small><div><b>${money(progress)}</b></div></div>
      </div>`;
    }).join('');
  }

  // --- Dashboard stats (new) ---
  function renderDashboardStats() {
    const monthKey = currentMonth();
    const rows = (state.transactions || []).filter(tx => String(tx.date || '').slice(0,7) === monthKey);
    // cashflow = net (income - expense - loan - credit) for current month
    const t = totals(rows);
    const cashflow = (t.income || 0) - (t.expense || 0) - (t.loan || 0) - (t.credit || 0);
    const cfEl = $('cashflow');
    if (cfEl) cfEl.textContent = money(cashflow);

    // top spending (by category) for current month
    const expenseRows = rows.filter(tx => tx.type === 'expense');
    const spendByCat = {};
    expenseRows.forEach(tx => {
      const cat = tx.category || tx.note || 'Other';
      spendByCat[cat] = (spendByCat[cat] || 0) + (Number(tx.amount) || 0);
    });
    let topCat = '—', topAmt = 0;
    for (const k in spendByCat) {
      if (spendByCat[k] > topAmt) { topAmt = spendByCat[k]; topCat = k; }
    }
    const topSpendEl = $('topSpend');
    if (topSpendEl) topSpendEl.textContent = topCat || '—';
    const topAmtEl = $('topAmt');
    if (topAmtEl) topAmtEl.textContent = money(topAmt);

    // largest activity: single txn with largest absolute amount in month
    let largestLabel = '—', largestAmt = 0;
    if (rows.length) {
      const sorted = rows.slice().sort((a,b) => Math.abs(Number(b.amount)||0) - Math.abs(Number(a.amount)||0));
      const l = sorted[0];
      largestLabel = l.category || l.note || l.type || '—';
      largestAmt = Number(l.amount) || 0;
    }
    const largestEl = $('largest');
    if (largestEl) largestEl.textContent = largestLabel;
    const largestAmtEl = $('largestAmt');
    if (largestAmtEl) largestAmtEl.textContent = money(largestAmt);

    // entries count
    const rhythmEl = $('rhythm');
    if (rhythmEl) rhythmEl.textContent = String(rows.length || 0);
  }

  // --- Trend chart rendering (vanilla canvas) ---
  function getLastNMonthKeys(n = 12, endISO = today) {
    const [eyear, emonth] = (endISO || today).slice(0,7).split('-').map(Number);
    const months = [];
    let y = eyear, m = emonth - 1; // JS month 0-based
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(y, m - i, 1));
      const ky = d.getUTCFullYear();
      const km = String(d.getUTCMonth() + 1).padStart(2, '0');
      months.push(`${ky}-${km}`);
    }
    return months;
  }

  function computeMonthlyNetFlow(monthKeys) {
    // net flow = income - expense - loan - credit (consistent with header computations)
    const map = {};
    (state.transactions || []).forEach(tx => {
      const key = String(tx.date || '').slice(0,7);
      if (!key) return;
      if (!map[key]) map[key] = 0;
      const amt = Number(tx.amount) || 0;
      if (tx.type === 'income') map[key] += amt;
      else if (tx.type === 'expense') map[key] -= amt;
      else if (tx.type === 'loan') map[key] -= amt;
      else if (tx.type === 'credit') map[key] -= amt;
    });
    return monthKeys.map(k => Number(map[k] || 0));
  }

  function renderTrendChart() {
    const canvas = $('chart');
    if (!canvas) return;
    // responsive sizing
    const parentWidth = canvas.parentElement ? canvas.parentElement.clientWidth : canvas.clientWidth || 600;
    const height = 220;
    canvas.width = Math.max(300, parentWidth * devicePixelRatio);
    canvas.height = Math.max(120, height * devicePixelRatio);
    canvas.style.width = parentWidth + 'px';
    canvas.style.height = height + 'px';
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0,0,canvas.width, canvas.height);
    ctx.save();
    ctx.scale(devicePixelRatio, devicePixelRatio);

    // Data
    const months = getLastNMonthKeys(12);
    const values = computeMonthlyNetFlow(months).map(v => Math.round(v));
    // axes padding
    const padLeft = 40, padRight = 12, padTop = 12, padBottom = 30;
    const w = (canvas.width / devicePixelRatio) - padLeft - padRight;
    const h = (canvas.height / devicePixelRatio) - padTop - padBottom;

    // find bounds
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === Infinity || max === -Infinity) { min = 0; max = 0; }
    // expand a bit for aesthetics
    const range = Math.max(1, max - min);
    max = Math.ceil(max + range * 0.1);
    min = Math.floor(min - range * 0.1);
    // grid lines (4)
    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    ctx.lineWidth = 1;
    ctx.font = '12px system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial';
    ctx.fillStyle = 'var(--muted, #999)';

    for (let i = 0; i <= 4; i++) {
      const y = padTop + (h * i / 4);
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + w, y);
      ctx.stroke();
      // label
      const val = Math.round(max - (i * (max - min) / 4));
      ctx.fillText(`${val.toLocaleString()}`, 6, y + 4);
    }

    // X labels
    ctx.textAlign = 'center';
    months.forEach((m, i) => {
      const x = padLeft + (w * (i / (months.length - 1 || 1)));
      const lab = m.slice(5); // MM
      ctx.fillText(lab, x, padTop + h + 18);
    });

    // line path
    ctx.beginPath();
    const points = values.map((v, i) => {
      const x = padLeft + (w * (i / (values.length - 1 || 1)));
      const y = padTop + ( (max - v) / (max - min || 1) * h );
      return { x, y };
    });

    // draw fill (subtle)
    if (points.length) {
      ctx.moveTo(points[0].x, points[0].y);
      for (let p of points) ctx.lineTo(p.x, p.y);
      ctx.lineTo(padLeft + w, padTop + h);
      ctx.lineTo(padLeft, padTop + h);
      ctx.closePath();
      ctx.fillStyle = 'rgba(62,149,205,0.08)';
      ctx.fill();
    }

    // draw line
    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(62,149,205,1)';
    if (points.length) {
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.stroke();
    }

    // draw points
    points.forEach((p, i) => {
      ctx.beginPath();
      ctx.fillStyle = 'white';
      ctx.strokeStyle = 'rgba(62,149,205,1)';
      ctx.lineWidth = 1.5;
      ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    // draw latest value box on top-right
    if (values.length) {
      const latest = values[values.length - 1];
      const txt = `${Math.round(latest).toLocaleString()} MMK`;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      const tw = ctx.measureText(txt).width + 14;
      const bx = padLeft + w - tw;
      const by = padTop + 6;
      ctx.fillRect(bx, by, tw, 22);
      ctx.fillStyle = 'white';
      ctx.fillText(txt, bx + tw / 2, by + 15);
    }

    ctx.restore();
  }

  // --- Transactions rendering with pagination / lazy loading ---
  function renderHeaderStats() {
    const monthKey = currentMonth();
    const xs = (state.transactions || []).filter(t => String(t.date || '').slice(0,7) === monthKey);
    const t = totals(xs);
    const remainingMoney = (t.income || 0) - (t.expense || 0) - (t.loan || 0) - (t.credit || 0);

    // compute days in month and days left relative to reportMonth
    const [ry, rm] = (monthKey || today.slice(0,7)).split('-').map(Number);
    const daysInMonth = new Date(ry, rm, 0).getDate(); // month end day
    let daysLeft;
    const realYear = new Date().getFullYear();
    const realMonth = new Date().getMonth() + 1;
    if (ry === realYear && rm === realMonth) {
      // current real month -> days left from today
      const now = new Date();
      daysLeft = Math.max(1, daysInMonth - now.getDate() + 1);
    } else {
      // for other months use full month days (future/past)
      daysLeft = daysInMonth;
    }

    const daily = Math.max(0, Math.floor(remainingMoney / daysLeft));
    const map = [['income', t.income], ['expense', t.expense], ['loan', t.loan], ['daily', daily], ['remaining', remainingMoney]];
    map.forEach(([id,val]) => {
      const el = $(id);
      if (!el) return;
      const strong = el.querySelector('strong');
      if (strong) strong.textContent = money(val); else el.textContent = money(val);
    });

    // Also render daily budgets panel if any budgets exist
    const dailyBudgetsHost = $('dailyBudgets');
    if (dailyBudgetsHost) {
      const bs = state.budgets || [];
      if (!bs.length) {
        dailyBudgetsHost.innerHTML = `<h4>Daily Budgets</h4><div class="muted">No budgets set</div>`;
      } else {
        // Show budget per day for each budget (monthly budget / daysInMonth)
        const rows = bs.map(b => {
          const perDay = Math.floor((Number(b.amount) || 0) / daysInMonth);
          return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px dashed var(--line)">
            <div><strong>${esc(b.category)}</strong><small class="muted">Monthly ${money(b.amount)}</small></div>
            <div style="text-align:right"><small class="muted">Per day</small><div><b>${money(perDay)}</b></div></div>
          </div>`;
        }).join('');
        dailyBudgetsHost.innerHTML = `<h4>Daily Budgets</h4>` + rows;
      }
    }
  }

  function renderTransactions() {
    // reversed list so newest appear first
    const xs = getAllTxSortedDesc();
    const recentDiv = $('recent');
    const recentTbody = $('recentRows');
    const txTbody = $('txRows');

    // Remove/hide recent list on Home page per request
    if (recentDiv) recentDiv.style.display = 'none';
    if (recentTbody) {
      const recentTable = recentTbody.closest('.panel') || recentTbody.parentElement;
      if (recentTable) recentTable.style.display = 'none';
    }

    // Ensure panels are scrollable (keeps the app usable when transactions grow large)
    if (txTbody) {
      const txPanel = txTbody.closest('.panel') || txTbody.parentElement;
      if (txPanel) {
        txPanel.style.maxHeight = '480px';
        txPanel.style.overflowY = 'auto';
      }
    }

    // Render header "Activity (count)" and transactions counter
    if ($('txCount')) $('txCount').textContent = `Activity (${(state.transactions||[]).length})`;
    if ($('txCountList')) $('txCountList').textContent = `Transactions (${(state.transactions||[]).length})`;

    if (!xs.length) {
      if (txTbody) txTbody.innerHTML = `<tr><td colspan="4" class="muted">No transactions</td></tr>`;
      const txPanel = txTbody ? (txTbody.closest('.panel') || txTbody.parentElement) : null;
      if (txPanel) {
        const pag = txPanel.querySelector('#txPagination');
        if (pag) pag.remove();
      }
      return;
    }

    // Pagination calculations
    const pageSize = Number(window.__moneyflow_tx_page_size || TX_PAGE_SIZE) || TX_PAGE_SIZE;
    txTotalPages = Math.max(1, Math.ceil(xs.length / pageSize));
    if (txCurrentPage > txTotalPages) txCurrentPage = txTotalPages;

    const start = (txCurrentPage - 1) * pageSize;
    const end = start + pageSize;
    const pageItems = xs.slice(start, end);

    // Ensure pagination controls exist and wire them
    ensureTxPaginationControls();
    const pageInfo = document.getElementById('txPageInfo');
    if (pageInfo) pageInfo.textContent = `Page ${txCurrentPage} / ${txTotalPages}`;

    // Render page rows efficiently
    if (txTbody) {
      txTbody.innerHTML = '';
      const frag = document.createDocumentFragment();
      pageItems.forEach(tx => {
        const tr = document.createElement('tr');
        const right = tx.type === 'income' ? `<b style="color:green">${money(tx.amount)}</b>` : `<b>${money(tx.amount)}</b>`;
        tr.innerHTML = `<td>${esc(tx.date || '')}</td>
          <td><div style="font-weight:700">${esc(tx.category || tx.note || tx.type)}</div><small class="muted">${esc(tx.note || '')} ${tx.loanId ? ' • ' + esc(tx.loanId) : ''}</small></td>
          <td>${right}</td>
          <td><button data-remove="${esc(tx.id)}" aria-label="Delete transaction" class="small delete">Delete</button></td>`;
        frag.appendChild(tr);
      });
      txTbody.appendChild(frag);
    }

    // Attach infinite-scroll once
    attachTxInfiniteScroll();
  }

  // Replace existing api() with a hardened, form-encoded POST to avoid CORS preflight and produce clearer errors.
  async function api(action, payload = {}) {
    if (!state.settings || !state.settings.syncUrl) throw new Error('Add the Apps Script URL first.');

    // Prepare form-encoded body
    const params = new URLSearchParams();
    params.append('action', action);
    params.append('payload', JSON.stringify(payload));

    let r;
    try {
      r = await fetch(state.settings.syncUrl, {
        method: 'POST',
        mode: 'cors',
        cache: 'no-store',
        redirect: 'follow',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'Accept': 'application/json, text/plain, */*'
        },
        body: params.toString()
      });
    } catch (fetchErr) {
      console.error('Fetch error in api():', fetchErr);
      throw new Error('Network error when contacting sync endpoint: ' + String(fetchErr));
    }

    // Try to parse JSON, fallback to text for better diagnostics
    const text = await r.text().catch(() => null);
    let parsed = null;
    if (text) {
      try { parsed = JSON.parse(text); } catch (e) { parsed = null; }
    }

    if (!r.ok) {
      const bodyMsg = parsed ? JSON.stringify(parsed) : text || ('status ' + r.status);
      throw new Error('Sync failed: ' + bodyMsg);
    }

    // If parsed JSON available return it, otherwise attempt to return text wrapped
    if (parsed) return parsed;
    try {
      return { ok: true, data: text ? safeParse(text, {}) : {} };
    } catch (e) {
      return { ok: true, data: {} };
    }
  }

  // queueSync sends state to server. scheduleSync debounces calls.
  async function queueSync() {
    if (!state.settings || !state.settings.syncUrl) return;
    try {
      const payload = {
        transactions: state.transactions || [],
        categories: state.categories || [],
        budgets: state.budgets || [],
        goals: state.goals || [],
        loans: state.loans || []
      };
      const res = await api('replaceAll', payload);
      if (res && res.data) {
        // update client state using authoritative server data (if provided)
        state.transactions = res.data.transactions || state.transactions || [];
        state.loans = res.data.loans || state.loans || [];
        state.categories = res.data.categories || state.categories || [];
        state.budgets = res.data.budgets || state.budgets || [];
        state.goals = res.data.goals || state.goals || [];
        saveState();
        renderAll();
      }
      // success toast is handled by caller or testSync; avoid verbose toasts here
      return res;
    } catch (e) {
      console.warn('sync failed', e);
      // bubble error up so callers can show toasts if needed
      throw e;
    }
  }

  // Debounced sync scheduler to avoid many rapid requests
  let _syncTimer = null;
  function scheduleSync(delay = 900) {
    if (_syncTimer) clearTimeout(_syncTimer);
    _syncTimer = setTimeout(async () => {
      _syncTimer = null;
      try {
        await queueSync();
      } catch (e) {
        // show a lightweight message but don't block app
        console.warn('Scheduled sync failed:', e);
      }
    }, delay);
  }

  // --- form submit and tab logic (keeps existing behavior) ---
  async function saveTransactionForm(e) {
    e.preventDefault();
    const amountInput = $('amount'), dateInput = $('date'), noteInput = $('note'), categorySelect = $('category');
    const activeTab = document.querySelector('.tabs button.active');
    const type = activeTab?.dataset?.type || state.currentType || 'expense';
    const amount = Number(amountInput?.value || 0);
    if (!amount || amount <= 0) { toast('Enter an amount greater than 0'); return; }
    const date = dateInput?.value || today;
    const note = noteInput?.value || '';
    const category = categorySelect?.value || '';
    let tx;
    if (type === 'loan') {
      const loanId = uid('loan');
      tx = { id: uid('tx'), type: 'income', amount, category: category || 'Loan', note, date, loanId, loanType: 'loan', createdAt: new Date().toISOString() };
      state.transactions.push(tx);
      state.loans = state.loans || [];
      state.loans.push({ id: loanId, name: note || 'Loan', principal: Number(amount), remaining: Number(amount), date, note, createdAt: tx.createdAt });
    } else if (type === 'credit') {
      const loanSelect = $('loanRepaySelect');
      const loanId = loanSelect && loanSelect.value;
      if (!loanId) { toast('Choose a loan to repay'); return; }
      tx = { id: uid('tx'), type: 'expense', amount, category: category || 'Loan Repayment', note, date, loanId, loanType: 'payback', createdAt: new Date().toISOString() };
      state.transactions.push(tx);
      const loan = (state.loans || []).find(l => String(l.id) === String(loanId));
      if (loan) loan.remaining = Math.max(0, (Number(loan.remaining)||0) - Number(amount));
    } else {
      tx = { id: uid('tx'), type: type === 'income' ? 'income' : 'expense', amount, category, note, date, createdAt: new Date().toISOString() };
      state.transactions.push(tx);
    }
    saveState();
    // after adding new tx, reset to first page to show newest
    txCurrentPage = 1;
    updateLoanRepaymentField(); renderAll(); toast('Saved');
    // schedule sync (debounced)
    try { scheduleSync(); } catch (_) {}
    showPage('home'); const form = $('form'); if (form) form.reset(); if ($('date')) $('date').value = today;
  }

  function wireTabs() {
    const tabs = document.querySelectorAll('.tabs [data-type]');
    if (!tabs || !tabs.length) return;
    tabs.forEach(btn => btn.addEventListener('click', () => {
      const t = btn.dataset.type;
      document.querySelectorAll('.tabs [data-type]').forEach(b => b.classList.toggle('active', b.dataset.type === t));
      state.currentType = t;
      populateCategories();
      if (t === 'credit') updateLoanRepaymentField();
      else { const h = $('loanSelectHolder'); if (h) { h.style.display = 'none'; h.innerHTML = ''; } }
      const title = $('formTitle'); if (title) {
        const titles = { expense: 'Add Expense', income: 'Add Income', loan: 'Record Loan', credit: 'Loan Repayment' };
        title.textContent = titles[t] || 'Add Transaction';
      }
    }));
    if (state.currentType) document.querySelectorAll('.tabs [data-type]').forEach(b => b.classList.toggle('active', b.dataset.type === state.currentType));
  }

  function updateNavDisplay(activePage) {
    const hideOnPages = ['add'];
    const bottomNav = q('nav.bottom-nav');
    const topNav = q('nav.top-nav') || q('.top-nav');
    if (hideOnPages.includes(activePage)) { if (bottomNav) bottomNav.classList.add('hidden'); if (topNav) topNav.classList.add('hidden'); return; }
    const wide = window.matchMedia && window.matchMedia('(min-width:900px)').matches;
    if (bottomNav) bottomNav.classList.toggle('hidden', wide);
    if (topNav) topNav.classList.toggle('hidden', !wide);
  }

  function showPage(id) {
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === id));
    document.querySelectorAll('[data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === id));
    updateNavDisplay(id);
    if (id === 'home') renderAll();
    if (id === 'settings') { const inp = $('syncUrlInput'); if (inp) inp.value = state.settings?.syncUrl || ''; }
  }

  function handleGlobalClicks(e) {
    const page = e.target.closest && e.target.closest('[data-page]');
    if (page) { showPage(page.dataset.page); return; }
    const add = e.target.closest && e.target.closest('[data-add]');
    if (add) {
      const type = add.dataset.add;
      const tab = document.querySelector(`.tabs [data-type="${type}"]`);
      if (tab) tab.click(); else { state.currentType = type; populateCategories(); }
      showPage('add'); return;
    }
    const rem = e.target.closest && e.target.closest('[data-remove]');
    if (rem) {
      const id = rem.dataset.remove;
      if (id) {
        state.transactions = (state.transactions || []).filter(t => String(t.id) !== String(id));
        saveState(); renderAll();
        scheduleSync();
      }
      return;
    }
  }

  function applyTheme() {
    document.body.classList.toggle('dark', state.settings?.theme === 'dark');
    document.querySelectorAll('.theme-toggle').forEach(btn => btn.textContent = state.settings?.theme === 'dark' ? '☾' : '☼');
    const cur = $('currentTheme'); if (cur) cur.textContent = state.settings?.theme || 'light';
    saveState();
  }

  // Insert Dashboard month filter control (type=month) into the Dashboard header area
  function ensureDashboardMonthControl() {
    const dashboard = $('dashboard');
    if (!dashboard) return;
    // try to insert into the .bi area if present, otherwise near the H1
    const target = dashboard.querySelector('.bi') || dashboard.querySelector('h1');
    if (!target) return;
    if (dashboard.querySelector('#dashboardMonthHolder')) return; // already added

    const holder = document.createElement('div');
    holder.id = 'dashboardMonthHolder';
    holder.style.display = 'flex';
    holder.style.gap = '8px';
    holder.style.alignItems = 'center';
    holder.style.marginLeft = 'auto';
    holder.style.marginTop = '6px';
    // label + input
    holder.innerHTML = `<label for="dashboardMonth" class="small muted" style="margin-right:6px">Month</label><input id="dashboardMonth" type="month" />`;
    // append: for responsive layout, append to the dashboard top area
    target.parentElement.insertBefore(holder, target.nextSibling);

    const inp = holder.querySelector('#dashboardMonth');
    if (inp) {
      inp.value = state.reportMonth || today.slice(0,7);
      inp.addEventListener('change', (e) => {
        const v = e.target.value;
        if (!v) return;
        // update report month and add carry over if needed
        state.reportMonth = v;
        saveState();
        // Add carry-over for this month if required
        carryOverIfMissingForMonth(v);
        renderAll();
      });
    }
    // Also set input to current state on render
    const inp2 = $('#dashboardMonth');
    if (inp2) inp2.value = state.reportMonth || today.slice(0,7);
  }

  // Insert Carry Over settings control into Settings panel (injected, no HTML file edit)
  function ensureCarryOverSettingsControl() {
    const settings = $('settings');
    if (!settings) return;
    if (settings.querySelector('#carryOverSettings')) return;

    const panel = settings.querySelector('.panel') || settings;
    // create a new block (small, non-invasive)
    const holder = document.createElement('div');
    holder.id = 'carryOverSettings';
    holder.style.marginTop = '12px';
    holder.className = 'panel';
    holder.innerHTML = `
      <h3>Carry Over</h3>
      <div style="display:flex;gap:8px;align-items:center;">
        <label class="small muted" for="carryOverEnable">Enable carry over</label>
        <input id="carryOverEnable" type="checkbox" />
        <label class="small muted" for="carryOverConfirm" style="margin-left:12px">Ask before adding</label>
        <input id="carryOverConfirm" type="checkbox" />
      </div>
      <small class="muted">When enabled, positive remaining from previous month is added as a "Carry Over" income on the 1st of the report month.</small>
    `;
    // place near other settings panels: append after the theme panel (find the Theme panel)
    const themePanel = Array.from(settings.querySelectorAll('.panel')).find(p => p.textContent && p.textContent.includes('Theme'));
    if (themePanel && themePanel.parentElement) themePanel.parentElement.insertBefore(holder, themePanel.nextSibling);
    else settings.appendChild(holder);

    const enable = holder.querySelector('#carryOverEnable');
    const confirmCb = holder.querySelector('#carryOverConfirm');
    if (enable) {
      enable.checked = state.settings?.carryOverEnabled !== false;
      enable.addEventListener('change', (e) => {
        state.settings = state.settings || {};
        state.settings.carryOverEnabled = !!e.target.checked;
        saveState();
        toast('Carry Over ' + (e.target.checked ? 'enabled' : 'disabled'));
      });
    }
    if (confirmCb) {
      confirmCb.checked = !!state.settings?.carryOverConfirm;
      confirmCb.addEventListener('change', (e) => {
        state.settings = state.settings || {};
        state.settings.carryOverConfirm = !!e.target.checked;
        saveState();
        toast('Carry Over confirmation ' + (e.target.checked ? 'on' : 'off'));
      });
    }
  }

  function renderAll() {
    // ensure dashboard month control exists before rendering statistics
    ensureDashboardMonthControl();
    ensureCarryOverSettingsControl();

    greeting(); populateCategories(); renderHeaderStats(); renderTransactions(); renderLoanSummary(); updateLoanRepaymentField();
    renderCategoriesList(); renderBudgetsList(); fillCategorySelects();
    renderBudgetReportSummary(); renderGoalsList(); renderTrendChart();
    renderDashboardStats(); // <-- update dashboard metrics correctly
    if ($('month')) $('month').value = currentMonth();
    if ($('txCount')) $('txCount').textContent = `Activity (${(state.transactions||[]).length})`;
    if ($('txCountList')) $('txCountList').textContent = `Transactions (${(state.transactions||[]).length})`;
    // dashboard month input sync
    const dbm = $('#dashboardMonth'); if (dbm) dbm.value = state.reportMonth || today.slice(0,7);
    // carry over ensure when rendering (in case month changed externally)
    carryOverIfMissingForMonth(state.reportMonth);
  }

  function greeting() {
    const h = new Date().getHours(); const part = h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : h < 21 ? 'Evening' : 'Night';
    if ($('greet')) $('greet').textContent = `GOOD ${part.toUpperCase()}`;
  }

  function wireEvents() {
    document.addEventListener('click', handleGlobalClicks);
    document.getElementById('form')?.addEventListener('submit', saveTransactionForm);
    document.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => showPage(b.dataset.page)));
    document.querySelectorAll('.theme-toggle').forEach(btn => btn.addEventListener('click', () => {
      state.settings = state.settings || {}; state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark'; saveState(); applyTheme();
    }));

    // category / budget events
    $('addCategory')?.addEventListener('click', addCategoryFromUI);
    $('resetDefaultCategories')?.addEventListener('click', resetDefaultCategories);
    $('addBudget')?.addEventListener('click', addBudgetFromUI);
    $('clearBudgets')?.addEventListener('click', clearBudgets);

    // sync events
    $('saveSyncUrl')?.addEventListener('click', () => {
      const url = ($('syncUrlInput')?.value || '').trim(); state.settings = state.settings || {}; state.settings.syncUrl = url; saveState(); toast(url ? 'Sync URL saved' : 'Sync URL cleared');
    });
    $('testSync')?.addEventListener('click', async () => {
      const url = ($('syncUrlInput')?.value || '').trim(); if (!url) { toast('Enter Apps Script URL first'); return; }
      state.settings = state.settings || {}; state.settings.syncUrl = url; saveState();
      try {
        // quick ping to check endpoint responsiveness
        const ping = await api('ping', {});
        if (ping && (ping.ok || ping.message)) {
          // if ping succeeded, run a push to confirm write access
          try {
            await queueSync();
            toast('Test sync done');
          } catch (e) {
            toast('Test sync (push) failed: ' + (e && e.message ? e.message : String(e)));
          }
        } else {
          toast('Ping did not return expected response');
        }
      } catch (e) {
        console.warn('ping failed', e);
        toast('Ping failed: ' + (e && e.message ? e.message : String(e)));
      }
    });
    $('pullFromSheets')?.addEventListener('click', async () => {
      const url = ($('syncUrlInput')?.value || '').trim(); if (!url) { toast('Enter Apps Script URL first'); return; }
      state.settings = state.settings || {}; state.settings.syncUrl = url; saveState();
      try {
        const res = await api('getAll', {});
        if (res && res.data) {
          state.transactions = res.data.transactions || state.transactions || [];
          state.loans = res.data.loans || state.loans || [];
          state.categories = res.data.categories || state.categories || [];
          state.budgets = res.data.budgets || state.budgets || [];
          state.goals = res.data.goals || state.goals || [];
          saveState(); renderAll(); toast('Pulled from sheet');
        } else {
          toast('No data from sheet');
        }
      } catch (e) { console.warn('pull failed', e); toast('Pull failed: ' + (e && e.message ? e.message : String(e))); }
    });

    $('clear')?.addEventListener('click', () => { if (!confirm('Clear all transactions?')) return; state.transactions = []; state.loans = []; saveState(); scheduleSync(); renderAll(); toast('Cleared'); });
    $('cancelAdd')?.addEventListener('click', () => showPage('home'));

    window.addEventListener('resize', () => {
      updateNavDisplay(document.querySelector('.page.active')?.id || 'home');
      // re-render chart responsively
      renderTrendChart();
    });
  }

  function init() {
    state = readState();
    state.transactions = Array.isArray(state.transactions) ? state.transactions : [];
    state.categories = Array.isArray(state.categories) ? state.categories : defaultCategories();
    state.budgets = Array.isArray(state.budgets) ? state.budgets : [];
    state.loans = Array.isArray(state.loans) ? state.loans : [];
    state.goals = Array.isArray(state.goals) ? state.goals : [];
    // ensure settings defaults exist
    state.settings = Object.assign({}, fallback().settings, state.settings || {});
    // init page size from settings
    window.__moneyflow_tx_page_size = Number(state.settings.txPageSize || window.__moneyflow_tx_page_size || TX_PAGE_SIZE);
    repairTransactionIds();
    applyTheme();
    wireEvents();
    wireTabs();
    // Ensure carry over for current report month is present if needed
    carryOverIfMissingForMonth(state.reportMonth);
    renderAll();
    showPage('home');
  }

  // expose for debugging
  window.moneyflow = {
    state,
    save: () => saveState(),
    renderAll,
    applyTheme,
    updateLoanRepaymentField,
    scheduleSync,
    // expose pagination controls for debugging/testing
    _tx: {
      pageSize: () => Number(window.__moneyflow_tx_page_size || TX_PAGE_SIZE),
      currentPage: () => txCurrentPage,
      totalPages: () => txTotalPages,
      goToPage: (p) => { txCurrentPage = p; renderTransactions(); }
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true }); else init();

})();
