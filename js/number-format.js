(() => {
  'use strict';
  const numericSelectors = 'input[type="number"], #amount, #budgetAmount, #goalTarget, #goalSaved';
  const rawValue = input => String(input.value || '').replace(/,/g, '');
  const format = value => {
    const raw = String(value ?? '').replace(/[^0-9.]/g, '');
    if (!raw) return '';
    const parts = raw.split('.');
    const integer = parts.shift().replace(/^0+(?=\d)/, '') || '0';
    return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (parts.length ? `.${parts.join('')}` : '');
  };
  const prepare = input => {
    if (!input || input.dataset.commaReady === 'true') return;
    input.dataset.commaReady = 'true';
    input.type = 'text';
    input.inputMode = 'decimal';
    input.autocomplete = 'off';
    input.classList.add('formatted-number');
    input.addEventListener('input', () => {
      const start = input.selectionStart || 0;
      const before = input.value.slice(0, start).replace(/,/g, '').length;
      input.value = format(input.value);
      let position = 0, count = 0;
      while (position < input.value.length && count < before) {
        if (input.value[position] !== ',') count++;
        position++;
      }
      input.setSelectionRange(position, position);
    });
    input.addEventListener('blur', () => { input.value = format(input.value); });
    input.closest('form')?.addEventListener('submit', () => { input.value = rawValue(input); }, { once: false });
    input.value = format(input.value);
  };
  const scan = () => document.querySelectorAll(numericSelectors).forEach(prepare);
  const style = document.createElement('style');
  style.textContent = '.formatted-number{width:100%;min-width:0;font-variant-numeric:tabular-nums;text-align:right}.formatted-number:focus{outline:2px solid var(--accent,#6366f1);outline-offset:1px}@media(max-width:520px){.formatted-number{font-size:16px;padding:12px 10px}.amount .formatted-number{text-align:left}}';
  document.head.appendChild(style);
  scan();
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
})();
