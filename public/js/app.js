// ============================================================
// ElectraPay front end (vanilla JS, talks to the Express API)
// ============================================================
(function () {
  'use strict';

  const API = '/api';
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const state = {
    token: safeGet('electrapay_token'),
    customer: null,
    view: 'overview',
    usage: null,
    summary: null,
    bills: [],
    payments: [],
    options: { outlets: [], otcValidDays: 3 },
    charts: {},
    pay: null,
  };

  // ---------- small helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
  const pesoWhole = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 });
  const num = (n) => Number(n || 0).toLocaleString('en-PH');
  const fmtDate = (d) => new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
  const fmtDateTime = (d) => new Date(d).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const period = (b) => `${MONTHS[b.month - 1]} ${b.year}`;
  const icon = (name) => `<svg class="ic"><use href="#i-${name}"/></svg>`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function safeGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function safeSet(key, val) { try { val == null ? localStorage.removeItem(key) : localStorage.setItem(key, val); } catch (e) { /* storage unavailable */ } }

  async function api(path, options = {}) {
    const res = await fetch(API + path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
        ...(options.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && state.token) {
      signOut();
      throw new Error('Your session ended. Please log in again.');
    }
    if (!res.ok) throw new Error(data.message || 'Something went wrong. Please try again.');
    return data;
  }

  let toastTimer;
  function toast(message, isError = false) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.toggle('is-error', isError);
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 3800);
  }

  // ============================================================
  // Sign in / create account
  // ============================================================
  $$('.auth-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.auth-tab').forEach((t) => t.classList.toggle('active', t === tab));
      $('#login-form').classList.toggle('hidden', tab.dataset.tab !== 'login');
      $('#register-form').classList.toggle('hidden', tab.dataset.tab !== 'register');
      $('#auth-error').classList.add('hidden');
    });
  });

  async function submitAuth(form, path, buildBody) {
    const btn = $('button[type="submit"]', form);
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Please wait';
    $('#auth-error').classList.add('hidden');
    try {
      const data = await api(path, { method: 'POST', body: JSON.stringify(buildBody(new FormData(form))) });
      state.token = data.token;
      state.customer = data.customer;
      safeSet('electrapay_token', data.token);
      form.reset();
      enterApp();
    } catch (err) {
      const el = $('#auth-error');
      el.textContent = err.message;
      el.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  $('#login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submitAuth(e.target, '/auth/login', (fd) => ({ email: fd.get('email'), password: fd.get('password') }));
  });
  $('#register-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submitAuth(e.target, '/auth/register', (fd) => Object.fromEntries(fd.entries()));
  });

  function signOut() {
    state.token = null;
    state.customer = null;
    state.usage = state.summary = null;
    state.bills = [];
    state.payments = [];
    safeSet('electrapay_token', null);
    closeModal();
    $('#app').classList.add('hidden');
    $('#auth-screen').classList.remove('hidden');
  }
  $('#logout-btn').addEventListener('click', signOut);

  // ============================================================
  // App start and data loading
  // ============================================================
  async function enterApp() {
    $('#auth-screen').classList.add('hidden');
    $('#app').classList.remove('hidden');
    try {
      if (!state.customer || !state.customer.name) state.customer = await api('/customers/me');
      paintAccount();
      state.options = await api('/payments/options');
      await loadData();
    } catch (err) {
      if (state.token) toast(err.message, true);
    }
    if (state.token) showView('overview');
  }

  function paintAccount() {
    const c = state.customer;
    $('#account-name').textContent = c.name;
    $('#account-number').textContent = `Account ${c.accountNumber}`;
    $('#account-initial').textContent = c.name.charAt(0).toUpperCase();
  }

  async function loadData() {
    const [usage, summary, bills, payments] = await Promise.all([
      api('/analytics/usage'),
      api('/analytics/summary'),
      api('/bills'),
      api('/payments'),
    ]);
    state.usage = usage;
    state.summary = summary;
    state.bills = bills;
    state.payments = payments;
    renderView(state.view);
  }

  // ============================================================
  // Navigation
  // ============================================================
  function showView(name) {
    state.view = name;
    $$('.view').forEach((v) => v.classList.toggle('hidden', v.id !== `view-${name}`));
    $$('.side-link').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    renderView(name);
    window.scrollTo(0, 0);
  }

  function renderView(name) {
    if (!state.usage || !state.summary) return;
    if (name === 'overview') renderOverview();
    if (name === 'usage') renderUsage();
    if (name === 'bills') renderBills();
    if (name === 'payments') renderPayments();
  }

  // ============================================================
  // Overview
  // ============================================================
  function greeting() {
    const h = new Date().getHours();
    const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    return `${part}, ${(state.customer.name || '').split(' ')[0]}`;
  }

  function renderOverview() {
    $('#greeting').textContent = greeting();
    renderDueCard();
    renderDial();
    renderStrip('#overview-strip', 'overview');
    renderUsageChart('chart-overview');
    renderRecent();
  }

  function renderDueCard() {
    const { nextBill, pendingBill, pendingPaymentId, otherOpenBills, totalPaid12Months } = state.summary;
    const el = $('#due-card');

    if (nextBill) {
      const overdue = nextBill.status === 'overdue';
      el.innerHTML = `
        <div class="stub-top">
          <div class="stub-row"><span class="stub-label">Amount due</span><span class="pill pill-${nextBill.status}">${overdue ? 'Overdue' : 'Unpaid'}</span></div>
          <div class="stub-amount">${peso.format(nextBill.amount)}</div>
          <div class="stub-sub">Bill for ${period(nextBill)}: ${num(nextBill.kilowattHours)} kWh at ${peso.format(nextBill.ratePerKwh)} per kWh</div>
        </div>
        <div class="stub-tear"></div>
        <div class="stub-bottom">
          <div>
            <div class="stub-due">${overdue ? 'Was due' : 'Due'} ${fmtDate(nextBill.dueDate)}</div>
            <div class="stub-note">${otherOpenBills ? `${otherOpenBills} more unpaid bill${otherOpenBills > 1 ? 's' : ''} after this one` : 'Pay with GCash, a card, or over the counter'}</div>
          </div>
          <button class="btn btn-primary" data-action="pay" data-bill="${nextBill._id}">Pay ${peso.format(nextBill.amount)}</button>
        </div>`;
    } else if (pendingBill) {
      el.innerHTML = `
        <div class="stub-top">
          <div class="stub-row"><span class="stub-label">Waiting for your counter payment</span><span class="pill pill-pending">Pending</span></div>
          <div class="stub-amount">${peso.format(pendingBill.amount)}</div>
          <div class="stub-sub">Bill for ${period(pendingBill)}</div>
        </div>
        <div class="stub-tear"></div>
        <div class="stub-bottom">
          <div>
            <div class="stub-due">Payment slip created</div>
            <div class="stub-note">Show it at the counter before it expires</div>
          </div>
          <button class="btn btn-primary" data-action="view-payment" data-id="${pendingPaymentId}">View payment slip</button>
        </div>`;
    } else if (state.bills.length) {
      el.innerHTML = `
        <div class="stub-top">
          <div class="stub-done">${icon('check')}<div><div class="stub-amount" style="margin:0;font-size:30px">You are all paid up</div></div></div>
          <div class="stub-sub" style="margin-top:12px">You paid ${peso.format(totalPaid12Months)} over the last 12 months.</div>
        </div>
        <div class="stub-tear"></div>
        <div class="stub-bottom">
          <div><div class="stub-due">Nothing due right now</div><div class="stub-note">Your next bill appears after your next meter reading</div></div>
          <button class="btn btn-ghost" data-view-link="payments">See payments</button>
        </div>`;
    } else {
      el.innerHTML = `
        <div class="stub-top">
          <div class="stub-row"><span class="stub-label">Amount due</span></div>
          <div class="stub-amount">${peso.format(0)}</div>
          <div class="stub-sub">No bill yet. Add your first meter reading and ElectraPay works out the bill for you.</div>
        </div>
        <div class="stub-tear"></div>
        <div class="stub-bottom">
          <div class="stub-note">Your meter shows kilowatt-hours (kWh) used</div>
          <button class="btn btn-primary" data-action="add-reading">Add meter reading</button>
        </div>`;
    }
  }

  // The meter dial: a half-circle gauge, scaled to the highest month in the last year.
  function renderDial() {
    const u = state.usage;
    const value = u.current.kilowattHours;
    const peak = u.totals.peakMonth ? u.totals.peakMonth.kilowattHours : 0;
    const max = Math.max(50, Math.ceil((Math.max(peak, value) * 1.15) / 50) * 50);
    const ratio = Math.min(value / max, 1);
    const cx = 120;
    const cy = 108;
    const polar = (r, t) => ({ x: cx + r * Math.cos(Math.PI + t * Math.PI), y: cy + r * Math.sin(Math.PI + t * Math.PI) });
    const arc = (r, from, to) => {
      const a = polar(r, from);
      const b = polar(r, Math.min(to, 0.999));
      return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
    };

    let ticks = '';
    for (let k = 0; k <= 20; k += 1) {
      const major = k % 5 === 0;
      const a = polar(major ? 88 : 90, k / 20);
      const b = polar(major ? 98 : 94, k / 20);
      ticks += `<line x1="${a.x.toFixed(2)}" y1="${a.y.toFixed(2)}" x2="${b.x.toFixed(2)}" y2="${b.y.toFixed(2)}" stroke="${major ? '#12203d' : '#b9c3d8'}" stroke-width="${major ? 2 : 1.2}" stroke-linecap="round"/>`;
    }

    const angle = (ratio - 0.5) * 180;
    $('#dial').innerHTML = `
      <svg viewBox="0 0 240 180" role="img" aria-label="${num(value)} kilowatt-hours used in ${esc(u.current.label)}">
        ${ticks}
        <path d="${arc(76, 0, 1)}" fill="none" stroke="#e8ecf4" stroke-width="12" stroke-linecap="round"/>
        ${value > 0 ? `<path d="${arc(76, 0, Math.max(ratio, 0.01))}" fill="none" stroke="#f5a300" stroke-width="12" stroke-linecap="round"/>` : ''}
        <g class="needle" style="transform: rotate(-90deg)" data-angle="${angle.toFixed(1)}">
          <line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - 64}" stroke="#12203d" stroke-width="3" stroke-linecap="round"/>
        </g>
        <circle cx="${cx}" cy="${cy}" r="7" fill="#12203d"/>
        <circle cx="${cx}" cy="${cy}" r="2.5" fill="#f5a300"/>
        <text x="44" y="130" text-anchor="middle" font-size="11" fill="#6a7590">0</text>
        <text x="196" y="130" text-anchor="middle" font-size="11" fill="#6a7590">${num(max)}</text>
        <text x="${cx}" y="153" text-anchor="middle" font-size="32" font-weight="600" fill="#12203d" style="font-family:var(--font-display)">${num(value)} kWh</text>
        <text x="${cx}" y="172" text-anchor="middle" font-size="12" fill="#6a7590">used in ${esc(u.current.label)}</text>
      </svg>`;

    const needle = $('#dial .needle');
    requestAnimationFrame(() => requestAnimationFrame(() => { needle.style.transform = `rotate(${needle.dataset.angle}deg)`; }));

    $('#dial-compare').innerHTML =
      compareLine(u.current.changeVsLastMonth, 'last month') + compareLine(u.current.changeVsLastYear, 'the same month last year');
  }

  function compareLine(change, what) {
    if (change === null || change === undefined) {
      return `<li><span class="arrow arrow-flat"></span>Not enough history to compare with ${what}</li>`;
    }
    if (Math.abs(change) < 0.05) return `<li><span class="arrow arrow-flat"></span>About the same as ${what}</li>`;
    const more = change > 0;
    return `<li><span class="arrow ${more ? 'arrow-up' : 'arrow-down'}"></span>${Math.abs(change)}% ${more ? 'more' : 'less'} than ${what}</li>`;
  }

  function renderStrip(selector, kind) {
    const u = state.usage;
    const t = u.totals;
    const yoy = u.yearOverYear;
    const yoyNote = yoy === null
      ? '<div class="strip-note">No data from the year before yet</div>'
      : `<div class="strip-note ${yoy > 0 ? 'up' : 'down'}">${Math.abs(yoy)}% ${yoy > 0 ? 'more' : 'less'} than the year before</div>`;

    const items = [
      { label: 'Used in 12 months', value: `${num(t.totalKwh)}<small>kWh</small>`, note: yoyNote },
      { label: 'Monthly average', value: `${num(Math.round(t.averageKwh))}<small>kWh</small>`, note: `<div class="strip-note">About ${pesoWhole.format(t.averageKwh * u.ratePerKwh)} a month</div>` },
      { label: 'Highest month', value: t.peakMonth ? `${num(t.peakMonth.kilowattHours)}<small>kWh</small>` : '0<small>kWh</small>', note: `<div class="strip-note">${t.peakMonth ? esc(t.peakMonth.label) : 'No readings yet'}</div>` },
    ];

    if (kind === 'usage') {
      items.push({ label: 'Lowest month', value: t.lowestMonth ? `${num(t.lowestMonth.kilowattHours)}<small>kWh</small>` : '0<small>kWh</small>', note: `<div class="strip-note">${t.lowestMonth ? esc(t.lowestMonth.label) : 'No readings yet'}</div>` });
    } else {
      items.push({ label: 'Estimated cost, 12 months', value: pesoWhole.format(t.totalEstimatedCost), note: `<div class="strip-note">At ${peso.format(u.ratePerKwh)} per kWh</div>` });
    }

    $(selector).innerHTML = items
      .map((i) => `<div class="strip-item"><div class="strip-label">${i.label}</div><div class="strip-value">${i.value}</div>${i.note}</div>`)
      .join('');
  }

  // ============================================================
  // Charts
  // ============================================================
  function drawChart(canvasId, config) {
    const canvas = document.getElementById(canvasId);
    if (!window.Chart) {
      const box = canvas.parentElement;
      if (!box.querySelector('.empty')) box.insertAdjacentHTML('beforeend', '<p class="empty">The chart could not load. Check your internet connection and refresh the page.</p>');
      canvas.style.display = 'none';
      return;
    }
    window.Chart.defaults.font.family = "'Public Sans', 'Segoe UI', sans-serif";
    window.Chart.defaults.color = '#6a7590';
    if (state.charts[canvasId]) state.charts[canvasId].destroy();
    state.charts[canvasId] = new window.Chart(canvas, config);
  }

  function renderUsageChart(canvasId) {
    const u = state.usage;
    const last = u.labels.length - 1;
    drawChart(canvasId, {
      type: 'bar',
      data: {
        labels: u.labels,
        datasets: [
          { label: 'Last 12 months', data: u.kilowattHours, backgroundColor: u.labels.map((_, i) => (i === last ? '#12203d' : '#f5a300')), borderRadius: 5, maxBarThickness: 26 },
          { label: 'Year before', data: u.priorYearKilowattHours, backgroundColor: '#c3cde0', borderRadius: 5, maxBarThickness: 26 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${num(c.parsed.y)} kWh` } },
        },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, border: { display: false }, grid: { color: '#edf0f6' }, ticks: { callback: (v) => num(v) } },
        },
      },
    });
  }

  function renderCostChart() {
    const u = state.usage;
    drawChart('chart-cost', {
      type: 'line',
      data: {
        labels: u.labels,
        datasets: [{
          label: 'Estimated cost',
          data: u.estimatedCost,
          borderColor: '#12203d',
          backgroundColor: 'rgba(18,32,61,.08)',
          fill: true,
          tension: 0.3,
          pointRadius: 3,
          pointBackgroundColor: '#f5a300',
          pointBorderColor: '#12203d',
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => peso.format(c.parsed.y) } } },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, border: { display: false }, grid: { color: '#edf0f6' }, ticks: { callback: (v) => `\u20b1${num(v)}` } },
        },
      },
    });
  }

  // ============================================================
  // Usage analytics view
  // ============================================================
  function renderUsage() {
    const u = state.usage;
    renderStrip('#usage-strip', 'usage');
    renderUsageChart('chart-usage');
    renderCostChart();
    $('#rate-note').textContent = `Each kWh is charged at ${peso.format(u.ratePerKwh)}. These figures multiply your kWh by that rate.`;

    let rows = '';
    for (let i = u.labels.length - 1; i >= 0; i -= 1) {
      const change = u.yoyChange[i];
      const changeCell = change === null
        ? '<span class="cell-sub">No data</span>'
        : `<span class="${change > 0 ? 'up' : change < 0 ? 'down' : ''}">${change > 0 ? '+' : ''}${change}%</span>`;
      rows += `<tr>
        <td><strong>${esc(u.labels[i])}</strong></td>
        <td class="num">${num(u.kilowattHours[i])} kWh</td>
        <td class="num">${u.priorYearKilowattHours[i] ? `${num(u.priorYearKilowattHours[i])} kWh` : '<span class="cell-sub">No data</span>'}</td>
        <td class="num">${changeCell}</td>
        <td class="num">${peso.format(u.estimatedCost[i])}</td>
      </tr>`;
    }
    setTable('#usage-table',
      '<th>Month</th><th class="num">Used</th><th class="num">Same month last year</th><th class="num">Change</th><th class="num">Estimated cost</th>',
      rows, '', 5);
  }

  function setTable(selector, head, rows, emptyHtml, cols) {
    $(selector).innerHTML = rows
      ? `<thead><tr>${head}</tr></thead><tbody>${rows}</tbody>`
      : `<tbody><tr><td class="empty" colspan="${cols}">${emptyHtml}</td></tr></tbody>`;
  }

  // ============================================================
  // Bills and payments views
  // ============================================================
  const STATUS_LABEL = { paid: 'Paid', completed: 'Paid', unpaid: 'Unpaid', overdue: 'Overdue', pending: 'Awaiting payment', expired: 'Expired', cancelled: 'Cancelled', failed: 'Failed' };
  const pill = (status) => `<span class="pill pill-${esc(status)}">${STATUS_LABEL[status] || esc(status)}</span>`;

  function methodName(m) {
    return m === 'Debit/Credit Card' ? 'Debit or credit card' : m === 'Over the Counter' ? 'Over the counter' : 'GCash';
  }
  function methodSub(p) {
    const d = p.details || {};
    if (p.method === 'GCash') return d.mobile || '';
    if (p.method === 'Debit/Credit Card') return `${d.cardBrand || 'Card'} ending ${d.cardLast4 || '----'}`;
    return d.outlet || '';
  }
  function methodDot(m) {
    if (m === 'GCash') return `<span class="method-dot method-dot-gcash">${icon('phone')}</span>`;
    if (m === 'Debit/Credit Card') return `<span class="method-dot method-dot-card">${icon('card')}</span>`;
    return `<span class="method-dot method-dot-otc">${icon('store')}</span>`;
  }

  function renderBills() {
    const rows = state.bills.map((b) => {
      let action = `<button class="btn btn-primary btn-sm" data-action="pay" data-bill="${b._id}">Pay</button>`;
      if (b.status === 'paid') action = b.payment ? `<button class="btn btn-ghost btn-sm" data-action="view-payment" data-id="${b.payment.id}">Receipt</button>` : '';
      if (b.status === 'pending') action = b.payment ? `<button class="btn btn-ghost btn-sm" data-action="view-payment" data-id="${b.payment.id}">View slip</button>` : '';
      return `<tr>
        <td><strong>${period(b)}</strong></td>
        <td class="num">${num(b.kilowattHours)} kWh</td>
        <td class="num">${peso.format(b.ratePerKwh)}</td>
        <td class="num"><strong>${peso.format(b.amount)}</strong></td>
        <td>${fmtDate(b.dueDate)}</td>
        <td>${pill(b.status)}</td>
        <td class="num">${action}</td>
      </tr>`;
    }).join('');

    setTable('#bills-table',
      '<th>Bill</th><th class="num">Used</th><th class="num">Rate per kWh</th><th class="num">Amount</th><th>Due date</th><th>Status</th><th></th>',
      rows,
      '<strong>No bills yet</strong>Add a meter reading and ElectraPay will make your first bill.', 7);
  }

  function renderPayments() {
    const rows = state.payments.map((p) => {
      const when = p.paidAt || p.createdAt;
      const bill = p.bill && p.bill.year ? period(p.bill) : '';
      const sub = p.status === 'pending' && p.expiresAt ? `<span class="cell-sub">Pay before ${fmtDate(p.expiresAt)}</span>` : '';
      const action = p.status === 'completed' || p.status === 'pending'
        ? `<button class="btn btn-ghost btn-sm" data-action="view-payment" data-id="${p._id}">${p.status === 'pending' ? 'View slip' : 'Receipt'}</button>` : '';
      return `<tr>
        <td>${fmtDate(when)}</td>
        <td>${bill}</td>
        <td><strong>${methodName(p.method)}</strong><span class="cell-sub">${esc(methodSub(p))}</span></td>
        <td class="ref">${esc(p.reference)}</td>
        <td class="num"><strong>${peso.format(p.amount)}</strong></td>
        <td>${pill(p.status)}${sub}</td>
        <td class="num">${action}</td>
      </tr>`;
    }).join('');

    setTable('#payments-table',
      '<th>Date</th><th>Bill</th><th>Paid with</th><th>Reference</th><th class="num">Amount</th><th>Status</th><th></th>',
      rows,
      '<strong>No payments yet</strong>Pay a bill with GCash, a card, or over the counter and it shows up here.', 7);
  }

  function renderRecent() {
    const list = state.payments.slice(0, 4);
    $('#recent-payments').innerHTML = list.length
      ? list.map((p) => `
        <div class="list-row">
          ${methodDot(p.method)}
          <div class="list-main">
            <div class="list-title">${p.bill && p.bill.year ? `${period(p.bill)} bill` : 'Bill payment'}</div>
            <div class="list-sub">${methodName(p.method)} on ${fmtDate(p.paidAt || p.createdAt)}</div>
          </div>
          ${p.status === 'completed' ? '' : pill(p.status)}
          <div class="list-amount">${peso.format(p.amount)}</div>
        </div>`).join('')
      : '<div class="empty"><strong>No payments yet</strong>Your payments will show up here.</div>';
  }

  // ============================================================
  // Modal
  // ============================================================
  const modal = $('#modal');
  const card = $('#modal-card');
  let lastFocus = null;

  function openModal() {
    lastFocus = document.activeElement;
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    const first = card.querySelector('.method, .fields input, select, input, button');
    if (first) first.focus({ preventScroll: true });
  }

  function closeModal() {
    modal.classList.add('hidden');
    document.body.style.overflow = '';
    card.innerHTML = '';
    state.pay = null;
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  const modalBusy = () => state.pay && state.pay.busy;
  modal.addEventListener('mousedown', (e) => { if (e.target === modal && !modalBusy()) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.classList.contains('hidden') && !modalBusy()) closeModal(); });

  // ============================================================
  // Checkout: GCash, card, or over the counter
  // ============================================================
  const blankForm = () => ({ mobile: '', number: '', name: '', expiry: '', cvv: '' });

  function openPay(billId) {
    const bill = state.bills.find((b) => b._id === billId) || (state.summary.nextBill && state.summary.nextBill._id === billId ? state.summary.nextBill : null);
    if (!bill) { toast('That bill could not be found.', true); return; }
    state.pay = { bill, method: null, step: 'choose', form: blankForm(), outlet: state.options.outlets[0] || '', error: '', busy: false, payment: null };
    renderPay();
    openModal();
  }

  async function openPaymentView(id) {
    const payment = await api(`/payments/${id}`);
    state.pay = { bill: payment.bill, method: payment.method, step: 'result', form: blankForm(), outlet: '', error: '', busy: false, payment };
    renderPay();
    openModal();
  }

  function renderPay() {
    const p = state.pay;
    if (!p) return;
    card.innerHTML = p.step === 'choose' ? chooseHtml(p) : p.step === 'gcash' ? gcashHtml(p) : resultHtml(p);
  }

  const closeButton = `<button class="close-btn" data-action="close" aria-label="Close">${icon('x')}</button>`;

  function chooseHtml(p) {
    const b = p.bill;
    const methods = [
      { id: 'GCash', name: 'GCash', sub: 'Pay with your mobile wallet', ic: 'phone', dot: 'gcash' },
      { id: 'Debit/Credit Card', name: 'Debit or credit card', sub: 'Visa, Mastercard, JCB', ic: 'card', dot: 'card' },
      { id: 'Over the Counter', name: 'Over the counter', sub: 'Pay cash at a partner outlet', ic: 'store', dot: 'otc' },
    ];
    const submit = !p.method ? 'Choose how to pay'
      : p.method === 'GCash' ? 'Continue to GCash'
      : p.method === 'Debit/Credit Card' ? `Pay ${peso.format(b.amount)}`
      : 'Get payment slip';

    return `
      <div class="modal-head">
        <div><h2>Pay your bill</h2><p>${period(b)} electricity, ${num(b.kilowattHours)} kWh</p></div>
        ${closeButton}
      </div>
      <div class="amount-banner"><span>Total to pay</span><strong>${peso.format(b.amount)}</strong></div>
      <h3 class="step-title">How would you like to pay?</h3>
      <div class="methods">
        ${methods.map((m) => `
          <button type="button" class="method" data-action="method" data-method="${m.id}" aria-pressed="${p.method === m.id}">
            <span class="method-dot method-dot-${m.dot}">${icon(m.ic)}</span>
            <span class="method-name">${m.name}</span>
            <span class="method-sub">${m.sub}</span>
          </button>`).join('')}
      </div>
      ${p.method ? methodForm(p) : ''}
      ${p.error ? `<p class="inline-error" role="alert">${esc(p.error)}</p>` : ''}
      <div class="modal-foot">
        <span class="secure">${icon('lock')}Demo checkout. No real money is charged.</span>
        <button class="btn btn-primary" data-action="submit-pay" ${p.method ? '' : 'disabled'}>${submit}</button>
      </div>`;
  }

  function methodForm(p) {
    const f = p.form;
    if (p.method === 'GCash') {
      return `
        <div class="fields">
          <label>GCash mobile number
            <input id="f-mobile" inputmode="numeric" autocomplete="tel" maxlength="13" placeholder="0917 123 4567" value="${esc(f.mobile)}" />
          </label>
          <p class="field-help">Next, you approve the payment in GCash.</p>
        </div>`;
    }
    if (p.method === 'Debit/Credit Card') {
      const digits = f.number.replace(/\s/g, '');
      return `
        <div class="fields">
          <label><span class="label-row">Card number <span class="brand-tag" id="brand-tag">${digits ? cardLabel(digits) : ''}</span></span>
            <input id="f-number" inputmode="numeric" autocomplete="cc-number" maxlength="23" placeholder="1234 5678 9012 3456" value="${esc(f.number)}" />
          </label>
          <label>Name on card
            <input id="f-name" autocomplete="cc-name" placeholder="As printed on the card" value="${esc(f.name)}" />
          </label>
          <div class="fields-2">
            <label>Expiry date
              <input id="f-expiry" inputmode="numeric" autocomplete="cc-exp" maxlength="5" placeholder="MM/YY" value="${esc(f.expiry)}" />
            </label>
            <label>CVV
              <input id="f-cvv" type="password" inputmode="numeric" autocomplete="cc-csc" maxlength="4" placeholder="3 digits" value="${esc(f.cvv)}" />
            </label>
          </div>
          <p class="field-help">Try the demo card 4242 4242 4242 4242 with any future date and any 3 digits. ElectraPay saves only the card type and last 4 digits.</p>
        </div>`;
    }
    return `
      <div class="fields">
        <div class="outlets" role="radiogroup" aria-label="Where will you pay?">
          ${state.options.outlets.map((o) => `<label class="outlet"><input type="radio" name="outlet" value="${esc(o)}" ${o === p.outlet ? 'checked' : ''} />${esc(o)}</label>`).join('')}
        </div>
        <div class="callout">${icon('alert')}<span>You get a reference number and barcode that stay valid for ${state.options.otcValidDays} days. Show it at the counter and pay the exact amount in cash. Your bill is marked paid once the outlet confirms it.</span></div>
      </div>`;
  }

  function gcashHtml(p) {
    const b = p.bill;
    const m = p.form.mobile.replace(/\s/g, '');
    const shown = `${m.slice(0, 4)} ${m.slice(4, 7)} ${m.slice(7)}`;
    return `
      <div class="modal-head">
        <div><h2>Approve in GCash</h2><p>This is a demo of the GCash approval step.</p></div>
        ${closeButton}
      </div>
      <div class="gcash">
        <div class="gcash-word">GCash</div>
        <p>Pay ElectraPay</p>
        <div class="gcash-amount">${peso.format(b.amount)}</div>
        <dl>
          <div><dt>Mobile number</dt><dd>${esc(shown)}</dd></div>
          <div><dt>Bill</dt><dd>${period(b)} electricity</dd></div>
        </dl>
      </div>
      ${p.error ? `<p class="inline-error" role="alert">${esc(p.error)}</p>` : ''}
      <div class="modal-actions">
        <button class="btn btn-ghost" data-action="back">Back</button>
        <button class="btn btn-gcash" data-action="authorize">Authorize payment</button>
      </div>`;
  }

  // ----- results: receipt, counter slip, or a note when a slip is no longer valid -----
  const billOf = (payment, p) => (payment.bill && typeof payment.bill === 'object' ? payment.bill : p.bill);

  function resultHtml(p) {
    const pay = p.payment;
    const bill = billOf(pay, p);
    if (pay.status === 'completed') {
      return `
        <div class="modal-head"><div></div>${closeButton}</div>
        <div class="done-head">${icon('check')}<h2>Payment received</h2><p>Thank you. Your ${period(bill)} bill is paid.</p></div>
        ${receiptPaper(pay, bill)}
        <div class="modal-actions">
          <button class="btn btn-ghost" data-action="print">${icon('print')}Print receipt</button>
          <button class="btn btn-dark" data-action="close">Done</button>
        </div>`;
    }
    if (pay.status === 'pending') {
      return `
        <div class="modal-head">
          <div><h2>Your payment slip</h2><p>Show this at the counter to pay your ${period(bill)} bill.</p></div>
          ${closeButton}
        </div>
        ${slipPaper(pay, bill)}
        <ol class="steps">
          <li>Go to ${esc((pay.details || {}).outlet || 'the outlet')} and say you are paying an ElectraPay electricity bill.</li>
          <li>Give the cashier the reference number, or let them scan the barcode.</li>
          <li>Pay the exact amount in cash and keep the receipt they give you.</li>
        </ol>
        <div class="demo-box">
          <p>Demo only: no cashier nearby? Mark this slip as paid to see the receipt.</p>
          <button class="btn btn-ghost btn-sm" data-action="simulate-counter">Mark as paid at the counter</button>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-action="cancel-slip">Cancel slip</button>
          <button class="btn btn-ghost" data-action="print">${icon('print')}Print slip</button>
          <button class="btn btn-dark" data-action="close">Done</button>
        </div>`;
    }
    const why = pay.status === 'expired' ? 'This payment slip expired' : 'This payment was cancelled';
    return `
      <div class="modal-head"><div></div>${closeButton}</div>
      <div class="done-head is-pending">${icon('alert')}<h2>${why}</h2><p>You can start a new payment from the Bills page.</p></div>
      <div class="paper"><dl class="rows">
        <div><dt>Reference number</dt><dd>${esc(pay.reference)}</dd></div>
        <div><dt>Bill</dt><dd>${period(bill)}</dd></div>
        <div class="total"><dt>Amount</dt><dd>${peso.format(pay.amount)}</dd></div>
      </dl></div>
      <div class="modal-actions"><button class="btn btn-dark" data-action="close">Done</button></div>`;
  }

  function receiptPaper(pay, bill) {
    const sub = methodSub(pay);
    return `
      <div class="paper">
        <div class="paper-title"><span class="brand-mark">${icon('zap')}</span>ElectraPay payment receipt</div>
        <dl class="rows">
          <div><dt>Reference number</dt><dd>${esc(pay.reference)}</dd></div>
          <div><dt>Date paid</dt><dd>${fmtDateTime(pay.paidAt || pay.createdAt)}</dd></div>
          <div><dt>Account</dt><dd>${esc(state.customer.name)}</dd></div>
          <div><dt>Bill</dt><dd>${period(bill)}, ${num(bill.kilowattHours)} kWh</dd></div>
          <div><dt>Paid with</dt><dd>${methodName(pay.method)}${sub ? `, ${esc(sub)}` : ''}</dd></div>
          <div class="total"><dt>Amount paid</dt><dd>${peso.format(pay.amount)}</dd></div>
        </dl>
      </div>`;
  }

  function slipPaper(pay, bill) {
    return `
      <div class="paper">
        <div class="slip-ref"><span>Reference number</span><strong>${esc(pay.reference)}</strong></div>
        ${barcodeSvg(pay.reference)}
        <dl class="rows">
          <div><dt>Bill</dt><dd>${period(bill)}, ${num(bill.kilowattHours)} kWh</dd></div>
          <div><dt>Pay at</dt><dd>${esc((pay.details || {}).outlet || '')}</dd></div>
          <div><dt>Valid until</dt><dd>${pay.expiresAt ? fmtDateTime(pay.expiresAt) : ''}</dd></div>
          <div class="total"><dt>Amount to pay</dt><dd>${peso.format(pay.amount)}</dd></div>
        </dl>
      </div>`;
  }

  // A decorative barcode drawn from the reference number (a stand-in for a real outlet barcode).
  function barcodeSvg(text) {
    const seq = [];
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      for (let i = 0; i < 6; i += 1) seq.push((((code >> i) ^ (code * (i + 3))) % 3) + 1);
    }
    let x = 0;
    let bars = '';
    seq.forEach((w, i) => {
      const width = w * 1.6;
      if (i % 2 === 0) bars += `<rect x="${x.toFixed(1)}" y="0" width="${width.toFixed(1)}" height="64"/>`;
      x += width;
    });
    const total = Math.ceil(x);
    return `<svg class="barcode" viewBox="0 0 ${total} 64" width="${Math.min(total, 300)}" height="64" fill="#12203d" role="img" aria-label="Barcode for ${esc(text)}">${bars}</svg>`;
  }

  // ----- card helpers (card numbers never leave this browser) -----
  function luhn(digits) {
    let sum = 0;
    let alt = false;
    for (let i = digits.length - 1; i >= 0; i -= 1) {
      let n = Number(digits[i]);
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n;
      alt = !alt;
    }
    return sum % 10 === 0;
  }
  function cardBrand(d) {
    if (/^4/.test(d)) return 'Visa';
    if (/^(5[1-5]|222[1-9]|22[3-9]\d|2[3-6]\d\d|27[01]\d|2720)/.test(d)) return 'Mastercard';
    if (/^(34|37)/.test(d)) return 'American Express';
    if (/^35/.test(d)) return 'JCB';
    return 'Other';
  }
  const cardLabel = (d) => (cardBrand(d) === 'Other' ? 'Card' : cardBrand(d));

  function validatePay(p) {
    const f = p.form;
    if (p.method === 'GCash') {
      if (!/^09\d{9}$/.test(f.mobile.replace(/\s/g, ''))) return 'Enter your 11-digit GCash number. It starts with 09.';
    }
    if (p.method === 'Debit/Credit Card') {
      const digits = f.number.replace(/\s/g, '');
      if (digits.length < 13 || !luhn(digits)) return 'That card number does not look right. Check it and try again.';
      if (f.name.trim().length < 2) return 'Enter the name printed on the card.';
      const ex = /^(\d{2})\/(\d{2})$/.exec(f.expiry);
      if (!ex) return 'Enter the expiry date as MM/YY.';
      const month = Number(ex[1]);
      if (month < 1 || month > 12) return 'The expiry month must be between 01 and 12.';
      if (new Date(2000 + Number(ex[2]), month, 1) <= new Date()) return 'This card has expired.';
      if (!/^\d{3,4}$/.test(f.cvv)) return 'Enter the 3 or 4 digit security code (CVV).';
    }
    if (p.method === 'Over the Counter' && !p.outlet) return 'Choose where you will pay.';
    return '';
  }

  async function createPayment() {
    const p = state.pay;
    p.busy = true;
    p.error = '';
    const btn = $('[data-action="submit-pay"], [data-action="authorize"]', card);
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Processing'; }

    try {
      let details;
      if (p.method === 'GCash') details = { mobile: p.form.mobile.replace(/\s/g, '') };
      else if (p.method === 'Debit/Credit Card') {
        const digits = p.form.number.replace(/\s/g, '');
        details = { cardBrand: cardBrand(digits), cardLast4: digits.slice(-4) };
      } else details = { outlet: p.outlet };

      if (p.method === 'GCash') await sleep(1100); // pretend GCash is confirming
      const result = await api('/payments', { method: 'POST', body: JSON.stringify({ billId: p.bill._id, method: p.method, details }) });

      p.payment = result.payment;
      p.step = 'result';
      p.form = blankForm();
      p.busy = false;
      renderPay();
      loadData().catch(() => {}); // refresh the dashboard behind the modal
      return;
    } catch (err) {
      p.error = err.message;
      p.step = p.method === 'GCash' ? 'gcash' : 'choose';
    }
    p.busy = false;
    renderPay();
  }

  // ============================================================
  // Meter reading
  // ============================================================
  function openReading() {
    const now = new Date();
    const options = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      return `<option value="${d.getFullYear()}-${d.getMonth() + 1}">${MONTHS[d.getMonth()]} ${d.getFullYear()}</option>`;
    }).join('');

    card.innerHTML = `
      <div class="modal-head">
        <div><h2>Add a meter reading</h2><p>Enter the kilowatt-hours your meter shows for a month. ElectraPay makes the bill for you.</p></div>
        ${closeButton}
      </div>
      <div class="fields">
        <label>Month<select id="r-month">${options}</select></label>
        <label>Kilowatt-hours used
          <input id="r-kwh" type="number" inputmode="decimal" min="1" max="100000" step="1" placeholder="For example, 320" />
        </label>
      </div>
      <p id="r-error" class="inline-error hidden" role="alert"></p>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-action="close">Cancel</button>
        <button class="btn btn-primary" data-action="save-reading">Save and make bill</button>
      </div>`;
    openModal();
  }

  async function saveReading() {
    const [year, month] = $('#r-month').value.split('-').map(Number);
    const kwh = Number($('#r-kwh').value);
    const errorEl = $('#r-error');
    if (!(kwh > 0)) {
      errorEl.textContent = 'Enter the kilowatt-hours your meter shows for that month.';
      errorEl.classList.remove('hidden');
      return;
    }

    const btn = $('[data-action="save-reading"]', card);
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Saving';
    try {
      await api('/usage', { method: 'POST', body: JSON.stringify({ year, month, kilowattHours: kwh }) });
      let message = `Saved. Your ${MONTHS[month - 1]} ${year} bill is ready.`;
      try {
        await api('/bills/generate', { method: 'POST', body: JSON.stringify({ year, month }) });
      } catch (err) {
        message = `Reading saved. ${err.message}`;
      }
      await loadData();
      closeModal();
      toast(message);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Save and make bill';
    }
  }

  // ============================================================
  // Event wiring
  // ============================================================
  document.addEventListener('click', async (e) => {
    const link = e.target.closest('[data-view-link]');
    if (link) { showView(link.dataset.viewLink); return; }

    const nav = e.target.closest('.side-link');
    if (nav) { showView(nav.dataset.view); return; }

    const el = e.target.closest('[data-action]');
    if (!el) return;
    const p = state.pay;

    try {
      switch (el.dataset.action) {
        case 'pay': openPay(el.dataset.bill); break;
        case 'view-payment': await openPaymentView(el.dataset.id); break;
        case 'add-reading': openReading(); break;
        case 'save-reading': await saveReading(); break;
        case 'close': if (!modalBusy()) closeModal(); break;

        case 'method':
          p.method = el.dataset.method;
          p.error = '';
          renderPay();
          { const field = card.querySelector('.fields input'); if (field) field.focus({ preventScroll: true }); }
          break;

        case 'submit-pay':
          if (!p.method) break;
          p.error = validatePay(p);
          if (p.error) { renderPay(); break; }
          if (p.method === 'GCash') { p.step = 'gcash'; renderPay(); break; }
          await createPayment();
          break;

        case 'back': p.step = 'choose'; p.error = ''; renderPay(); break;
        case 'authorize': await createPayment(); break;

        case 'simulate-counter': {
          el.disabled = true;
          const r = await api(`/payments/${p.payment._id}/confirm-counter`, { method: 'POST' });
          p.payment = { ...p.payment, ...r.payment };
          renderPay();
          await loadData();
          break;
        }

        case 'cancel-slip':
          await api(`/payments/${p.payment._id}/cancel`, { method: 'POST' });
          closeModal();
          toast('Payment slip cancelled. You can pay this bill another way.');
          await loadData();
          break;

        case 'print':
          $('#print-area').innerHTML = p.payment.status === 'completed'
            ? receiptPaper(p.payment, billOf(p.payment, p))
            : slipPaper(p.payment, billOf(p.payment, p));
          window.print();
          break;

        default: break;
      }
    } catch (err) {
      if (el.disabled) el.disabled = false;
      toast(err.message, true);
    }
  });

  // Live formatting for the checkout fields
  document.addEventListener('input', (e) => {
    const t = e.target;
    const p = state.pay;
    if (!p) return;

    if (t.id === 'f-mobile') {
      p.form.mobile = t.value.replace(/[^\d ]/g, '');
      t.value = p.form.mobile;
    } else if (t.id === 'f-number') {
      const digits = t.value.replace(/\D/g, '').slice(0, 19);
      p.form.number = digits.replace(/(.{4})/g, '$1 ').trim();
      t.value = p.form.number;
      const tag = $('#brand-tag');
      if (tag) tag.textContent = digits ? cardLabel(digits) : '';
    } else if (t.id === 'f-name') {
      p.form.name = t.value;
    } else if (t.id === 'f-expiry') {
      let d = t.value.replace(/\D/g, '').slice(0, 4);
      if (d.length >= 3) d = `${d.slice(0, 2)}/${d.slice(2)}`;
      t.value = d;
      p.form.expiry = d;
    } else if (t.id === 'f-cvv') {
      t.value = t.value.replace(/\D/g, '').slice(0, 4);
      p.form.cvv = t.value;
    } else if (t.name === 'outlet') {
      p.outlet = t.value;
    }
  });

  // ============================================================
  // Boot
  // ============================================================
  if (state.token) enterApp();
})();
