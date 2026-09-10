import { Controller, Get, Res } from "@nestjs/common";
import type { Response } from "express";
import { DEMO_TENANT_ID } from "./common/demo-tenant";

/**
 * Serves one dependency-free, self-contained HTML+JS page for manually
 * exercising the API in a browser. This is NOT a designed product UI —
 * Master Plan Section 1 explicitly excludes UI design from this plan's
 * scope — it's a dev/demo dashboard so the API is clickable instead of
 * curl-only. Every action on the page is a plain same-origin fetch() call
 * against the real controllers elsewhere in this app; nothing here
 * duplicates or bypasses their logic (the 40-question Growth Audit form, for
 * instance, renders whatever GET /growth-audit/questions returns, rather
 * than hardcoding a copy of questions.data.ts that could drift).
 *
 * Deliberately zero external dependencies (no CDN script or stylesheet) —
 * this mirrors the offline/intermittent-connectivity assumption the Master
 * Plan bakes into the client architecture (Section 2), and keeps this
 * scaffold's "no registry dependency beyond what's already installed"
 * discipline intact for the one piece of UI it does ship.
 */
@Controller()
export class AppController {
  @Get()
  dashboard(@Res() res: Response): void {
    res.type("html").send(DASHBOARD_HTML);
  }
}

const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Mytrima — API Dashboard</title>
<style>
  :root {
    --ink: #1a1f2b; --muted: #5a6472; --line: #e2e5ea; --bg: #f7f8fa;
    --card: #ffffff; --accent: #0f6b5c; --accent-ink: #ffffff;
    --err-bg: #fdecec; --err-ink: #8a1f1f; --err-line: #e8b4b4;
    --ok-bg: #eef8f0; --ok-ink: #1f5d33;
    --band-critical: #c0392b; --band-weak: #d98c2b; --band-stable: #2b6cb0; --band-high: #1f8a4c;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; }
  .wrap { max-width: 960px; margin: 0 auto; padding: 28px 20px 80px; }
  header { margin-bottom: 8px; }
  header h1 { margin: 0; font-size: 1.5rem; }
  header p { margin: 4px 0 0; color: var(--muted); font-size: 0.92rem; }
  .banner { background: #fff4e5; border: 1px solid #d98c2b; color: #7a4a08; border-radius: 8px; padding: 12px 14px; margin: 16px 0 24px; font-size: 0.88rem; }
  .tenant-bar { display: flex; gap: 12px; align-items: center; margin-bottom: 24px; background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; }
  .tenant-bar label { font-size: 0.85rem; color: var(--muted); }
  .tenant-bar input { width: 100px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  @media (max-width: 760px) { .grid { grid-template-columns: 1fr; } }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 18px 20px; margin-bottom: 20px; }
  .card.full { grid-column: 1 / -1; }
  .card h2 { margin: 0 0 4px; font-size: 1.05rem; }
  .card .hint { color: var(--muted); font-size: 0.82rem; margin: 0 0 14px; }
  label { display: block; font-size: 0.82rem; color: var(--muted); margin: 10px 0 3px; }
  input[type=text], input[type=number], input[type=password], textarea, select {
    width: 100%; padding: 7px 9px; border: 1px solid var(--line); border-radius: 6px; font-size: 0.9rem; font-family: inherit; background: #fff; color: var(--ink);
  }
  textarea { resize: vertical; min-height: 44px; }
  button { cursor: pointer; border: none; border-radius: 6px; padding: 8px 14px; font-size: 0.88rem; font-weight: 600; background: var(--accent); color: var(--accent-ink); margin-top: 12px; margin-right: 8px; }
  button.secondary { background: #eef0f2; color: var(--ink); }
  button:disabled { opacity: 0.5; cursor: default; }
  .result { margin-top: 14px; padding: 10px 12px; border-radius: 8px; font-size: 0.85rem; white-space: pre-wrap; word-break: break-word; }
  .result.ok { background: var(--ok-bg); color: var(--ok-ink); border: 1px solid #b7ddc0; }
  .result.err { background: var(--err-bg); color: var(--err-ink); border: 1px solid var(--err-line); }
  .band { display: inline-block; padding: 2px 10px; border-radius: 999px; color: #fff; font-size: 0.78rem; font-weight: 700; }
  .band.Critical { background: var(--band-critical); }
  .band.Weak { background: var(--band-weak); }
  .band.Stable { background: var(--band-stable); }
  .band.High-Growth { background: var(--band-high); }
  table { border-collapse: collapse; width: 100%; margin-top: 10px; font-size: 0.82rem; }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--line); }
  .section-block { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; }
  .section-block summary { cursor: pointer; font-weight: 600; font-size: 0.88rem; }
  .qrow { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 4px 0; font-size: 0.82rem; }
  .qrow span { flex: 1; }
  .qrow select { width: 64px; flex: none; }
  .row { display: flex; gap: 10px; }
  .row > div { flex: 1; }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 0.72rem; font-weight: 600; }
  .pill.pending { background: #fdf1d6; color: #8a5a00; }
  .pill.public { background: var(--ok-bg); color: var(--ok-ink); }
  .pill.hidden { background: #eee; color: #666; }
  code { background: #f0f1f3; padding: 1px 5px; border-radius: 4px; font-size: 0.85em; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Mytrima — API Dashboard</h1>
    <p>Live preview of the Stage 1 NestJS scaffold. Every action below is a real same-origin API call.</p>
  </header>
  <div class="banner">
    This is a dev/demo dashboard, not a designed product UI (the Master Plan explicitly
    defers UI design). State is in-memory and clears on restart unless <code>DATABASE_URL</code>
    is set, in which case it's real Postgres and genuinely survives a restart.
  </div>

  <div class="tenant-bar">
    <label style="margin:0">Tenant ID</label>
    <input type="text" id="tenantId" value="${DEMO_TENANT_ID}">
    <span style="color:var(--muted);font-size:0.82rem">used by every card below</span>
  </div>

  <div class="grid">

    <div class="card full">
      <h2>Growth Audit</h2>
      <p class="hint">
        Renders the real 40-question instrument from <code>GET /growth-audit/questions</code>.
        Submissions now persist (<code>GET /growth-audit/:tenantId</code> below the form).
      </p>
      <div>
        <button type="button" class="secondary" data-fill="0">Fill all 0 (Critical demo)</button>
        <button type="button" class="secondary" data-fill="2">Fill all 2 (Weak demo)</button>
        <button type="button" class="secondary" data-fill="4">Fill all 4 (High-Growth demo)</button>
        <button type="button" class="secondary" id="randomizeAudit">Randomize</button>
      </div>
      <div id="auditSections">Loading questions…</div>
      <button type="button" id="submitAudit">Submit Audit</button>
      <button type="button" class="secondary" id="refreshAuditHistory">Refresh Past Audits</button>
      <div id="auditResult"></div>
      <table id="auditHistoryTable"><tbody></tbody></table>
    </div>

    <div class="card">
      <h2>NPS</h2>
      <p class="hint">
        <code>POST /nps</code> — categorizes one response, persists it, and shows any
        triggered notification. Submissions now count toward a real tenant-wide NPS score.
      </p>
      <label>Customer</label>
      <select id="npsCustomerId"><option value="">Create a customer first →</option></select>
      <label>Score (0–10)</label>
      <input type="number" id="npsScore" min="0" max="10" value="3">
      <label>Comment (optional)</label>
      <textarea id="npsComment">Delivery was slower than expected</textarea>
      <button type="button" id="submitNps">Submit</button>
      <button type="button" class="secondary" id="refreshNpsAggregate">Refresh Aggregate</button>
      <div id="npsResult"></div>
      <div id="npsAggregate" class="result"></div>
    </div>

    <div class="card">
      <h2>Customers</h2>
      <p class="hint">
        <code>POST /customers</code> — a rating's <code>customerId</code> must reference a
        real row here (Postgres mode enforces this with a foreign key; in-memory mode never did).
      </p>
      <label>Display name</label>
      <input type="text" id="customerName" value="Demo Customer">
      <label>Phone (optional)</label>
      <input type="text" id="customerPhone" value="">
      <button type="button" id="createCustomer">Create Customer</button>
      <button type="button" class="secondary" id="refreshCustomers">Refresh List</button>
      <div id="customerResult"></div>
      <table id="customersTable"><tbody></tbody></table>
    </div>

    <div class="card">
      <h2>Ratings</h2>
      <p class="hint"><code>POST /ratings</code> — starts 'pending'; moderate to 'public' before it counts.</p>
      <div class="row">
        <div><label>Customer</label><select id="ratingCustomerId"><option value="">Create a customer first →</option></select></div>
        <div><label>Stars</label>
          <select id="ratingStars"><option>5</option><option>4</option><option selected>3</option><option>2</option><option>1</option></select>
        </div>
      </div>
      <label>Comment</label>
      <textarea id="ratingComment">Great service!</textarea>
      <button type="button" id="submitRating">Submit Rating</button>
      <button type="button" class="secondary" id="refreshAggregate">Refresh Aggregate</button>
      <div id="ratingAggregate" class="result"></div>
      <table id="ratingsTable"><tbody></tbody></table>
    </div>

    <div class="card">
      <h2>Consent</h2>
      <p class="hint"><code>POST /consent/grant</code> and the DSAR export endpoint.</p>
      <label>Customer ID</label>
      <input type="text" id="consentCustomerId" value="c1">
      <label>Data category</label>
      <input type="text" id="consentCategory" value="whatsapp_marketing">
      <label>Lawful basis</label>
      <select id="consentBasis">
        <option value="consent">consent</option>
        <option value="contract">contract</option>
        <option value="legitimate_interest">legitimate_interest</option>
        <option value="legal_obligation">legal_obligation</option>
      </select>
      <button type="button" id="grantConsent">Grant</button>
      <button type="button" class="secondary" id="exportConsent">Export (DSAR)</button>
      <div id="consentResult"></div>
    </div>

    <div class="card">
      <h2>Auth</h2>
      <p class="hint">
        <code>POST /auth/login</code> against a demo account seeded for this preview only.
        <code>POST /auth/register</code> exists but isn't demoed here — it requires an
        authenticated <code>owner</code>-role caller (see "Auth/RBAC" in the README), and
        the seeded demo account is <code>staff</code>.
      </p>
      <label>Email</label>
      <input type="text" id="authEmail" value="demo@mytrima.com">
      <label>Password</label>
      <input type="password" id="authPassword" value="demo1234">
      <button type="button" id="loginBtn">Log in</button>
      <div id="authResult"></div>
    </div>

    <div class="card full">
      <h2>MFA Enrollment</h2>
      <p class="hint">
        <code>POST /auth/mfa/enroll/start</code> and <code>/confirm</code> — both now require a real
        access token (log in above first). <code>tenantId</code>/<code>userId</code> are no longer
        request fields at all: they come only from whatever account your access token actually
        belongs to, computed here with the browser's own Web Crypto API (RFC 6238 TOTP,
        HMAC-SHA1) — the same algorithm <code>src/modules/auth/totp.ts</code> uses server-side,
        no authenticator app needed to click through this demo.
      </p>
      <button type="button" id="startMfaEnroll">Start Enrollment</button>
      <div id="mfaEnrollResult"></div>
      <div id="mfaCodeBlock" hidden>
        <label>Live code (auto-refreshes every 30s)</label>
        <div style="font-size:1.4rem;font-weight:700;letter-spacing:0.15em" id="mfaLiveCode">------</div>
        <button type="button" id="confirmMfaEnroll">Confirm Enrollment</button>
      </div>
      <div id="mfaConfirmResult"></div>
    </div>

    <div class="card full">
      <h2>Social Publishing (Facebook)</h2>
      <p class="hint">
        <code>GET /social/:tenantId/connect</code> — a real Facebook Login OAuth flow (not a
        manually-pasted Graph API Explorer token — Meta's own App Review requirement is that
        this happen "on your app platform"). Once connected, create/edit/delete a real post on
        your connected Page via <code>POST</code>/<code>PATCH</code>/<code>DELETE /social/:tenantId/posts</code>.
      </p>
      <div id="socialConnectionStatus">Checking connection…</div>
      <button type="button" id="connectFacebookBtn">Connect Facebook Page</button>
      <div id="socialPostForm" hidden>
        <label>Message</label>
        <textarea id="socialPostMessage">Mytrima platform — live demo post</textarea>
        <button type="button" id="createSocialPost">Publish Post</button>
        <div id="socialPostResult"></div>
        <div id="socialPostActions" hidden>
          <label>Edit message</label>
          <textarea id="socialPostEditMessage"></textarea>
          <button type="button" id="updateSocialPost">Update Post</button>
          <button type="button" class="secondary" id="deleteSocialPost">Delete Post</button>
          <div id="socialPostActionResult"></div>
        </div>
      </div>
    </div>

  </div>
</div>

<script>
function tenantId() { return document.getElementById('tenantId').value || 't1'; }

async function callApi(url, options) {
  const res = await fetch(url, options);
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) {
    const message = (data && data.message) ? data.message : (res.status + ' ' + res.statusText);
    const err = new Error(message);
    err.data = data;
    throw err;
  }
  return data;
}
function postJSON(url, body) {
  return callApi(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
function showResult(el, data, isError) {
  el.className = 'result ' + (isError ? 'err' : 'ok');
  el.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
}

/* ---------- Growth Audit ---------- */
let auditSections = [];
let auditQuestionText = {};

async function loadAuditQuestions() {
  const data = await callApi('/growth-audit/questions');
  auditSections = data.sections;
  auditQuestionText = data.questionText;
  const container = document.getElementById('auditSections');
  container.innerHTML = '';
  auditSections.forEach(function (section) {
    const details = document.createElement('details');
    details.className = 'section-block';
    details.open = false;
    const summary = document.createElement('summary');
    summary.textContent = section.key + '. ' + section.name + ' (weight ' + section.weightPct + '%)';
    details.appendChild(summary);
    section.questionIds.forEach(function (id) {
      const row = document.createElement('div');
      row.className = 'qrow';
      const span = document.createElement('span');
      span.textContent = id + '. ' + auditQuestionText[id];
      const select = document.createElement('select');
      select.dataset.qid = id;
      [0, 1, 2, 3, 4].forEach(function (v) {
        const opt = document.createElement('option');
        opt.value = v; opt.textContent = v;
        if (v === 2) opt.selected = true;
        select.appendChild(opt);
      });
      row.appendChild(span);
      row.appendChild(select);
      details.appendChild(row);
    });
    container.appendChild(details);
  });
}

function fillAudit(value) {
  document.querySelectorAll('#auditSections select').forEach(function (s) { s.value = value; });
}
function randomizeAudit() {
  document.querySelectorAll('#auditSections select').forEach(function (s) { s.value = Math.floor(Math.random() * 5); });
}
function collectAnswers() {
  const answers = {};
  document.querySelectorAll('#auditSections select').forEach(function (s) { answers[s.dataset.qid] = Number(s.value); });
  return answers;
}

document.querySelectorAll('[data-fill]').forEach(function (btn) {
  btn.addEventListener('click', function () { fillAudit(Number(btn.dataset.fill)); });
});
document.getElementById('randomizeAudit').addEventListener('click', randomizeAudit);

document.getElementById('submitAudit').addEventListener('click', async function () {
  const resultEl = document.getElementById('auditResult');
  try {
    const answers = collectAnswers();
    const data = await postJSON('/growth-audit', { tenantId: tenantId(), answers: answers });
    const r = data.result;
    let html = '<div><strong>Overall score: ' + r.overallScore + '/100</strong> &nbsp; <span class="band ' + r.band + '">' + r.band + '</span></div>';
    html += '<table><tr><th>Section</th><th>Raw</th><th>%</th><th>Weight</th><th>Contribution</th></tr>';
    r.sections.forEach(function (s) {
      html += '<tr><td>' + s.key + '. ' + s.name + '</td><td>' + s.rawScore + '/' + s.maxScore + '</td><td>' + s.sectionPct.toFixed(1) + '%</td><td>' + s.weightPct + '%</td><td>' + s.weightedContribution.toFixed(2) + '</td></tr>';
    });
    html += '</table>';
    if (data.notifications.length) {
      html += '<div style="margin-top:8px"><strong>Notifications triggered:</strong><ul>' +
        data.notifications.map(function (n) { return '<li>[' + n.priority + '] ' + n.message + '</li>'; }).join('') + '</ul></div>';
    } else {
      html += '<div style="margin-top:8px;color:var(--muted)">No notifications triggered for this result.</div>';
    }
    resultEl.className = 'result ok';
    resultEl.innerHTML = html;
    loadAuditHistory().catch(function () { /* non-fatal if this refresh fails */ });
  } catch (e) {
    showResult(resultEl, e.message, true);
  }
});

async function loadAuditHistory() {
  const history = await callApi('/growth-audit/' + tenantId());
  const tbody = document.querySelector('#auditHistoryTable tbody');
  tbody.innerHTML = '';
  history.forEach(function (h) {
    const tr = document.createElement('tr');
    const when = new Date(h.submittedAt).toLocaleString();
    tr.innerHTML = '<td>' + when + '</td><td>' + h.result.overallScore + '/100</td>' +
      '<td><span class="band ' + h.result.band + '">' + h.result.band + '</span></td>';
    tbody.appendChild(tr);
  });
}

document.getElementById('refreshAuditHistory').addEventListener('click', function () {
  loadAuditHistory().catch(function (e) { alert('Failed to load audit history: ' + e.message); });
});

loadAuditQuestions().catch(function (e) {
  document.getElementById('auditSections').textContent = 'Failed to load questions: ' + e.message;
});
loadAuditHistory().catch(function () { /* fine on first load if the tenant has no audits yet */ });

/* ---------- NPS ---------- */
document.getElementById('submitNps').addEventListener('click', async function () {
  const resultEl = document.getElementById('npsResult');
  const customerId = document.getElementById('npsCustomerId').value;
  if (!customerId) {
    alert('Create a customer first — an NPS response needs a real customerId (Postgres mode enforces this with a foreign key).');
    return;
  }
  try {
    const data = await postJSON('/nps', {
      tenantId: tenantId(),
      customerId: customerId,
      score: Number(document.getElementById('npsScore').value),
      comment: document.getElementById('npsComment').value,
    });
    showResult(resultEl, data, false);
    loadNpsAggregate().catch(function () { /* non-fatal if this refresh fails */ });
  } catch (e) {
    showResult(resultEl, e.message, true);
  }
});

async function loadNpsAggregate() {
  const data = await callApi('/nps/' + tenantId() + '/aggregate');
  showResult(document.getElementById('npsAggregate'), data, false);
}

document.getElementById('refreshNpsAggregate').addEventListener('click', function () {
  loadNpsAggregate().catch(function (e) { showResult(document.getElementById('npsAggregate'), e.message, true); });
});

/* ---------- Customers ---------- */
function renderCustomersTable(customers) {
  const tbody = document.querySelector('#customersTable tbody');
  tbody.innerHTML = '';
  customers.forEach(function (c) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + (c.displayName || '(no name)') + '</td><td>' + (c.phone || '') + '</td>';
    tbody.appendChild(tr);
  });
}

function populateCustomerSelect(selectId, customers) {
  const select = document.getElementById(selectId);
  const previousValue = select.value;
  select.innerHTML = '';
  if (customers.length === 0) {
    select.innerHTML = '<option value="">Create a customer first →</option>';
    return;
  }
  customers.forEach(function (c) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.displayName || c.phone || c.email || c.id;
    select.appendChild(opt);
  });
  if (customers.some(function (c) { return c.id === previousValue; })) select.value = previousValue;
}

async function loadCustomers() {
  const customers = await callApi('/customers/' + tenantId());
  renderCustomersTable(customers);
  populateCustomerSelect('ratingCustomerId', customers);
  populateCustomerSelect('npsCustomerId', customers);
  return customers;
}

document.getElementById('createCustomer').addEventListener('click', async function () {
  const el = document.getElementById('customerResult');
  try {
    const data = await postJSON('/customers', {
      tenantId: tenantId(),
      displayName: document.getElementById('customerName').value,
      phone: document.getElementById('customerPhone').value,
    });
    showResult(el, data, false);
    await loadCustomers();
  } catch (e) {
    showResult(el, e.message, true);
  }
});

document.getElementById('refreshCustomers').addEventListener('click', function () {
  loadCustomers().catch(function (e) { showResult(document.getElementById('customerResult'), e.message, true); });
});

loadCustomers().catch(function () { /* fine on first load if the tenant has none yet */ });

/* ---------- Ratings ---------- */
const submittedRatings = [];

function renderRatingsTable() {
  const tbody = document.querySelector('#ratingsTable tbody');
  tbody.innerHTML = '';
  submittedRatings.forEach(function (r) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + r.stars + '★ ' + (r.comment || '') + '</td>' +
      '<td><span class="pill ' + r.status + '">' + r.status + '</span></td>' +
      '<td></td>';
    const actionsTd = tr.children[2];
    if (r.status === 'pending') {
      const pubBtn = document.createElement('button');
      pubBtn.type = 'button'; pubBtn.textContent = 'Make public';
      pubBtn.style.marginTop = '0';
      pubBtn.addEventListener('click', function () { moderateRating(r, 'public'); });
      const hideBtn = document.createElement('button');
      hideBtn.type = 'button'; hideBtn.textContent = 'Hide'; hideBtn.className = 'secondary';
      hideBtn.style.marginTop = '0';
      hideBtn.addEventListener('click', function () { moderateRating(r, 'hidden'); });
      actionsTd.appendChild(pubBtn);
      actionsTd.appendChild(hideBtn);
    }
    tbody.appendChild(tr);
  });
}

async function moderateRating(rating, status) {
  const data = await postJSON('/ratings/' + rating.id + '/moderate', { tenantId: tenantId(), status: status });
  rating.status = status;
  renderRatingsTable();
  if (data.notifications && data.notifications.length) {
    alert(data.notifications.map(function (n) { return '[' + n.priority + '] ' + n.message; }).join('\\n'));
  }
}

document.getElementById('submitRating').addEventListener('click', async function () {
  const customerId = document.getElementById('ratingCustomerId').value;
  if (!customerId) {
    alert('Create a customer first — a rating needs a real customerId (Postgres mode enforces this with a foreign key).');
    return;
  }
  try {
    const data = await postJSON('/ratings', {
      tenantId: tenantId(),
      customerId: customerId,
      stars: Number(document.getElementById('ratingStars').value),
      comment: document.getElementById('ratingComment').value,
    });
    submittedRatings.unshift(data);
    renderRatingsTable();
  } catch (e) {
    alert('Failed to submit rating: ' + e.message);
  }
});

document.getElementById('refreshAggregate').addEventListener('click', async function () {
  const el = document.getElementById('ratingAggregate');
  try {
    const data = await callApi('/ratings/' + tenantId() + '/aggregate');
    showResult(el, data, false);
  } catch (e) {
    showResult(el, e.message, true);
  }
});

/* ---------- Consent ---------- */
document.getElementById('grantConsent').addEventListener('click', async function () {
  const el = document.getElementById('consentResult');
  try {
    const data = await postJSON('/consent/grant', {
      tenantId: tenantId(),
      customerId: document.getElementById('consentCustomerId').value,
      dataCategory: document.getElementById('consentCategory').value,
      lawfulBasis: document.getElementById('consentBasis').value,
    });
    showResult(el, data, false);
  } catch (e) {
    showResult(el, e.message, true);
  }
});

document.getElementById('exportConsent').addEventListener('click', async function () {
  const el = document.getElementById('consentResult');
  try {
    const customerId = document.getElementById('consentCustomerId').value;
    const data = await callApi('/consent/' + tenantId() + '/' + customerId + '/export');
    showResult(el, data, false);
  } catch (e) {
    showResult(el, e.message, true);
  }
});

/* ---------- Auth ---------- */
let currentAccessToken = null;

document.getElementById('loginBtn').addEventListener('click', async function () {
  const el = document.getElementById('authResult');
  try {
    const data = await postJSON('/auth/login', {
      tenantId: tenantId(),
      email: document.getElementById('authEmail').value,
      password: document.getElementById('authPassword').value,
    });
    currentAccessToken = data.accessToken;
    showResult(el, {
      accessToken: data.accessToken.slice(0, 40) + '…',
      refreshToken: data.refreshToken.slice(0, 40) + '…',
      note: 'accessToken stored — used automatically by the MFA Enrollment card below',
    }, false);
  } catch (e) {
    showResult(el, e.message, true);
  }
});

/* ---------- MFA Enrollment ---------- */
/* Minimal RFC 6238 TOTP (HMAC-SHA1, 30s step, 6 digits) via the browser's
 * own Web Crypto API — the same algorithm src/modules/auth/totp.ts
 * implements server-side, reimplemented here so this demo needs no external
 * authenticator app. Zero dependencies, matching this dashboard's own rule. */
function base32DecodeBrowser(input) {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = input.toUpperCase().replace(/=+$/, '');
  let bits = 0, value = 0;
  const bytes = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return new Uint8Array(bytes);
}
async function computeTotp(secretBase32) {
  const keyBytes = base32DecodeBrowser(secretBase32);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const counterBuf = new ArrayBuffer(8);
  new DataView(counterBuf).setBigUint64(0, BigInt(counter), false);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBuf));
  const offset = sig[sig.length - 1] & 0xf;
  const binCode = ((sig[offset] & 0x7f) << 24) | ((sig[offset + 1] & 0xff) << 16) | ((sig[offset + 2] & 0xff) << 8) | (sig[offset + 3] & 0xff);
  return String(binCode % 1000000).padStart(6, '0');
}

let mfaSecret = null;
let mfaCodeInterval = null;

function authHeaders() {
  if (!currentAccessToken) throw new Error('Log in first (Auth card above) — MFA enrollment needs a real access token');
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + currentAccessToken };
}

document.getElementById('startMfaEnroll').addEventListener('click', async function () {
  const el = document.getElementById('mfaEnrollResult');
  try {
    const data = await callApi('/auth/mfa/enroll/start', { method: 'POST', headers: authHeaders(), body: '{}' });
    mfaSecret = data.secret;
    showResult(el, { otpauthUrl: data.otpauthUrl, note: 'tenantId/userId came from your access token, not this request' }, false);
    document.getElementById('mfaCodeBlock').hidden = false;
    if (mfaCodeInterval) clearInterval(mfaCodeInterval);
    const refreshCode = async function () { document.getElementById('mfaLiveCode').textContent = await computeTotp(mfaSecret); };
    refreshCode();
    mfaCodeInterval = setInterval(refreshCode, 1000);
  } catch (e) {
    showResult(el, e.message, true);
  }
});

document.getElementById('confirmMfaEnroll').addEventListener('click', async function () {
  const el = document.getElementById('mfaConfirmResult');
  try {
    const code = await computeTotp(mfaSecret);
    const data = await callApi('/auth/mfa/enroll/confirm', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ code: code }) });
    showResult(el, data, false);
  } catch (e) {
    showResult(el, e.message, true);
  }
});

/* ---------- Social Publishing ---------- */
let socialLastPostId = null;

async function refreshSocialConnection() {
  const statusEl = document.getElementById('socialConnectionStatus');
  const formEl = document.getElementById('socialPostForm');
  try {
    const data = await callApi('/social/' + tenantId() + '/connection');
    if (data.connected) {
      statusEl.textContent = 'Connected to Facebook Page "' + data.pageName + '" (connected ' + new Date(data.connectedAt).toLocaleString() + ')';
      document.getElementById('connectFacebookBtn').textContent = 'Reconnect';
      formEl.hidden = false;
    } else {
      statusEl.textContent = 'Not connected yet — click Connect below.';
      formEl.hidden = true;
    }
  } catch (e) {
    statusEl.textContent = 'Could not check connection status: ' + e.message;
  }
}

document.getElementById('connectFacebookBtn').addEventListener('click', function () {
  window.location.href = '/social/' + tenantId() + '/connect';
});

document.getElementById('createSocialPost').addEventListener('click', async function () {
  const resultEl = document.getElementById('socialPostResult');
  try {
    const message = document.getElementById('socialPostMessage').value;
    const data = await postJSON('/social/' + tenantId() + '/posts', { message: message });
    socialLastPostId = data.postId;
    showResult(resultEl, data, false);
    document.getElementById('socialPostEditMessage').value = message;
    document.getElementById('socialPostActions').hidden = false;
  } catch (e) {
    showResult(resultEl, e.message, true);
  }
});

document.getElementById('updateSocialPost').addEventListener('click', async function () {
  const resultEl = document.getElementById('socialPostActionResult');
  try {
    const data = await callApi('/social/' + tenantId() + '/posts/' + encodeURIComponent(socialLastPostId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: document.getElementById('socialPostEditMessage').value })
    });
    showResult(resultEl, data, false);
  } catch (e) {
    showResult(resultEl, e.message, true);
  }
});

document.getElementById('deleteSocialPost').addEventListener('click', async function () {
  const resultEl = document.getElementById('socialPostActionResult');
  try {
    const data = await callApi('/social/' + tenantId() + '/posts/' + encodeURIComponent(socialLastPostId), { method: 'DELETE' });
    showResult(resultEl, data, false);
    document.getElementById('socialPostActions').hidden = true;
    socialLastPostId = null;
  } catch (e) {
    showResult(resultEl, e.message, true);
  }
});

refreshSocialConnection();
(function () {
  var connected = new URLSearchParams(window.location.search).get('connected');
  if (connected) document.getElementById('socialConnectionStatus').textContent = 'Just connected to: ' + connected;
})();
</script>
</body>
</html>
`;
