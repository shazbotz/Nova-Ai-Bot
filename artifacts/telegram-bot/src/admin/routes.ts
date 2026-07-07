import { Router, Request, Response, NextFunction } from "express";
import { User, Conversation, AIProvider, SystemLog, Plan } from "../memory/models";
import { toggleProvider, updateProviderPriority } from "../ai/router";
import { addCredits, assignPlan } from "../memory/credits";
import { config } from "../config";
import { logger } from "../utils/logger";

export const adminRouter = Router();

declare module "express-session" {
  interface SessionData { adminLoggedIn: boolean; }
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.session?.adminLoggedIn) return next();
  res.redirect("/admin/login");
}

// ── Auth ──────────────────────────────────────────────────────────────────────
adminRouter.get("/login", (_req, res) => res.send(loginHtml()));
adminRouter.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (username === config.admin.username && password === config.admin.password) {
    req.session.adminLoggedIn = true;
    res.redirect("/admin/dashboard");
  } else {
    res.send(loginHtml("Invalid credentials"));
  }
});
adminRouter.get("/logout", (req, res) => { req.session.destroy(() => res.redirect("/admin/login")); });

// ── Dashboard ────────────────────────────────────────────────────────────────
adminRouter.get("/dashboard", requireAuth, async (_req, res) => {
  const [totalUsers, blockedUsers, providers, totalConvs, plans] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ isBlocked: true }),
    AIProvider.find().sort({ priority: 1 }),
    Conversation.countDocuments(),
    Plan.find({ isActive: true }),
  ]);
  const recentUsers = await User.find().sort({ createdAt: -1 }).limit(8);
  const logs = await SystemLog.find().sort({ timestamp: -1 }).limit(15);

  const planStats = await Promise.all(
    plans.map(async (p) => ({
      name: p.name,
      color: p.color,
      count: await User.countDocuments({ "subscription.planName": p.name }),
    }))
  );

  res.send(dashboardHtml({ totalUsers, blockedUsers, activeUsers: totalUsers - blockedUsers, totalConvs, providers, recentUsers, logs, planStats }));
});

// ── Users ─────────────────────────────────────────────────────────────────────
adminRouter.get("/users", requireAuth, async (req, res) => {
  const page = parseInt((req.query.page as string) || "1");
  const limit = 20;
  const search = (req.query.search as string) || "";
  const planFilter = (req.query.plan as string) || "";

  const query: Record<string, unknown> = {};
  if (search) {
    query.$or = [
      { username: new RegExp(search, "i") },
      { firstName: new RegExp(search, "i") },
      { telegramId: isNaN(Number(search)) ? -1 : Number(search) },
    ];
  }
  if (planFilter) query["subscription.planName"] = planFilter;

  const [users, total, plans] = await Promise.all([
    User.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    User.countDocuments(query),
    Plan.find({ isActive: true }),
  ]);

  res.send(usersHtml({ users, total, page, limit, search, planFilter, plans }));
});

adminRouter.post("/users/:id/block", requireAuth, async (req, res) => {
  await User.updateOne({ telegramId: req.params.id }, { $set: { isBlocked: true } });
  res.json({ success: true });
});
adminRouter.post("/users/:id/unblock", requireAuth, async (req, res) => {
  await User.updateOne({ telegramId: req.params.id }, { $set: { isBlocked: false } });
  res.json({ success: true });
});
adminRouter.post("/users/:id/credits", requireAuth, async (req, res) => {
  try {
    const { amount } = req.body;
    const newTotal = await addCredits(parseInt(req.params.id), parseInt(amount));
    res.json({ success: true, newTotal });
  } catch (err) {
    res.status(400).json({ success: false, error: String(err) });
  }
});
adminRouter.post("/users/:id/plan", requireAuth, async (req, res) => {
  try {
    const { planId } = req.body;
    await assignPlan(parseInt(req.params.id), planId);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, error: String(err) });
  }
});

// ── Plans ─────────────────────────────────────────────────────────────────────
adminRouter.get("/plans", requireAuth, async (_req, res) => {
  const [plans, users] = await Promise.all([Plan.find().sort({ price: 1 }), User.countDocuments()]);
  const planStats = await Promise.all(
    plans.map(async (p) => ({
      plan: p,
      userCount: await User.countDocuments({ "subscription.planName": p.name }),
    }))
  );
  res.send(plansHtml(planStats));
});

adminRouter.post("/plans/create", requireAuth, async (req, res) => {
  try {
    const { name, description, messagesPerMonth, price, currency, features, color, isDefault } = req.body;
    if (isDefault === "true") await Plan.updateMany({}, { $set: { isDefault: false } });
    await Plan.create({
      name, description, price: parseFloat(price) || 0,
      messagesPerMonth: parseInt(messagesPerMonth),
      currency: currency || "USD",
      features: (features || "").split("\n").map((f: string) => f.trim()).filter(Boolean),
      color: color || "#7c3aed",
      isDefault: isDefault === "true",
      isActive: true,
    });
    res.redirect("/admin/plans");
  } catch (err) {
    res.status(400).send(`Error: ${err}`);
  }
});

adminRouter.post("/plans/:id/toggle", requireAuth, async (req, res) => {
  const plan = await Plan.findById(req.params.id);
  if (!plan) return res.json({ success: false });
  await Plan.updateOne({ _id: plan._id }, { $set: { isActive: !plan.isActive } });
  res.json({ success: true });
});

adminRouter.post("/plans/:id/delete", requireAuth, async (req, res) => {
  await Plan.deleteOne({ _id: req.params.id });
  res.json({ success: true });
});

adminRouter.post("/plans/:id/edit", requireAuth, async (req, res) => {
  const { name, description, messagesPerMonth, price, features, color } = req.body;
  await Plan.updateOne({ _id: req.params.id }, {
    $set: {
      name, description,
      messagesPerMonth: parseInt(messagesPerMonth),
      price: parseFloat(price) || 0,
      features: (features || "").split("\n").map((f: string) => f.trim()).filter(Boolean),
      color: color || "#7c3aed",
    },
  });
  res.json({ success: true });
});

// ── Providers ──────────────────────────────────────────────────────────────────
adminRouter.get("/providers", requireAuth, async (_req, res) => {
  const providers = await AIProvider.find().sort({ priority: 1 });
  res.send(providersHtml(providers));
});
adminRouter.post("/providers/:slug/toggle", requireAuth, async (req, res) => {
  await toggleProvider(req.params.slug, req.body.enabled === "true");
  res.json({ success: true });
});
adminRouter.post("/providers/:slug/priority", requireAuth, async (req, res) => {
  await updateProviderPriority(req.params.slug, parseInt(req.body.priority));
  res.json({ success: true });
});

// ── Logs ───────────────────────────────────────────────────────────────────────
adminRouter.get("/logs", requireAuth, async (req, res) => {
  const level = (req.query.level as string) || "";
  const logs = await SystemLog.find(level ? { level } : {}).sort({ timestamp: -1 }).limit(100);
  res.send(logsHtml(logs));
});

// ── API ────────────────────────────────────────────────────────────────────────
adminRouter.get("/api/stats", requireAuth, async (_req, res) => {
  const [totalUsers, providers, totalConvs] = await Promise.all([
    User.countDocuments(), AIProvider.find(), Conversation.countDocuments(),
  ]);
  res.json({ totalUsers, providers, totalConvs });
});

// ═══════════════════════════════════════════════════════════════════════════════
// HTML Templates
// ═══════════════════════════════════════════════════════════════════════════════

const css = `
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0d0d1a;color:#e2e8f0;min-height:100vh}
.nav{background:#12122a;border-bottom:1px solid #1e1e40;padding:0 24px;display:flex;align-items:center;justify-content:space-between;height:60px;position:sticky;top:0;z-index:100}
.nav .brand{font-size:18px;font-weight:700;color:#7c3aed;text-decoration:none}
.nav a{color:#64748b;text-decoration:none;margin-left:18px;font-size:13px;transition:color .2s}
.nav a:hover,.nav a.active{color:#e2e8f0}
.wrap{max-width:1280px;margin:0 auto;padding:28px 24px}
.g4{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.g3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.g2{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
.card{background:#12122a;border:1px solid #1e1e40;border-radius:12px;padding:20px}
.stat{text-align:center}.stat .v{font-size:32px;font-weight:700;color:#7c3aed}.stat .l{font-size:12px;color:#475569;margin-top:4px}
h2{font-size:16px;font-weight:600;margin-bottom:14px;color:#e2e8f0}
.pt{font-size:22px;font-weight:700;margin-bottom:20px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;padding:9px 12px;color:#475569;border-bottom:1px solid #1e1e40;font-weight:500;font-size:12px;text-transform:uppercase;letter-spacing:.5px}
td{padding:9px 12px;border-bottom:1px solid #111128;vertical-align:middle}
tr:hover td{background:#14142e}
.badge{display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600}
.bg{background:#052e16;color:#4ade80}.br{background:#3b0018;color:#f87171}.by{background:#3b1f00;color:#fbbf24}.bb{background:#0c1a40;color:#60a5fa}.bp{background:#1e0f3b;color:#a78bfa}
.btn{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:500;cursor:pointer;border:none;transition:all .15s;text-decoration:none}
.bp1{background:#7c3aed;color:#fff}.bp1:hover{background:#6d28d9}
.bd{background:#dc2626;color:#fff}.bd:hover{background:#b91c1c}
.bs{background:#059669;color:#fff}.bs:hover{background:#047857}
.bw{background:#1e293b;color:#94a3b8;border:1px solid #334155}.bw:hover{background:#334155}
.sm{padding:4px 10px;font-size:12px}
input,select,textarea{background:#0d0d1a;border:1px solid #1e1e40;color:#e2e8f0;padding:8px 12px;border-radius:8px;font-size:13px;outline:none;width:100%}
input:focus,select:focus,textarea:focus{border-color:#7c3aed}
.mb{margin-bottom:16px}.mt{margin-top:16px}
.flex{display:flex}.aic{align-items:center}.jb{justify-content:space-between}.gap{gap:8px}
pre{background:#090916;padding:10px;border-radius:8px;font-size:11px;overflow-x:auto;color:#64748b;border:1px solid #1e1e40}
code{font-family:monospace;font-size:12px;background:#1a1a35;padding:1px 5px;border-radius:4px}
.plan-card{border-top:3px solid var(--c)}
.prog{height:6px;background:#1e1e40;border-radius:3px;overflow:hidden}.prog-fill{height:100%;border-radius:3px;background:#7c3aed;transition:width .3s}
.modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:200;align-items:center;justify-content:center}
.modal.show{display:flex}.modal-box{background:#12122a;border:1px solid #1e1e40;border-radius:14px;padding:28px;width:100%;max-width:480px}
.modal-box h3{font-size:18px;font-weight:600;margin-bottom:20px}
.form-row{margin-bottom:14px}.form-row label{display:block;font-size:12px;color:#64748b;margin-bottom:5px}
</style>`;

const nav = (active = "") => `
<nav class="nav">
  <a href="/admin/dashboard" class="brand">🤖 AI Bot Admin</a>
  <div class="flex aic">
    <a href="/admin/dashboard" class="${active === "dashboard" ? "active" : ""}">Dashboard</a>
    <a href="/admin/users" class="${active === "users" ? "active" : ""}">Users</a>
    <a href="/admin/plans" class="${active === "plans" ? "active" : ""}">Plans</a>
    <a href="/admin/providers" class="${active === "providers" ? "active" : ""}">Providers</a>
    <a href="/admin/logs" class="${active === "logs" ? "active" : ""}">Logs</a>
    <a href="/admin/logout">Logout</a>
  </div>
</nav>`;

function loginHtml(err = "") {
  return `<!DOCTYPE html><html><head><title>Admin Login</title>${css}
  <style>
    .lb{max-width:380px;margin:80px auto;padding:36px}
    .lt{font-size:26px;font-weight:700;color:#7c3aed;margin-bottom:4px}
    .ls{color:#475569;font-size:13px;margin-bottom:28px}
    .er{color:#f87171;font-size:13px;margin-bottom:12px;background:#1f0a0a;padding:8px 12px;border-radius:8px}
  </style>
  </head><body>
  <div class="lb card">
    <div class="lt">🤖 AI Bot</div>
    <div class="ls">Admin Control Panel</div>
    ${err ? `<div class="er">⚠️ ${err}</div>` : ""}
    <form method="POST" action="/admin/login">
      <div class="form-row"><label>Username</label><input name="username" type="text"/></div>
      <div class="form-row"><label>Password</label><input name="password" type="password"/></div>
      <button type="submit" class="btn bp1" style="width:100%;justify-content:center;padding:12px">Sign In</button>
    </form>
  </div></body></html>`;
}

function dashboardHtml(d: any) {
  return `<!DOCTYPE html><html><head><title>Dashboard</title>${css}</head><body>
  ${nav("dashboard")}
  <div class="wrap">
    <div class="pt">Dashboard</div>
    <div class="g4 mb">
      <div class="card stat"><div class="v">${d.totalUsers}</div><div class="l">Total Users</div></div>
      <div class="card stat"><div class="v">${d.activeUsers}</div><div class="l">Active Users</div></div>
      <div class="card stat"><div class="v">${d.blockedUsers}</div><div class="l">Blocked</div></div>
      <div class="card stat"><div class="v">${d.totalConvs}</div><div class="l">Conversations</div></div>
    </div>
    <div class="g3 mb">
      ${d.planStats.map((s: any) => `
        <div class="card plan-card" style="--c:${s.color}">
          <div class="l" style="font-size:12px;color:#475569;margin-bottom:4px">Plan</div>
          <div style="font-size:20px;font-weight:700">${s.name}</div>
          <div style="font-size:28px;font-weight:700;color:${s.color};margin-top:4px">${s.count}</div>
          <div style="font-size:12px;color:#475569">users</div>
        </div>`).join("")}
    </div>
    <div class="g2 mb">
      <div class="card">
        <h2>AI Providers</h2>
        <table>
          <thead><tr><th>Provider</th><th>Status</th><th>Requests</th><th>Success</th></tr></thead>
          <tbody>${d.providers.map((p: any) => {
            const pct = p.stats.totalRequests > 0 ? Math.round(((p.stats.totalRequests - p.stats.totalErrors) / p.stats.totalRequests) * 100) : 100;
            return `<tr>
              <td><strong>${p.name}</strong><br/><code style="font-size:11px">${p.defaultModel}</code></td>
              <td><span class="badge ${p.enabled ? "bg" : "br"}">${p.enabled ? "Active" : "Off"}</span></td>
              <td>${p.stats.totalRequests}</td>
              <td>${pct}%</td>
            </tr>`;
          }).join("")}</tbody>
        </table>
      </div>
      <div class="card">
        <h2>Recent Users</h2>
        <table>
          <thead><tr><th>User</th><th>Plan</th><th>Credits</th><th>Status</th></tr></thead>
          <tbody>${d.recentUsers.map((u: any) => `
            <tr>
              <td>${u.firstName || u.username || "Unknown"}<br/><code style="font-size:11px">${u.telegramId}</code></td>
              <td><span class="badge bb">${u.subscription?.planName || "Free"}</span></td>
              <td>${u.subscription?.creditsRemaining >= 999999 ? "∞" : (u.subscription?.creditsRemaining ?? 0)}</td>
              <td><span class="badge ${u.isBlocked ? "br" : "bg"}">${u.isBlocked ? "Blocked" : "Active"}</span></td>
            </tr>`).join("")}</tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <h2>Recent Logs</h2>
      <table>
        <thead><tr><th>Time</th><th>Level</th><th>Message</th></tr></thead>
        <tbody>${d.logs.map((l: any) => `
          <tr>
            <td style="white-space:nowrap;color:#475569;font-size:12px">${new Date(l.timestamp).toLocaleString()}</td>
            <td><span class="badge ${l.level === "error" ? "br" : l.level === "warn" ? "by" : "bb"}">${l.level}</span></td>
            <td>${l.message}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
  </div></body></html>`;
}

function usersHtml(d: any) {
  const totalPages = Math.ceil(d.total / d.limit);
  return `<!DOCTYPE html><html><head><title>Users</title>${css}</head><body>
  ${nav("users")}
  <div class="wrap">
    <div class="flex aic jb mb">
      <div class="pt" style="margin-bottom:0">Users (${d.total})</div>
      <form method="GET" class="flex gap">
        <input name="search" value="${d.search}" placeholder="Search..." style="width:200px"/>
        <select name="plan" style="width:130px">
          <option value="">All Plans</option>
          ${d.plans.map((p: any) => `<option value="${p.name}" ${d.planFilter === p.name ? "selected" : ""}>${p.name}</option>`).join("")}
        </select>
        <button type="submit" class="btn bp1 sm">Search</button>
      </form>
    </div>
    <div class="card">
      <table>
        <thead><tr><th>User</th><th>Telegram ID</th><th>Plan</th><th>Credits</th><th>Messages</th><th>Status</th><th>Joined</th><th>Actions</th></tr></thead>
        <tbody>${d.users.map((u: any) => {
          const sub = u.subscription || {};
          const remaining = sub.creditsRemaining >= 999999 ? "∞" : (sub.creditsRemaining ?? 0);
          const total = sub.creditsTotal >= 999999 ? "∞" : (sub.creditsTotal ?? 0);
          const pct = sub.creditsTotal > 0 && sub.creditsTotal < 999999
            ? Math.round(((sub.creditsTotal - sub.creditsRemaining) / sub.creditsTotal) * 100) : 0;
          return `<tr>
            <td><strong>${u.firstName || "-"}</strong> ${u.lastName || ""}<br/><small style="color:#475569">${u.username ? "@" + u.username : ""}</small></td>
            <td><code>${u.telegramId}</code></td>
            <td><span class="badge bb">${sub.planName || "Free"}</span></td>
            <td>
              <span style="font-size:13px;font-weight:600">${remaining}</span><span style="color:#475569;font-size:11px"> / ${total}</span>
              ${sub.creditsTotal < 999999 ? `<div class="prog mt" style="width:80px"><div class="prog-fill" style="width:${pct}%"></div></div>` : ""}
            </td>
            <td>${u.stats.totalMessages}</td>
            <td><span class="badge ${u.isBlocked ? "br" : "bg"}">${u.isBlocked ? "Blocked" : "Active"}</span></td>
            <td style="font-size:12px;color:#475569">${new Date(u.createdAt).toLocaleDateString()}</td>
            <td>
              <div class="flex gap">
                <button onclick="openCredits('${u.telegramId}')" class="btn bw sm">💬 Credits</button>
                <button onclick="openPlan('${u.telegramId}')" class="btn bw sm">📋 Plan</button>
                <button onclick="toggleBlock('${u.telegramId}',${u.isBlocked})" class="btn ${u.isBlocked ? "bs" : "bd"} sm">${u.isBlocked ? "Unblock" : "Block"}</button>
              </div>
            </td>
          </tr>`;
        }).join("")}</tbody>
      </table>
      ${totalPages > 1 ? `<div class="flex gap mt">${Array.from({length:totalPages},(_,i)=>i+1).map(p=>`<a href="?page=${p}&search=${d.search}&plan=${d.planFilter}" class="btn ${p===d.page?"bp1":"bw"} sm">${p}</a>`).join("")}</div>` : ""}
    </div>
  </div>

  <!-- Credits Modal -->
  <div class="modal" id="creditsModal">
    <div class="modal-box">
      <h3>💬 Add Credits</h3>
      <p style="color:#64748b;font-size:13px;margin-bottom:16px">Add or remove credits for user <strong id="creditUserId"></strong></p>
      <div class="form-row"><label>Amount (use negative to remove)</label><input type="number" id="creditAmount" value="50"/></div>
      <div class="flex gap mt">
        <button onclick="submitCredits()" class="btn bp1">Add Credits</button>
        <button onclick="closeModal('creditsModal')" class="btn bw">Cancel</button>
      </div>
    </div>
  </div>

  <!-- Plan Modal -->
  <div class="modal" id="planModal">
    <div class="modal-box">
      <h3>📋 Assign Plan</h3>
      <p style="color:#64748b;font-size:13px;margin-bottom:16px">Assign plan for user <strong id="planUserId"></strong></p>
      <div class="form-row">
        <label>Select Plan</label>
        <select id="planSelect">
          ${d.plans.map((p: any) => `<option value="${p._id}">${p.name} (${p.messagesPerMonth >= 999999 ? "Unlimited" : p.messagesPerMonth + " msgs/month"}) — $${p.price}/mo</option>`).join("")}
        </select>
      </div>
      <div class="flex gap mt">
        <button onclick="submitPlan()" class="btn bp1">Assign Plan</button>
        <button onclick="closeModal('planModal')" class="btn bw">Cancel</button>
      </div>
    </div>
  </div>

  <script>
    let _uid = null;
    function openCredits(id) { _uid = id; document.getElementById('creditUserId').textContent = id; document.getElementById('creditsModal').classList.add('show'); }
    function openPlan(id) { _uid = id; document.getElementById('planUserId').textContent = id; document.getElementById('planModal').classList.add('show'); }
    function closeModal(id) { document.getElementById(id).classList.remove('show'); _uid = null; }
    async function submitCredits() {
      const amt = document.getElementById('creditAmount').value;
      const r = await fetch('/admin/users/' + _uid + '/credits', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({amount:amt})});
      const j = await r.json();
      if (j.success) { closeModal('creditsModal'); location.reload(); } else { alert('Error: ' + j.error); }
    }
    async function submitPlan() {
      const planId = document.getElementById('planSelect').value;
      const r = await fetch('/admin/users/' + _uid + '/plan', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({planId})});
      const j = await r.json();
      if (j.success) { closeModal('planModal'); location.reload(); } else { alert('Error: ' + j.error); }
    }
    async function toggleBlock(id, isBlocked) {
      const url = isBlocked ? '/admin/users/' + id + '/unblock' : '/admin/users/' + id + '/block';
      await fetch(url, {method:'POST'});
      location.reload();
    }
    document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => { if(e.target === m) m.classList.remove('show'); }));
  </script>
  </body></html>`;
}

function plansHtml(planStats: any[]) {
  return `<!DOCTYPE html><html><head><title>Plans</title>${css}</head><body>
  ${nav("plans")}
  <div class="wrap">
    <div class="flex aic jb mb">
      <div class="pt" style="margin-bottom:0">Subscription Plans</div>
      <button onclick="document.getElementById('createModal').classList.add('show')" class="btn bp1">+ New Plan</button>
    </div>

    <div class="g3 mb">
      ${planStats.map(({ plan: p, userCount }: any) => `
        <div class="card plan-card" style="--c:${p.color}">
          <div class="flex aic jb mb">
            <div>
              <span class="badge" style="background:${p.color}22;color:${p.color};margin-bottom:6px">${p.isDefault ? "Default" : p.price === 0 ? "Free" : "$" + p.price + "/mo"}</span>
              <div style="font-size:20px;font-weight:700">${p.name}</div>
              <div style="font-size:13px;color:#64748b;margin-top:2px">${p.description}</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:28px;font-weight:700;color:${p.color}">${userCount}</div>
              <div style="font-size:12px;color:#475569">users</div>
            </div>
          </div>
          <div style="font-size:22px;font-weight:700;margin-bottom:8px">${p.messagesPerMonth >= 999999 ? "Unlimited ♾️" : p.messagesPerMonth.toLocaleString()}</div>
          <div style="font-size:12px;color:#64748b;margin-bottom:12px">messages / month</div>
          <ul style="font-size:13px;color:#94a3b8;padding-left:16px;margin-bottom:16px">
            ${p.features.map((f: string) => `<li>${f}</li>`).join("")}
          </ul>
          <div class="flex gap">
            <button onclick="editPlan('${p._id}','${p.name}','${p.description}',${p.messagesPerMonth},${p.price},'${p.color}','${p.features.join("\\n")}')" class="btn bw sm">✏️ Edit</button>
            <button onclick="togglePlan('${p._id}')" class="btn ${p.isActive ? "bd" : "bs"} sm">${p.isActive ? "Disable" : "Enable"}</button>
            ${!p.isDefault ? `<button onclick="deletePlan('${p._id}')" class="btn bd sm">🗑️</button>` : ""}
          </div>
        </div>`).join("")}
    </div>
  </div>

  <!-- Create Plan Modal -->
  <div class="modal" id="createModal">
    <div class="modal-box">
      <h3>Create New Plan</h3>
      <form method="POST" action="/admin/plans/create">
        <div class="form-row"><label>Plan Name</label><input name="name" placeholder="e.g. Premium" required/></div>
        <div class="form-row"><label>Description</label><input name="description" placeholder="Short description"/></div>
        <div class="g2">
          <div class="form-row"><label>Messages/Month</label><input name="messagesPerMonth" type="number" value="500" required/></div>
          <div class="form-row"><label>Price (USD)</label><input name="price" type="number" step="0.01" value="0"/></div>
        </div>
        <div class="form-row"><label>Color</label><input name="color" type="color" value="#7c3aed" style="height:40px;cursor:pointer"/></div>
        <div class="form-row"><label>Features (one per line)</label><textarea name="features" rows="4" placeholder="500 messages/month&#10;All AI models&#10;Priority support"></textarea></div>
        <div class="form-row"><label><input type="checkbox" name="isDefault" value="true" style="width:auto;margin-right:6px"/>Set as default plan for new users</label></div>
        <div class="flex gap mt">
          <button type="submit" class="btn bp1">Create Plan</button>
          <button type="button" onclick="closeModal('createModal')" class="btn bw">Cancel</button>
        </div>
      </form>
    </div>
  </div>

  <!-- Edit Plan Modal -->
  <div class="modal" id="editModal">
    <div class="modal-box">
      <h3>Edit Plan</h3>
      <div class="form-row"><label>Plan Name</label><input id="e_name" name="name"/></div>
      <div class="form-row"><label>Description</label><input id="e_desc"/></div>
      <div class="g2">
        <div class="form-row"><label>Messages/Month</label><input id="e_msgs" type="number"/></div>
        <div class="form-row"><label>Price (USD)</label><input id="e_price" type="number" step="0.01"/></div>
      </div>
      <div class="form-row"><label>Color</label><input id="e_color" type="color" style="height:40px;cursor:pointer"/></div>
      <div class="form-row"><label>Features (one per line)</label><textarea id="e_features" rows="4"></textarea></div>
      <div class="flex gap mt">
        <button onclick="submitEdit()" class="btn bp1">Save Changes</button>
        <button onclick="closeModal('editModal')" class="btn bw">Cancel</button>
      </div>
    </div>
  </div>

  <script>
    let _eid = null;
    function editPlan(id, name, desc, msgs, price, color, features) {
      _eid = id;
      document.getElementById('e_name').value = name;
      document.getElementById('e_desc').value = desc;
      document.getElementById('e_msgs').value = msgs;
      document.getElementById('e_price').value = price;
      document.getElementById('e_color').value = color;
      document.getElementById('e_features').value = features;
      document.getElementById('editModal').classList.add('show');
    }
    async function submitEdit() {
      const body = {
        name: document.getElementById('e_name').value,
        description: document.getElementById('e_desc').value,
        messagesPerMonth: document.getElementById('e_msgs').value,
        price: document.getElementById('e_price').value,
        color: document.getElementById('e_color').value,
        features: document.getElementById('e_features').value,
      };
      const r = await fetch('/admin/plans/' + _eid + '/edit', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const j = await r.json();
      if (j.success) location.reload(); else alert('Error: ' + j.error);
    }
    async function togglePlan(id) {
      await fetch('/admin/plans/' + id + '/toggle', {method:'POST'});
      location.reload();
    }
    async function deletePlan(id) {
      if (!confirm('Delete this plan?')) return;
      await fetch('/admin/plans/' + id + '/delete', {method:'POST'});
      location.reload();
    }
    function closeModal(id) { document.getElementById(id).classList.remove('show'); }
    document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => { if(e.target===m) m.classList.remove('show'); }));
  </script>
  </body></html>`;
}

function providersHtml(providers: any[]) {
  return `<!DOCTYPE html><html><head><title>Providers</title>${css}</head><body>
  ${nav("providers")}
  <div class="wrap">
    <div class="pt">AI Providers</div>
    <div class="card">
      <table>
        <thead><tr><th>Provider</th><th>Status</th><th>Priority</th><th>Default Model</th><th>Requests</th><th>Errors</th><th>Last Used</th><th>Actions</th></tr></thead>
        <tbody>${providers.map((p: any) => `
          <tr>
            <td><strong>${p.name}</strong><br/><code style="font-size:11px;color:#475569">${p.slug}</code></td>
            <td><span class="badge ${p.enabled ? "bg" : "br"}">${p.enabled ? "Active" : "Disabled"}</span></td>
            <td><input type="number" value="${p.priority}" min="1" max="100" style="width:64px" onchange="setPriority('${p.slug}',this.value)"/></td>
            <td><code>${p.defaultModel}</code></td>
            <td>${p.stats.totalRequests}</td>
            <td>${p.stats.totalErrors}</td>
            <td style="font-size:12px;color:#475569">${p.stats.lastUsedAt ? new Date(p.stats.lastUsedAt).toLocaleString() : "Never"}</td>
            <td><button onclick="toggleProvider('${p.slug}',${p.enabled})" class="btn ${p.enabled ? "bd" : "bs"} sm">${p.enabled ? "Disable" : "Enable"}</button></td>
          </tr>
          ${p.stats.lastError ? `<tr><td colspan="8"><pre>Last error: ${p.stats.lastError}</pre></td></tr>` : ""}`
        ).join("")}</tbody>
      </table>
    </div>
    <div class="card mt">
      <h2>Available Models per Provider</h2>
      ${providers.map((p: any) => `
        <div class="mb">
          <strong>${p.name}:</strong>
          ${p.models.map((m: string) => `<span class="badge bb" style="margin:2px">${m}</span>`).join(" ")}
        </div>`).join("")}
    </div>
  </div>
  <script>
    async function toggleProvider(slug, enabled) {
      await fetch('/admin/providers/'+slug+'/toggle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:String(!enabled)})});
      location.reload();
    }
    async function setPriority(slug, priority) {
      await fetch('/admin/providers/'+slug+'/priority',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({priority})});
    }
  </script>
  </body></html>`;
}

function logsHtml(logs: any[]) {
  return `<!DOCTYPE html><html><head><title>Logs</title>${css}</head><body>
  ${nav("logs")}
  <div class="wrap">
    <div class="flex aic jb mb">
      <div class="pt" style="margin-bottom:0">System Logs</div>
      <form method="GET" class="flex gap">
        <select name="level" style="width:140px">
          <option value="">All Levels</option>
          <option value="info">Info</option>
          <option value="warn">Warning</option>
          <option value="error">Error</option>
        </select>
        <button type="submit" class="btn bp1 sm">Filter</button>
      </form>
    </div>
    <div class="card">
      ${logs.length === 0 ? "<p style='color:#475569'>No logs found.</p>" : `
      <table>
        <thead><tr><th>Timestamp</th><th>Level</th><th>Message</th><th>Meta</th></tr></thead>
        <tbody>${logs.map((l: any) => `
          <tr>
            <td style="white-space:nowrap;font-size:12px;color:#475569">${new Date(l.timestamp).toLocaleString()}</td>
            <td><span class="badge ${l.level==="error"?"br":l.level==="warn"?"by":"bb"}">${l.level}</span></td>
            <td>${l.message}</td>
            <td><code style="font-size:11px">${l.meta ? JSON.stringify(l.meta).slice(0,80) : ""}</code></td>
          </tr>`).join("")}
        </tbody>
      </table>`}
    </div>
  </div>
  </body></html>`;
}
