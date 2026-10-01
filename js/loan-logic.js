// js/loan-logic.js - light helper that cooperates with main app
(() => {
  'use strict';
  const KEY = 'moneyflow-v3';
  const read = () => {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
  };
  const save = s => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };

  function normalize() {
    const s = read();
    s.transactions = Array.isArray(s.transactions) ? s.transactions : [];
    s.loans = Array.isArray(s.loans) ? s.loans : [];
    // create loans for income tx with loan keywords
    let changed = false;
    s.transactions.forEach(tx => {
      const cat = String(tx.category || '').toLowerCase();
      const isLoan = cat.includes('loan') && tx.type === 'income';
      if (isLoan && !tx.loanId) {
        tx.loanId = `loan-${tx.id || tx.createdAt || Date.now()}`;
        changed = true;
      }
    });
    if (changed) save(s);
    return s;
  }

  function refreshUI() {
    const s = normalize();
    if (window.moneyflow && window.moneyflow.renderAll) window.moneyflow.renderAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { normalize(); refreshUI(); }, { once:true });
  } else { normalize(); refreshUI(); }
})();
