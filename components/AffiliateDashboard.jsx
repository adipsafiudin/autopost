"use client";

import { useEffect, useMemo, useState } from "react";

const STORE_KEY = "affiliateQueue.v2";

const views = [
  ["products", "1. Input Produk"],
  ["search", "2. Cari Konten"],
  ["generate", "3. Generate Konten"],
  ["publish", "4. Post / Reply"],
  ["settings", "Settings"],
];

const defaultSettings = {
  dailyPostLimit: 3,
  dailyReplyLimit: 10,
  minReplyDelay: 20,
  maxReplyDelay: 40,
  disclosure: "Link affiliate Shopee #affiliate",
  blockedKeywords: "pinjol, judi, dewasa, obat keras",
  threadsMode: "mock",
  autoReplySend: false,
};

const initialState = {
  products: [],
  drafts: [],
  opportunities: [],
  replies: [],
  logs: [],
  settings: defaultSettings,
};

export default function AffiliateDashboard() {
  const [activeView, setActiveView] = useState("products");
  const [state, setState] = useState(initialState);
  const [ready, setReady] = useState(false);
  const [backendStatus, setBackendStatus] = useState({
    backend: false,
    discoveryMode: "loading",
    configured: false,
    threads: { connected: false },
  });

  useEffect(() => {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      setState({ ...parsed, settings: { ...defaultSettings, ...(parsed.settings || {}) } });
    }
    setReady(true);
    refreshBackendStatus(false);
  }, []);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }, [ready, state]);

  function update(mutator) {
    setState((current) => {
      const next = structuredClone(current);
      mutator(next);
      return next;
    });
  }

  function addLog(type, message, meta = {}) {
    update((draft) => {
      draft.logs.unshift({ id: makeId("log"), type, message, meta, createdAt: new Date().toISOString() });
      draft.logs = draft.logs.slice(0, 100);
    });
  }

  async function apiJson(path, options = {}) {
    const response = await fetch(path, {
      headers: { "content-type": "application/json", ...(options.headers || {}) },
      ...options,
    });
    const body = await response.json();
    if (!response.ok || body.ok === false) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  }

  async function refreshBackendStatus(showLog = true) {
    try {
      const status = await apiJson("/api/status");
      setBackendStatus(status);
      if (showLog) addLog("success", "Status backend diperbarui");
    } catch (error) {
      setBackendStatus({ backend: false, discoveryMode: "unavailable", configured: false, threads: { connected: false } });
      if (showLog) addLog("error", `Backend tidak tersedia: ${error.message}`);
    }
  }

  async function connectThreads() {
    try {
      const result = await apiJson("/api/threads/auth-url", { method: "POST", body: "{}" });
      window.location.href = result.authUrl;
    } catch (error) {
      addLog("error", `Connect Threads gagal: ${error.message}`);
    }
  }

  function seedData() {
    if (state.products.length) {
      addLog("info", "Sample tidak dimuat karena produk sudah ada");
      return;
    }
    const products = [
      sampleProduct("Vacuum cleaner mini portable", "rumah tangga", "99000", "anak kos dan pekerja remote", "hemat tempat, cocok untuk debu meja, gampang dibawa", "vacuum mini, debu keyboard, alat bersih meja"),
      sampleProduct("Lampu tidur sensor sentuh", "dekorasi kamar", "45000", "orang yang ingin kamar lebih nyaman", "cahaya lembut, hemat listrik, mudah dipindah", "lampu tidur, dekorasi kamar, lampu meja"),
    ];
    update((draft) => {
      draft.products = products;
      products.forEach((product) => pushGeneratedDrafts(draft, product));
    });
    addLog("success", "Sample data dimuat");
  }

  function addProduct(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    update((draft) => {
      draft.products.unshift({ id: makeId("product"), status: "active", createdAt: new Date().toISOString(), ...data });
    });
    event.currentTarget.reset();
    addLog("success", `Produk ${data.name} disimpan`);
  }

  function generateAllDrafts() {
    update((draft) => draft.products.filter((item) => item.status === "active").forEach((product) => pushGeneratedDrafts(draft, product)));
    addLog("success", "Draft post otomatis dibuat untuk semua produk aktif");
  }

  function generateProduct(productId) {
    update((draft) => {
      const product = draft.products.find((item) => item.id === productId);
      if (product) pushGeneratedDrafts(draft, product);
    });
    addLog("success", "Draft produk dibuat");
  }

  function pushGeneratedDrafts(draft, product) {
    generateCaptions(product, draft.settings).forEach((caption) => {
      if (draft.drafts.some((item) => item.caption.trim().toLowerCase() === caption.trim().toLowerCase())) return;
      draft.drafts.unshift({ id: makeId("draft"), productId: product.id, caption, status: "draft", createdAt: new Date().toISOString() });
    });
  }

  async function findOpportunities(productId = null) {
    const products = (productId ? state.products.filter((item) => item.id === productId) : state.products).filter((item) => item.status === "active");
    try {
      const result = await apiJson("/api/discovery/run", {
        method: "POST",
        body: JSON.stringify({ products, settings: state.settings }),
      });
      update((draft) => mergeOpportunities(draft, result.opportunities || []));
      addLog("success", `Opportunity discovery selesai via ${result.mode || "provider"}`);
    } catch (error) {
      addLog("error", `Discovery gagal: ${error.message}`);
    }
  }

  function mergeOpportunities(draft, opportunities) {
    opportunities.forEach((candidate) => {
      const product = draft.products.find((item) => item.id === candidate.productId);
      if (!product) return;
      const scored = scoreOpportunity(product, candidate, draft.settings);
      if (scored.totalScore < 45 || scored.spamRisk > 65) return;
      if (draft.opportunities.some((item) => item.text === candidate.text && item.productId === product.id)) return;
      draft.opportunities.unshift({
        id: makeId("opp"),
        productId: product.id,
        status: "queued",
        platform: candidate.platform || "Threads provider",
        createdAt: new Date().toISOString(),
        ...candidate,
        ...scored,
      });
    });
  }

  function createReply(opportunityId) {
    update((draft) => {
      const opportunity = draft.opportunities.find((item) => item.id === opportunityId);
      const product = draft.products.find((item) => item.id === opportunity?.productId);
      if (!opportunity || !product) return;
      const body = `Bisa cek ${product.name}. Menurutku cocok buat kebutuhan ini karena ${splitList(product.sellingPoints)[0] || "praktis dan value-nya oke"}.\n\n${product.affiliateUrl}\n${draft.settings.disclosure}`;
      if (draft.replies.some((item) => item.body.trim().toLowerCase() === body.trim().toLowerCase())) return;
      draft.replies.unshift({
        id: makeId("reply"),
        productId: product.id,
        opportunityId,
        status: "draft",
        body,
        targetAuthor: opportunity.author,
        targetThreadId: opportunity.targetThreadId || "",
        platform: opportunity.platform,
        createdAt: new Date().toISOString(),
      });
      opportunity.status = "scored";
    });
    addLog("success", "Reply draft masuk approval queue");
  }

  function addManualReply(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const product = state.products.find((item) => item.id === data.productId);
    if (!product) {
      addLog("error", "Pilih produk sebelum membuat reply");
      return;
    }
    const targetThreadId = extractThreadId(data.targetThreadId);
    const body = data.body?.trim() || `Bisa cek ${product.name}. Menurutku cocok buat kebutuhan ini karena ${splitList(product.sellingPoints)[0] || "praktis dan value-nya oke"}.\n\n${product.affiliateUrl}\n${state.settings.disclosure}`;
    update((draft) => {
      draft.replies.unshift({
        id: makeId("reply"),
        productId: product.id,
        opportunityId: "",
        status: "draft",
        body,
        targetAuthor: data.targetAuthor || "manual target",
        targetThreadId,
        platform: "Threads manual target",
        createdAt: new Date().toISOString(),
      });
    });
    event.currentTarget.reset();
    addLog("success", "Manual reply draft dibuat");
  }

  function approveDraft(draftId) {
    update((draft) => {
      const item = draft.drafts.find((entry) => entry.id === draftId);
      if (!item) return;
      item.status = "scheduled";
      item.scheduledAt = nextPostTime(draft.drafts).toISOString();
    });
    addLog("success", "Draft disetujui dan masuk schedule");
  }

  function approveReply(replyId) {
    update((draft) => {
      const item = draft.replies.find((entry) => entry.id === replyId);
      if (!item) return;
      if (draft.settings.threadsMode === "live" && !item.targetThreadId) {
        item.status = "failed";
        item.error = "Reply live membutuhkan targetThreadId valid. Mock opportunity tidak bisa dikirim ke Threads sungguhan.";
        return;
      }
      const approvedToday = draft.replies.filter((reply) => reply.approvedAt?.startsWith(todayKey())).length;
      if (approvedToday >= draft.settings.dailyReplyLimit) {
        item.status = "skipped";
        return;
      }
      item.status = "approved";
      item.approvedAt = new Date().toISOString();
      item.scheduledAt = nextReplyTime(draft.settings).toISOString();
    });
    addLog("success", "Reply disetujui dan diberi delay");
  }

  async function replyNow(replyId) {
    const reply = state.replies.find((item) => item.id === replyId);
    if (!reply) return;
    if (state.settings.threadsMode === "live" && !reply.targetThreadId) {
      markReplyFailed(reply.id, "Reply live membutuhkan targetThreadId valid. Buat manual reply dengan targetThreadId atau gunakan discovery provider resmi.");
      return;
    }
    if (state.settings.threadsMode === "live") {
      try {
        const result = await apiJson("/api/threads/reply", { method: "POST", body: JSON.stringify({ text: reply.body, targetThreadId: reply.targetThreadId }) });
        markReplyPosted(reply.id, result.result?.id || "threads_live_reply");
      } catch (error) {
        markReplyFailed(reply.id, error.message);
      }
    } else if (state.settings.threadsMode === "api-ready") {
      markReplyFailed(reply.id, "Pilih mode live dan connect Threads untuk reply sungguhan.");
    } else {
      markReplyPosted(reply.id, `mock_reply_${Date.now()}`);
    }
  }

  async function runScheduler() {
    const dueDrafts = state.drafts.filter((item) => item.status === "scheduled" && new Date(item.scheduledAt) <= new Date());
    let remaining = Math.max(0, state.settings.dailyPostLimit - state.drafts.filter((item) => item.postedAt?.startsWith(todayKey())).length);
    for (const draft of dueDrafts) {
      if (remaining <= 0) break;
      await publishDraft(draft);
      remaining -= 1;
    }
    await runReplyScheduler();
  }

  async function postNow(draftId) {
    const draft = state.drafts.find((item) => item.id === draftId);
    if (!draft) return;
    const postedToday = state.drafts.filter((item) => item.postedAt?.startsWith(todayKey())).length;
    if (postedToday >= state.settings.dailyPostLimit) {
      addLog("error", "Daily post limit tercapai. Naikkan limit di Settings jika perlu.");
      return;
    }
    await publishDraft(draft);
  }

  async function publishDraft(draft) {
    if (state.settings.threadsMode === "live") {
      try {
        const result = await apiJson("/api/threads/publish", { method: "POST", body: JSON.stringify({ text: draft.caption }) });
        markDraftPosted(draft.id, result.result?.id || "threads_live_post");
      } catch (error) {
        markDraftFailed(draft.id, error.message);
      }
    } else if (state.settings.threadsMode === "api-ready") {
      markDraftFailed(draft.id, "Pilih mode live dan connect Threads untuk publish sungguhan.");
    } else {
      markDraftPosted(draft.id, `mock_threads_${Date.now()}`);
    }
  }

  async function runReplyScheduler() {
    if (state.settings.threadsMode === "live" && !state.settings.autoReplySend) {
      addLog("info", "Reply scheduler dilewati karena auto-send approved replies masih off");
      return;
    }
    const dueReplies = state.replies.filter((item) => item.status === "approved" && new Date(item.scheduledAt) <= new Date());
    for (const reply of dueReplies) {
      if (state.settings.threadsMode === "live") {
        try {
          const result = await apiJson("/api/threads/reply", { method: "POST", body: JSON.stringify({ text: reply.body, targetThreadId: reply.targetThreadId }) });
          markReplyPosted(reply.id, result.result?.id || "threads_live_reply");
        } catch (error) {
          markReplyFailed(reply.id, error.message);
        }
      } else {
        markReplyPosted(reply.id, `mock_reply_${Date.now()}`);
      }
    }
  }

  function markDraftPosted(draftId, platformPostId) {
    update((draft) => {
      const item = draft.drafts.find((entry) => entry.id === draftId);
      if (!item) return;
      item.status = "posted";
      item.postedAt = new Date().toISOString();
      item.platformPostId = platformPostId;
    });
    addLog("success", "Post terkirim");
  }

  function markDraftFailed(draftId, error) {
    update((draft) => {
      const item = draft.drafts.find((entry) => entry.id === draftId);
      if (!item) return;
      item.status = "failed";
      item.error = error;
    });
    addLog("error", `Publish gagal: ${error}`);
  }

  function markReplyPosted(replyId, platformReplyId) {
    update((draft) => {
      const item = draft.replies.find((entry) => entry.id === replyId);
      if (!item) return;
      item.status = "posted";
      item.postedAt = new Date().toISOString();
      item.platformReplyId = platformReplyId;
    });
    addLog("success", "Reply terkirim");
  }

  function markReplyFailed(replyId, error) {
    update((draft) => {
      const item = draft.replies.find((entry) => entry.id === replyId);
      if (!item) return;
      item.status = "failed";
      item.error = error;
    });
    addLog("error", `Reply gagal: ${error}`);
  }

  const counts = useMemo(() => ({
    products: state.products.length,
    search: state.opportunities.filter((item) => item.status === "queued").length,
    generate: state.drafts.filter((item) => item.status === "draft").length + state.replies.filter((item) => item.status === "draft").length,
    publish: state.drafts.filter((item) => ["draft", "scheduled", "failed"].includes(item.status)).length + state.replies.filter((item) => ["draft", "approved", "failed"].includes(item.status)).length,
  }), [state]);

  return (
    <>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div><strong>Affiliate Queue</strong><span>Next.js + Vercel ready</span></div>
        </div>
        <nav>
          {views.map(([id, label]) => (
            <button className={`nav-btn ${activeView === id ? "active" : ""}`} key={id} onClick={() => setActiveView(id)} type="button">
              <span>{label}</span>
              {counts[id] ? <span className="badge">{counts[id]}</span> : null}
            </button>
          ))}
        </nav>
      </aside>
      <main className="shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">Shopee affiliate autopost v1</p>
            <h1>{views.find(([id]) => id === activeView)?.[1]}</h1>
          </div>
          <div className="top-actions">
            <span className={`badge ${backendStatus.threads?.connected ? "ok" : "warn"}`}>{backendStatus.threads?.connected ? "Threads connected" : "Connect Threads dulu"}</span>
            <button className="ghost" onClick={seedData} type="button">Load sample</button>
          </div>
        </header>
        <section className="notice">
          <strong>Alur utama:</strong> input produk, cari konten relevan, generate konten, lalu pilih mau dijadikan post utama atau reply.
        </section>
        <FlowStatus state={state} backendStatus={backendStatus} onConnect={connectThreads} onRefresh={() => refreshBackendStatus()} setActiveView={setActiveView} />
        {activeView === "products" && <Products state={state} onAdd={addProduct} onGenerate={generateProduct} onFind={findOpportunities} onToggle={(id) => update((draft) => { const p = draft.products.find((item) => item.id === id); if (p) p.status = p.status === "active" ? "paused" : "active"; })} setActiveView={setActiveView} />}
        {activeView === "search" && <SearchContent state={state} onFind={() => findOpportunities()} onQueue={createReply} onReject={(id) => update((draft) => { const item = draft.opportunities.find((entry) => entry.id === id); if (item) item.status = "rejected"; })} />}
        {activeView === "generate" && <GenerateContent state={state} onGenerate={generateAllDrafts} onQueue={createReply} onApprove={approveDraft} onPostNow={postNow} onReject={(id) => update((draft) => { const item = draft.drafts.find((entry) => entry.id === id); if (item) item.status = "rejected"; })} />}
        {activeView === "publish" && <PublishCenter state={state} onPostNow={postNow} onReplyNow={replyNow} onRun={runScheduler} onSkipReply={(id) => update((draft) => { const item = draft.replies.find((entry) => entry.id === id); if (item) item.status = "skipped"; })} />}
        {activeView === "settings" && <Settings state={state} onSave={(settings) => update((draft) => { draft.settings = settings; })} />}
      </main>
    </>
  );
}

function Dashboard({ state, backendStatus, onGenerate, onFind, onReply, onConnect, onRefresh, setActiveView }) {
  const liveReady = state.settings.threadsMode === "live" && backendStatus.threads?.connected;
  return (
    <>
      <section className="panel">
        <div className="flow-header">
          <div>
            <h2>Mulai dari sini</h2>
            <p className="muted">Ikuti langkah berurutan. Untuk posting, cukup tambah produk, buat draft, lalu klik Post now.</p>
          </div>
          <span className={`badge ${liveReady ? "ok" : "warn"}`}>{liveReady ? "siap live" : "perlu setup"}</span>
        </div>
        <div className="flow-steps">
          <button className="step-card" onClick={() => setActiveView("settings")} type="button"><strong>1</strong><span>Set mode live</span><small>{state.settings.threadsMode}</small></button>
          <button className="step-card" onClick={onConnect} type="button"><strong>2</strong><span>Connect Threads</span><small>{backendStatus.threads?.connected ? "connected" : "belum connect"}</small></button>
          <button className="step-card" onClick={() => setActiveView("products")} type="button"><strong>3</strong><span>Input produk</span><small>{state.products.length} produk</small></button>
          <button className="step-card" onClick={() => setActiveView("posts")} type="button"><strong>4</strong><span>Buat & post</span><small>{state.drafts.filter((item) => item.status === "draft").length} draft</small></button>
          <button className="step-card" onClick={() => setActiveView("replies")} type="button"><strong>5</strong><span>Reply manual</span><small>{state.replies.filter((item) => item.status === "draft").length} draft</small></button>
        </div>
      </section>
      <div className="grid metrics">
        <Metric label="Produk aktif" value={state.products.filter((item) => item.status === "active").length} />
        <Metric label="Draft pending" value={state.drafts.filter((item) => item.status === "draft").length} />
        <Metric label="Scheduled posts" value={state.drafts.filter((item) => item.status === "scheduled").length} />
        <Metric label="Errors" value={state.logs.filter((item) => item.type === "error").length} />
      </div>
      <div className="grid two" style={{ marginTop: 14 }}>
        <section className="panel">
          <h2>Daily Control</h2>
          <p className="muted">Aksi cepat setelah setup selesai.</p>
          <div className="actions">
            <button className="primary" onClick={onGenerate} type="button">Generate all</button>
            <button className="secondary" onClick={onFind} type="button">Find opportunities</button>
            <button className="secondary" onClick={onReply} type="button">Run reply scheduler</button>
          </div>
          <p className="status-note">Mode Threads: {state.settings.threadsMode}. Daily post limit {state.settings.dailyPostLimit}, reply limit {state.settings.dailyReplyLimit}.</p>
        </section>
        <section className="panel">
          <h2>Threads Account</h2>
          <p><span className={`badge ${backendStatus.threads?.connected ? "ok" : backendStatus.configured ? "warn" : "danger"}`}>{backendStatus.threads?.connected ? "connected" : backendStatus.configured ? "ready" : "not configured"}</span></p>
          <p className="muted">Backend: {backendStatus.backend ? "online" : "offline"} - Discovery: {backendStatus.discoveryMode}</p>
          <p className="muted">User: {backendStatus.threads?.userId || "-"}</p>
          <div className="actions">
            <button className="primary" onClick={onConnect} type="button">Connect Threads</button>
            <button className="ghost" onClick={onRefresh} type="button">Refresh status</button>
          </div>
        </section>
        <section className="panel">
          <h2>Recent Logs</h2>
          <Logs logs={state.logs.slice(0, 8)} />
        </section>
      </div>
    </>
  );
}

function FlowStatus({ state, backendStatus, onConnect, onRefresh, setActiveView }) {
  return (
    <section className="panel flow-panel">
      <div className="flow-steps">
        <button className="step-card" onClick={() => setActiveView("products")} type="button"><strong>1</strong><span>Input produk</span><small>{state.products.length} produk</small></button>
        <button className="step-card" onClick={() => setActiveView("search")} type="button"><strong>2</strong><span>Cari konten</span><small>{state.opportunities.filter((item) => item.status === "queued").length} target</small></button>
        <button className="step-card" onClick={() => setActiveView("generate")} type="button"><strong>3</strong><span>Generate konten</span><small>{state.drafts.filter((item) => item.status === "draft").length} post, {state.replies.filter((item) => item.status === "draft").length} reply</small></button>
        <button className="step-card" onClick={() => setActiveView("publish")} type="button"><strong>4</strong><span>Post / Reply</span><small>{state.drafts.filter((item) => item.status === "posted").length} posted</small></button>
      </div>
      <div className="setup-strip">
        <span className={`badge ${state.settings.threadsMode === "live" ? "ok" : "warn"}`}>mode: {state.settings.threadsMode}</span>
        <span className={`badge ${backendStatus.threads?.connected ? "ok" : "warn"}`}>{backendStatus.threads?.connected ? "connected" : "not connected"}</span>
        <button className="secondary" onClick={onConnect} type="button">Connect Threads</button>
        <button className="ghost" onClick={onRefresh} type="button">Refresh</button>
      </div>
    </section>
  );
}

function Products({ state, onAdd, onGenerate, onFind, onToggle, setActiveView }) {
  return (
    <div className="grid two">
      <section className="panel">
        <h2>Tambah Produk Affiliate</h2>
        <p className="muted">Masukkan produk sekali. Keyword dipakai untuk mencari post orang lain yang cocok direply.</p>
        <form className="form" onSubmit={onAdd}>
          <label>Nama produk<input name="name" required placeholder="Contoh: Vacuum cleaner mini portable" /></label>
          <label>Link affiliate Shopee<input name="affiliateUrl" required placeholder="https://shopee.co.id/..." /></label>
          <label>Kategori<input name="category" placeholder="Rumah tangga, gadget, fashion" /></label>
          <label>Harga/promo<input name="price" inputMode="numeric" placeholder="99000" /></label>
          <label>Target pembeli<input name="audience" placeholder="anak kos, ibu rumah tangga, pekerja remote" /></label>
          <label>Selling point<textarea name="sellingPoints" placeholder="hemat tempat, gampang dibersihkan, cocok untuk meja kerja" /></label>
          <label>Keyword target<textarea name="keywords" placeholder="vacuum mini, debu keyboard, alat bersih meja" /></label>
          <button className="primary" type="submit">Save product</button>
        </form>
      </section>
      <section className="grid">
        {state.products.length ? state.products.map((product) => (
          <article className="card" key={product.id}>
            <div className="card-header">
              <div><h3>{product.name}</h3><span className={`badge ${product.status === "active" ? "ok" : "warn"}`}>{product.status}</span></div>
              <button className="ghost" onClick={() => onToggle(product.id)} type="button">{product.status === "active" ? "Pause" : "Activate"}</button>
            </div>
            <p className="muted">{product.category || "Tanpa kategori"} - {money(product.price)}</p>
            <p>{productProfile(product).problem}</p>
            <div className="actions">
              <button className="secondary" onClick={() => onGenerate(product.id)} type="button">Generate content</button>
              <button className="ghost" onClick={() => onFind(product.id)} type="button">Cari target</button>
              <button className="primary" onClick={() => setActiveView("search")} type="button">Lanjut</button>
            </div>
          </article>
        )) : <Empty label="Belum ada produk" />}
      </section>
    </div>
  );
}

function SearchContent({ state, onFind, onQueue, onReject }) {
  const opportunities = state.opportunities.filter((item) => item.status === "queued");
  return (
    <>
      <section className="panel">
        <div className="card-header">
          <div>
            <h2>Cari post orang lain yang relevan</h2>
            <p className="muted">Sistem memakai keyword produk. Di mode live, ini mencoba Threads Keyword Search; di mode mock, hanya contoh target.</p>
          </div>
          <button className="primary" onClick={onFind} type="button">Cari konten relevan</button>
        </div>
      </section>
      <div className="grid two" style={{ marginTop: 14 }}>
        {opportunities.length ? opportunities.map((item) => <OpportunityCard key={item.id} item={item} product={state.products.find((p) => p.id === item.productId)} onReply={() => onQueue(item.id)} onReject={() => onReject(item.id)} />) : <Empty label="Belum ada target reply" />}
      </div>
    </>
  );
}

function GenerateContent({ state, onGenerate, onQueue, onApprove, onPostNow, onReject }) {
  const drafts = state.drafts.filter((item) => item.status === "draft");
  const opportunities = state.opportunities.filter((item) => item.status === "queued");
  const replies = state.replies.filter((item) => item.status === "draft");
  return (
    <>
      <section className="panel">
        <div className="card-header">
          <div>
            <h2>Generate konten untuk post atau reply</h2>
            <p className="muted">Generate post utama dari produk, atau generate reply dari target yang ditemukan.</p>
          </div>
          <button className="primary" onClick={onGenerate} type="button">Generate post utama</button>
        </div>
      </section>
      <div className="grid two" style={{ marginTop: 14 }}>
        <section className="panel">
          <h2>Target untuk dijadikan reply</h2>
          {opportunities.length ? opportunities.slice(0, 6).map((item) => (
            <article className="mini-card" key={item.id}>
              <strong>{item.author}</strong>
              <p>{item.text}</p>
              <span className="muted">Produk: {state.products.find((p) => p.id === item.productId)?.name || "-"}</span>
              <button className="secondary" onClick={() => onQueue(item.id)} type="button">Generate reply</button>
            </article>
          )) : <Empty label="Belum ada target" />}
        </section>
        <section className="panel">
          <h2>Reply draft</h2>
          {replies.length ? replies.map((reply) => (
            <article className="mini-card" key={reply.id}>
              <strong>{reply.targetAuthor}</strong>
              <p className="copy">{reply.body}</p>
              <span className="muted">Thread ID: {reply.targetThreadId || "belum tersedia"}</span>
            </article>
          )) : <Empty label="Belum ada reply draft" />}
        </section>
      </div>
      <div className="grid three" style={{ marginTop: 14 }}>
        {drafts.length ? drafts.map((draft) => <ContentCard key={draft.id} item={draft} product={state.products.find((p) => p.id === draft.productId)} onApprove={() => onApprove(draft.id)} onPostNow={() => onPostNow(draft.id)} onReject={() => onReject(draft.id)} />) : <Empty label="Belum ada post draft" />}
      </div>
    </>
  );
}

function PublishCenter({ state, onPostNow, onReplyNow, onRun, onSkipReply }) {
  const posts = state.drafts.filter((item) => ["draft", "scheduled", "failed", "posted"].includes(item.status));
  const replies = state.replies.filter((item) => ["draft", "approved", "failed", "posted"].includes(item.status));
  return (
    <>
      <section className="panel">
        <div className="card-header">
          <div>
            <h2>Pilih output konten</h2>
            <p className="muted">Konten bisa dikirim sebagai post utama atau sebagai reply ke target yang ditemukan.</p>
          </div>
          <button className="secondary" onClick={onRun} type="button">Run scheduled</button>
        </div>
      </section>
      <div className="grid two" style={{ marginTop: 14 }}>
        <section className="panel">
          <h2>Post di halaman utama</h2>
          {posts.length ? <ScheduleTable rows={posts} onPostNow={onPostNow} /> : <Empty label="Belum ada post draft" />}
        </section>
        <section className="panel">
          <h2>Reply ke post orang lain</h2>
          {replies.length ? replies.map((reply) => (
            <article className="card" key={reply.id}>
              <div className="card-header"><span className={`badge ${reply.status === "posted" ? "ok" : reply.status === "failed" ? "danger" : ""}`}>{reply.status}</span><span className="muted">{reply.targetAuthor}</span></div>
              <p className="muted">Thread ID: {reply.targetThreadId || "belum tersedia"}</p>
              <p className="copy">{reply.body}</p>
              {reply.error ? <p className="muted">{reply.error}</p> : null}
              <div className="actions">
                {reply.status !== "posted" ? <button className="primary" onClick={() => onReplyNow(reply.id)} type="button">Reply now</button> : null}
                <button className="danger" onClick={() => onSkipReply(reply.id)} type="button">Skip</button>
              </div>
            </article>
          )) : <Empty label="Belum ada reply draft" />}
        </section>
      </div>
    </>
  );
}

function Drafts({ state, onGenerate, onApprove, onPostNow, onReject }) {
  const drafts = state.drafts.filter((item) => item.status === "draft");
  return (
    <>
      <section className="panel">
        <div className="card-header"><div><h2>Post Drafts</h2><p className="muted">Approve satu per satu sebelum masuk schedule.</p></div><button className="primary" onClick={onGenerate} type="button">Generate drafts</button></div>
      </section>
      <div className="grid three" style={{ marginTop: 14 }}>
        {drafts.length ? drafts.map((draft) => <ContentCard key={draft.id} item={draft} product={state.products.find((p) => p.id === draft.productId)} onApprove={() => onApprove(draft.id)} onPostNow={() => onPostNow(draft.id)} onReject={() => onReject(draft.id)} />) : <Empty label="Belum ada draft" />}
      </div>
    </>
  );
}

function Opportunities({ state, onFind, onReply, onReject }) {
  const opportunities = state.opportunities.filter((item) => item.status === "queued");
  return (
    <>
      <section className="panel"><div className="card-header"><div><h2>Opportunity Finder</h2><p className="muted">Pakai discovery provider berizin jika dikonfigurasi. Tanpa provider, sistem memakai mock.</p></div><button className="primary" onClick={onFind} type="button">Find opportunities</button></div></section>
      <div className="grid two" style={{ marginTop: 14 }}>
        {opportunities.length ? opportunities.map((item) => <OpportunityCard key={item.id} item={item} product={state.products.find((p) => p.id === item.productId)} onReply={() => onReply(item.id)} onReject={() => onReject(item.id)} />) : <Empty label="Belum ada opportunity" />}
      </div>
    </>
  );
}

function Replies({ state, onManualReply, onFind, onQueue, onApprove, onReplyNow, onSkip }) {
  const replies = state.replies.filter((item) => ["draft", "approved", "failed"].includes(item.status));
  const opportunities = state.opportunities.filter((item) => item.status === "queued");
  return (
    <>
      <section className="panel">
        <h2>Reply yang bisa terkirim live</h2>
        <p className="muted">Di mode live, sistem mencari post orang lain lewat Threads Keyword Search, membuat draft reply, lalu kamu klik Reply now.</p>
        <p className="status-note">Setelah menambahkan permission `threads_keyword_search`, klik Connect Threads lagi agar token baru membawa izin search.</p>
      </section>
      <div className="grid two" style={{ marginTop: 14 }}>
        <section className="panel">
          <h2>Buat Reply Manual</h2>
          <form className="form" onSubmit={onManualReply}>
            <label>Produk
              <select name="productId" required defaultValue="">
                <option value="" disabled>Pilih produk</option>
                {state.products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
              </select>
            </label>
            <label>Target Thread ID<input name="targetThreadId" placeholder="Contoh: 18051115952767669" /></label>
            <label>Target author opsional<input name="targetAuthor" placeholder="@username atau catatan target" /></label>
            <label>Isi reply opsional<textarea name="body" placeholder="Kosongkan agar sistem generate dari produk" /></label>
            <button className="primary" type="submit">Buat reply draft</button>
          </form>
          <p className="status-note">Kalau kamu belum punya Thread ID dari API/source resmi, tombol Reply now live akan gagal. Ini batasan Threads API, bukan masalah UI.</p>
        </section>
        <section className="panel">
          <div className="card-header">
            <div>
              <h2>Opportunity Draft</h2>
              <p className="muted">Gunakan untuk mencari ide percakapan. Live reply tetap butuh targetThreadId.</p>
            </div>
            <button className="secondary" onClick={onFind} type="button">Cari post relevan</button>
          </div>
          {opportunities.length ? opportunities.slice(0, 3).map((item) => (
            <article className="mini-card" key={item.id}>
              <strong>{item.author}</strong>
              <p>{item.text}</p>
              <span className="muted">Thread ID: {item.targetThreadId || "tidak ada"}</span>
              <button className="ghost" onClick={() => onQueue(item.id)} type="button">Queue draft</button>
            </article>
          )) : <Empty label="Belum ada opportunity" />}
        </section>
      </div>
      <div className="grid two" style={{ marginTop: 14 }}>
        {replies.length ? replies.map((reply) => (
          <article className="card" key={reply.id}>
            <div className="card-header"><span className={`badge ${reply.status === "approved" ? "ok" : reply.status === "failed" ? "danger" : ""}`}>{reply.status}</span><span className="muted">{state.products.find((p) => p.id === reply.productId)?.name || "Produk"}</span></div>
            <p className="muted">Target: {reply.targetAuthor} - {reply.platform}</p>
            <p className="muted">Thread ID: {reply.targetThreadId || "belum tersedia"}</p>
            <p className="copy">{reply.body}</p>
            {reply.error ? <p className="muted">{reply.error}</p> : null}
            <div className="actions">
              <button className="primary" onClick={() => onReplyNow(reply.id)} type="button">Reply now</button>
              {reply.status === "draft" ? <button className="secondary" onClick={() => onApprove(reply.id)} type="button">Approve</button> : null}
              <button className="danger" onClick={() => onSkip(reply.id)} type="button">Skip</button>
            </div>
          </article>
        )) : <Empty label="Belum ada reply draft" />}
      </div>
    </>
  );
}

function Schedule({ state, onRun, onPostNow }) {
  const scheduled = state.drafts.filter((item) => ["scheduled", "posted", "failed"].includes(item.status));
  return (
    <>
      <section className="panel"><div className="card-header"><div><h2>Schedule</h2><p className="muted">Approved post otomatis dijadwalkan dengan jeda minimal 3 jam.</p></div><button className="primary" onClick={onRun} type="button">Run scheduler</button></div></section>
      <section className="panel" style={{ marginTop: 14 }}>{scheduled.length ? <ScheduleTable rows={scheduled} onPostNow={onPostNow} /> : <Empty label="Belum ada schedule" />}</section>
    </>
  );
}

function Monitoring({ state }) {
  return (
    <>
      <div className="grid metrics">
        <Metric label="Posted" value={state.drafts.filter((item) => item.status === "posted").length} />
        <Metric label="Approved replies" value={state.replies.filter((item) => item.status === "approved").length} />
        <Metric label="Tracked clicks" value={state.logs.filter((item) => item.type === "click").length} />
        <Metric label="Risk flags" value={state.opportunities.filter((item) => item.spamRisk > 55).length} />
      </div>
      <div className="grid two" style={{ marginTop: 14 }}>
        <section className="panel"><h2>Risk Monitor</h2><SimpleTable rows={[["Duplicate captions", duplicateCount(state.drafts.map((item) => item.caption))], ["High spam-risk opportunities", state.opportunities.filter((item) => item.spamRisk > 55).length], ["Blocked keywords", state.settings.blockedKeywords], ["Reply delay", `${state.settings.minReplyDelay}-${state.settings.maxReplyDelay} menit`]]} /></section>
        <section className="panel"><h2>Logs</h2><Logs logs={state.logs} /></section>
      </div>
    </>
  );
}

function Settings({ state, onSave }) {
  function save(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    onSave({ ...state.settings, ...data, dailyPostLimit: Number(data.dailyPostLimit), dailyReplyLimit: Number(data.dailyReplyLimit), minReplyDelay: Number(data.minReplyDelay), maxReplyDelay: Number(data.maxReplyDelay), autoReplySend: data.autoReplySend === "true" });
  }
  return (
    <section className="panel">
      <h2>Settings</h2>
      <form className="form" onSubmit={save}>
        <label>Daily post limit<input name="dailyPostLimit" type="number" min="1" max="10" defaultValue={state.settings.dailyPostLimit} /></label>
        <label>Daily reply limit<input name="dailyReplyLimit" type="number" min="1" max="30" defaultValue={state.settings.dailyReplyLimit} /></label>
        <label>Minimum reply delay menit<input name="minReplyDelay" type="number" min="1" defaultValue={state.settings.minReplyDelay} /></label>
        <label>Maximum reply delay menit<input name="maxReplyDelay" type="number" min="1" defaultValue={state.settings.maxReplyDelay} /></label>
        <label>Disclosure text<input name="disclosure" defaultValue={state.settings.disclosure} /></label>
        <label>Blocked keywords<textarea name="blockedKeywords" defaultValue={state.settings.blockedKeywords} /></label>
        <label>Threads mode<select name="threadsMode" defaultValue={state.settings.threadsMode}><option value="mock">mock</option><option value="api-ready">api-ready</option><option value="live">live</option></select></label>
        <label>Auto-send approved replies<select name="autoReplySend" defaultValue={String(state.settings.autoReplySend)}><option value="false">off</option><option value="true">on</option></select></label>
        <button className="primary" type="submit">Save settings</button>
      </form>
      <div className="status-note">Live mode butuh deployment/server Next.js, Threads OAuth connected, dan opportunity dengan targetThreadId.</div>
    </section>
  );
}

function ContentCard({ item, product, onApprove, onPostNow, onReject }) {
  return <article className="card"><div className="card-header"><span className="badge">{item.status}</span><span className="muted">{product?.name || "Produk"}</span></div><p className="copy">{item.caption}</p><div className="actions"><button className="primary" onClick={onPostNow} type="button">Post now</button><button className="secondary" onClick={onApprove} type="button">Approve</button><button className="danger" onClick={onReject} type="button">Reject</button></div></article>;
}

function OpportunityCard({ item, product, onReply, onReject }) {
  return <article className="card"><div className="card-header"><div><h3>{item.author}</h3><span className={`badge ${item.totalScore > 75 ? "ok" : item.spamRisk > 45 ? "danger" : "warn"}`}>score {item.totalScore}</span></div><span className="muted">{item.platform}</span></div><p className="copy">{item.text}</p><p><strong>Produk:</strong> {product?.name || "-"}</p><p className="muted">Target thread ID: {item.targetThreadId || "belum tersedia"}</p><p className="muted">{item.reason}</p><Scores item={item} /><div className="actions"><button className="primary" onClick={onReply} type="button">Queue reply</button><button className="ghost" onClick={onReject} type="button">Reject</button></div></article>;
}

function Scores({ item }) {
  return <div className="score-grid">{["relevance", "intent", "clickPotential", "freshness", "spamRisk"].map((key) => <div className="score" key={key}><span>{key}</span><strong>{item[key]}</strong></div>)}</div>;
}

function Metric({ label, value }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function Logs({ logs }) {
  if (!logs.length) return <Empty label="Belum ada log" />;
  return <table className="table"><tbody>{logs.slice(0, 18).map((log) => <tr key={log.id}><td><span className={`badge ${log.type === "error" ? "danger" : log.type === "success" ? "ok" : ""}`}>{log.type}</span></td><td>{log.message}<br /><span className="muted">{new Date(log.createdAt).toLocaleString("id-ID")}</span></td></tr>)}</tbody></table>;
}

function SimpleTable({ rows }) {
  return <table className="table"><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table>;
}

function ScheduleTable({ rows, onPostNow }) {
  return (
    <table className="table">
      <thead><tr><th>Status</th><th>Caption</th><th>Schedule</th><th>Result</th><th>Action</th></tr></thead>
      <tbody>
        {rows.map((item) => (
          <tr key={item.id}>
            <td><span className={`badge ${item.status === "posted" ? "ok" : item.status === "failed" ? "danger" : "warn"}`}>{item.status}</span></td>
            <td>{item.caption.slice(0, 120)}</td>
            <td>{item.scheduledAt || "-"}</td>
            <td>{item.platformPostId || item.error || "-"}</td>
            <td>{item.status !== "posted" ? <button className="secondary" onClick={() => onPostNow(item.id)} type="button">Post now</button> : "-"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Empty({ label }) {
  return <div className="empty"><strong>{label}</strong><span>Tambahkan produk atau generate data baru dari dashboard.</span></div>;
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function sampleProduct(name, category, price, audience, sellingPoints, keywords) {
  return { id: makeId("product"), status: "active", name, affiliateUrl: `https://shopee.co.id/sample-${makeId("affiliate")}`, category, price, audience, sellingPoints, keywords, createdAt: new Date().toISOString() };
}

function splitList(value = "") {
  return String(value).split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
}

function extractThreadId(value = "") {
  const text = String(value).trim();
  const numeric = text.match(/\d{8,}/);
  return numeric?.[0] || text;
}

function money(value) {
  return value ? `Rp${String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}` : "-";
}

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function productProfile(product) {
  const points = splitList(product.sellingPoints);
  const keywords = splitList(product.keywords).concat(product.category || "").filter(Boolean);
  return {
    problem: points[0] || `membantu kebutuhan ${product.category || "harian"}`,
    audience: product.audience || "pembeli Shopee",
    keywords,
    angles: [`Rekomendasi ${product.category || "produk"} dengan value jelas`],
  };
}

function generateCaptions(product, settings) {
  const profile = productProfile(product);
  const price = product.price ? ` Harga sekitar ${money(product.price)}.` : "";
  return [
    `Kalau kamu sering bermasalah dengan ${profile.problem}, ${product.name} ini layak dicek.${price}\n\n${product.affiliateUrl}\n${settings.disclosure}`,
    `Rekomendasi ${product.category || "produk"} buat ${profile.audience}: ${product.name}. Point plusnya: ${splitList(product.sellingPoints).slice(0, 3).join(", ") || "praktis dan gampang dipakai"}.\n\n${product.affiliateUrl}\n${settings.disclosure}`,
    `Aku simpan ini buat yang lagi cari ${profile.keywords[0] || product.name}. ${product.name} bisa jadi opsi yang value-nya masuk akal.${price}\n\n${product.affiliateUrl}\n${settings.disclosure}`,
    `Barang kecil yang efeknya kerasa: ${product.name}. Cocok untuk ${profile.audience}, apalagi kalau butuh ${profile.problem}.\n\n${product.affiliateUrl}\n${settings.disclosure}`,
    `${product.name} masuk wishlist rekomendasi hari ini. Angle terbaik: ${profile.angles[0]}.\n\nCek link: ${product.affiliateUrl}\n${settings.disclosure}`,
  ];
}

function scoreOpportunity(product, conversation, settings) {
  const text = conversation.text.toLowerCase();
  const keywords = productProfile(product).keywords.map((item) => item.toLowerCase());
  const blocked = splitList(settings.blockedKeywords).some((word) => text.includes(word.toLowerCase()));
  const intentWords = ["rekomendasi", "cari", "butuh", "harga", "pilih", "beli", "link"];
  const spamWords = ["spam", "klik cepat", "diskon besar semua", "gratis uang"];
  const relevance = Math.min(100, 35 + keywords.filter((word) => text.includes(word)).length * 25 + (text.includes((product.category || "").toLowerCase()) ? 20 : 0));
  const intent = Math.min(100, 25 + intentWords.filter((word) => text.includes(word)).length * 15);
  const freshness = Math.max(20, 100 - (conversation.ageMinutes || 20));
  const spamRisk = Math.min(100, (blocked ? 60 : 0) + spamWords.filter((word) => text.includes(word)).length * 30);
  const clickPotential = Math.max(0, Math.round((relevance * 0.45) + (intent * 0.4) + (freshness * 0.15) - (spamRisk * 0.35)));
  const totalScore = Math.max(0, Math.min(100, Math.round((relevance + intent + freshness + clickPotential - spamRisk) / 4)));
  return { relevance, intent, freshness, spamRisk, clickPotential, totalScore, reason: `Dipilih karena cocok dengan keyword ${keywords.slice(0, 3).join(", ") || product.name} dan ada intent tanya/cari.` };
}

function nextPostTime(drafts) {
  const scheduledToday = drafts.filter((item) => item.scheduledAt?.startsWith(todayKey())).map((item) => new Date(item.scheduledAt));
  const base = scheduledToday.length ? new Date(Math.max(...scheduledToday.map(Number))) : new Date();
  base.setHours(base.getHours() + 3, Math.floor(Math.random() * 30), 0, 0);
  return base;
}

function nextReplyTime(settings) {
  const minutes = Number(settings.minReplyDelay) + Math.floor(Math.random() * Math.max(1, Number(settings.maxReplyDelay) - Number(settings.minReplyDelay) + 1));
  const date = new Date();
  date.setMinutes(date.getMinutes() + minutes);
  return date;
}

function duplicateCount(values) {
  const seen = new Set();
  let count = 0;
  values.forEach((value) => {
    const key = String(value || "").trim().toLowerCase();
    if (!key) return;
    if (seen.has(key)) count += 1;
    seen.add(key);
  });
  return count;
}
