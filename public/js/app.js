// HelpMe! Frontend Main Application Controller

document.addEventListener('DOMContentLoaded', async () => {
  State.init();

  // Check if token exists, refresh user state
  if (State.user && API.getToken()) {
    try {
      const meRes = await API.getMe();
      State.setUser(meRes.user);
    } catch (e) {
      console.warn('Session expired, logging out.');
      State.setUser(null);
      API.setToken(null);
    }
  }

  setupNavigation();
  setupAuthModals();
  setupDrawer();
  setupChatHandlers();
  setupAdminTabs();

  // Listen to state changes
  State.on('userChanged', (user) => {
    updateNavUser(user);
    if (State.currentView === 'admin' && (!user || !['ADMIN', 'SUPER_ADMIN'].includes(user.role))) {
      navigateTo('landing');
    }
  });

  State.on('viewChanged', ({ viewName, params }) => {
    renderView(viewName, params);
  });

  // Initial view
  updateNavUser(State.user);
  navigateTo('landing');
});

// ROUTING & VIEW NAVIGATION
function closeMobileChatSidebar() {
  const sidebar = document.querySelector('.chat-sidebar');
  const backdrop = document.getElementById('chat-sidebar-backdrop');
  if (sidebar) sidebar.classList.remove('open');
  if (backdrop) backdrop.classList.remove('active');
}

function navigateTo(viewName, params = {}) {
  closeMobileChatSidebar();

  // Guard admin view
  if (viewName === 'admin') {
    if (!State.user || !['ADMIN', 'SUPER_ADMIN'].includes(State.user.role)) {
      Toast.show('Akses terlarang. Anda harus login sebagai Administrator.', 'error');
      openAuthModal('login');
      return;
    }
  }

  // Update navigation active states (desktop navbar)
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.toggle('active', link.dataset.view === viewName);
  });

  // Update navigation active states (mobile bottom nav)
  document.querySelectorAll('.mobile-nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === viewName);
  });

  // Toggle view sections
  document.querySelectorAll('.view-section').forEach(section => {
    section.classList.remove('active');
  });

  const activeSection = document.getElementById(`view-${viewName}`);
  if (activeSection) {
    activeSection.classList.add('active');
  }

  // Toggle body chat-mode class for viewport height lock
  document.body.classList.toggle('chat-mode', viewName === 'chat');

  // Scroll window to top when changing views
  if (viewName !== 'chat') {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  State.setView(viewName, params);
}

function setupNavigation() {
  document.querySelectorAll('[data-view]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const view = el.dataset.view;
      if (view === 'profile' && !State.user) {
        openAuthModal('login');
        return;
      }
      navigateTo(view);
    });
  });

  const brand = document.querySelector('.nav-brand');
  if (brand) {
    brand.addEventListener('click', () => navigateTo('landing'));
  }

  // Mobile Chat top header controls
  const mobileChatBack = document.getElementById('btn-chat-mobile-back');
  if (mobileChatBack) {
    mobileChatBack.addEventListener('click', () => navigateTo('landing'));
  }

  const toggleSidebarBtn = document.getElementById('btn-toggle-chat-sidebar');
  const chatSidebar = document.querySelector('.chat-sidebar');
  const chatBackdrop = document.getElementById('chat-sidebar-backdrop');

  if (toggleSidebarBtn && chatSidebar && chatBackdrop) {
    toggleSidebarBtn.addEventListener('click', () => {
      chatSidebar.classList.toggle('open');
      chatBackdrop.classList.toggle('active');
    });

    chatBackdrop.addEventListener('click', () => {
      closeMobileChatSidebar();
    });
  }
}

function updateNavUser(user) {
  const container = document.getElementById('nav-user-actions');
  const mobileUserLabel = document.getElementById('mobile-nav-user-label');
  if (mobileUserLabel) {
    mobileUserLabel.textContent = user ? (user.name.split(' ')[0] || 'Akun') : 'Masuk';
  }
  if (!container) return;

  if (user) {
    container.innerHTML = `
      ${['ADMIN', 'SUPER_ADMIN'].includes(user.role) ? `
        <button class="btn btn-secondary btn-sm" id="btn-nav-admin">
          ⚙️ Admin Panel
        </button>
      ` : ''}
      <button class="btn btn-secondary btn-sm" id="btn-nav-profile">
        👤 ${escapeHtml(user.name.split(' ')[0])} (${user.role})
      </button>
      <button class="btn btn-outline-danger btn-sm" id="btn-nav-logout">
        Keluar
      </button>
    `;

    const adminBtn = document.getElementById('btn-nav-admin');
    if (adminBtn) adminBtn.addEventListener('click', () => navigateTo('admin'));

    const profBtn = document.getElementById('btn-nav-profile');
    if (profBtn) profBtn.addEventListener('click', () => navigateTo('profile'));

    const logoutBtn = document.getElementById('btn-nav-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        State.setUser(null);
        API.setToken(null);
        Toast.show('Anda telah berhasil keluar.', 'info');
        navigateTo('landing');
      });
    }
  } else {
    container.innerHTML = `
      <button class="btn btn-secondary btn-sm" id="btn-nav-login">Masuk</button>
      <button class="btn btn-primary btn-sm" id="btn-nav-register">Daftar PMR</button>
    `;

    document.getElementById('btn-nav-login').addEventListener('click', () => openAuthModal('login'));
    document.getElementById('btn-nav-register').addEventListener('click', () => openAuthModal('register'));
  }
}

// RENDER VIEWS
async function renderView(viewName, params = {}) {
  switch (viewName) {
    case 'landing':
      loadLandingData();
      break;
    case 'chat':
      initChatView(params.initialQuery);
      break;
    case 'materials':
      loadMaterialsView();
      break;
    case 'material-detail':
      loadMaterialDetail(params.id);
      break;
    case 'sources':
      loadSourcesView();
      break;
    case 'profile':
      loadProfileView();
      break;
    case 'admin':
      loadAdminView();
      break;
  }
}

// ----------------------------------------------------
// 1. LANDING PAGE
// ----------------------------------------------------
async function loadLandingData() {
  const quickSearchInput = document.getElementById('quick-search-input');
  if (quickSearchInput) {
    quickSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && quickSearchInput.value.trim()) {
        const query = quickSearchInput.value.trim();
        navigateTo('chat', { initialQuery: query });
      }
    });
  }

  // Bind topic cards
  document.querySelectorAll('.topic-card').forEach(card => {
    card.addEventListener('click', () => {
      const query = card.dataset.query;
      if (query) {
        navigateTo('chat', { initialQuery: query });
      }
    });
  });
}

// ----------------------------------------------------
// 2. CHAT / TANYA HELPME!
// ----------------------------------------------------
let activeSessionId = null;

async function initChatView(initialQuery = null) {
  const sessionsListEl = document.getElementById('chat-sessions-list');
  const messagesContainer = document.getElementById('chat-messages');

  // Load chat sessions if user logged in
  if (State.user) {
    try {
      const res = await API.getChatSessions();
      State.sessions = res.sessions || [];
      renderSessionsList();

      if (State.sessions.length > 0 && !activeSessionId) {
        selectSession(State.sessions[0].id);
      } else if (!activeSessionId) {
        createNewSession(initialQuery || 'Percakapan Baru');
      }
    } catch (e) {
      console.warn('Failed to load sessions:', e);
    }
  } else {
    // Guest mode
    activeSessionId = 'guest';
    if (sessionsListEl) {
      sessionsListEl.innerHTML = `
        <div class="session-item active">
          <span class="session-title">Mode Tamu (Tanpa Akun)</span>
        </div>
      `;
    }
  }

  if (initialQuery) {
    const input = document.getElementById('chat-input');
    if (input) {
      input.value = initialQuery;
      submitChatMessage();
    }
  }
}

function renderSessionsList() {
  const container = document.getElementById('chat-sessions-list');
  if (!container) return;

  if (State.sessions.length === 0) {
    container.innerHTML = '<p style="color:var(--text-subtle);font-size:0.8rem;padding:0.5rem;">Belum ada riwayat percakapan.</p>';
    return;
  }

  container.innerHTML = State.sessions.map(s => `
    <div class="session-item ${s.id === activeSessionId ? 'active' : ''}" data-id="${s.id}">
      <span class="session-title">${escapeHtml(s.title || 'Percakapan')}</span>
      <button class="session-delete-btn" data-delete-id="${s.id}" title="Hapus">✕</button>
    </div>
  `).join('');

  container.querySelectorAll('.session-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('session-delete-btn')) return;
      selectSession(Number(el.dataset.id));
    });
  });

  container.querySelectorAll('.session-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.deleteId);
      if (confirm('Hapus sesi percakapan ini?')) {
        await API.deleteChatSession(id);
        State.sessions = State.sessions.filter(s => s.id !== id);
        if (activeSessionId === id) {
          activeSessionId = State.sessions[0]?.id || null;
        }
        renderSessionsList();
        if (activeSessionId) {
          selectSession(activeSessionId);
        } else {
          document.getElementById('chat-messages').innerHTML = '';
        }
      }
    });
  });
}

async function createNewSession(title = 'Percakapan Baru') {
  closeMobileChatSidebar();
  if (!State.user) {
    activeSessionId = 'guest';
    document.getElementById('chat-messages').innerHTML = '';
    return;
  }

  try {
    const res = await API.createChatSession(title);
    State.sessions.unshift(res.session);
    activeSessionId = res.session.id;
    renderSessionsList();
    document.getElementById('chat-messages').innerHTML = '';
  } catch (e) {
    Toast.show('Gagal membuat percakapan baru.', 'error');
  }
}

async function selectSession(sessionId) {
  closeMobileChatSidebar();
  activeSessionId = sessionId;
  renderSessionsList();

  const messagesContainer = document.getElementById('chat-messages');
  messagesContainer.innerHTML = '<div class="typing-indicator" style="margin:2rem auto;"><div class="typing-dot"></div><div class="typing-dot"></div></div>';

  try {
    const res = await API.getChatSession(sessionId);
    messagesContainer.innerHTML = '';

    if (res.messages.length === 0) {
      messagesContainer.innerHTML = `
        <div style="text-align:center;margin:auto;max-width:500px;color:var(--text-muted);">
          <div style="font-size:2.5rem;margin-bottom:0.75rem;">🩹</div>
          <h3 style="color:#FFF;margin-bottom:0.5rem;">HelpMe! Siap Membantu</h3>
          <p style="font-size:0.9rem;">Tanyakan seputar langkah pertolongan pertama, penilaian korban, balut bidai, resusitasi, atau penanganan luka PMR WIRA.</p>
        </div>
      `;
      return;
    }

    res.messages.forEach(msg => {
      appendChatMessage(msg.role, msg.content, {
        ai_response_id: msg.ai_response_id,
        sources: msg.sources_used,
        feedback: msg.feedback,
        model: msg.model
      });
    });
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  } catch (e) {
    messagesContainer.innerHTML = '<p style="color:#EF4444;text-align:center;">Gagal memuat pesan.</p>';
  }
}

function setupChatHandlers() {
  const newChatBtn = document.getElementById('btn-new-chat');
  if (newChatBtn) {
    newChatBtn.addEventListener('click', () => createNewSession());
  }

  const form = document.getElementById('chat-form');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submitChatMessage();
    });
  }

  // Prompt suggestion pills
  document.querySelectorAll('.prompt-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const input = document.getElementById('chat-input');
      if (input) {
        input.value = pill.textContent.trim();
        submitChatMessage();
      }
    });
  });
}

async function submitChatMessage() {
  const input = document.getElementById('chat-input');
  if (!input) return;

  const content = input.value.trim();
  if (!content) return;

  input.value = '';

  // Append user message immediately
  appendChatMessage('user', content);

  // Append typing indicator
  const messagesContainer = document.getElementById('chat-messages');
  const typingEl = document.createElement('div');
  typingEl.id = 'temp-typing-indicator';
  typingEl.className = 'chat-bubble assistant';
  typingEl.innerHTML = `
    <div class="chat-avatar">🚑</div>
    <div class="chat-content">
      <div class="typing-indicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    </div>
  `;
  messagesContainer.appendChild(typingEl);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  try {
    const currentId = activeSessionId || 'guest';
    const res = await API.sendMessage(currentId, content);

    // Remove typing indicator
    typingEl.remove();

    // Append AI Response
    appendChatMessage('assistant', res.answer, {
      ai_response_id: res.ai_response_id,
      sources: res.sources,
      retrieved_chunks: res.retrieved_chunks,
      confidence: res.confidence,
      model: res.model,
      is_emergency: res.is_emergency,
      safety_banner: res.safety_banner,
      has_conflict: res.has_conflict,
      conflict_message: res.conflict_message
    });

    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  } catch (err) {
    typingEl.remove();
    appendChatMessage('assistant', `### ⚠️ Maaf, terjadi gangguan\n${err.message || 'Gagal menghubungi server HelpMe!.'}`);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
}

function appendChatMessage(role, content, meta = {}) {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  // Clear welcome placeholder if present
  if (container.querySelector('h3') && container.querySelector('h3').textContent.includes('HelpMe! Siap Membantu')) {
    container.innerHTML = '';
  }

  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role}`;

  const avatar = role === 'user' ? '👤' : '🚑';

  let bannerHtml = '';
  if (meta.is_emergency && meta.safety_banner) {
    bannerHtml = `
      <div class="emergency-banner">
        <div class="emergency-banner-icon">⚠️</div>
        <div class="emergency-banner-content">
          <h4>KONDISI DARURAT TERDETEKSI</h4>
          <p>${escapeHtml(meta.safety_banner)}</p>
        </div>
      </div>
    `;
  }

  let conflictHtml = '';
  if (meta.has_conflict && meta.conflict_message) {
    conflictHtml = `
      <div class="conflict-banner">
        <span>⚖️</span>
        <div>${escapeHtml(meta.conflict_message)}</div>
      </div>
    `;
  }

  let citationHtml = '';
  if (meta.sources && meta.sources.length > 0) {
    const chips = meta.sources.map(s => {
      const isPrimary = s.authority === 'PRIMARY';
      const badgeClass = isPrimary ? 'badge-primary' : 'badge-supplementary';
      const label = `${s.source_title} • Hal. ${s.page_number || '?'}`;
      return `
        <span class="citation-chip" data-chunk-id="${s.chunk_id || ''}" data-source-title="${escapeHtml(s.source_title)}" data-page="${s.page_number || ''}" data-chapter="${escapeHtml(s.chapter || '')}">
          <span class="badge ${badgeClass}" style="font-size:0.65rem;">${isPrimary ? 'PMI' : 'SJA'}</span>
          ${escapeHtml(label)}
        </span>
      `;
    }).join('');

    citationHtml = `
      <div class="source-citations">
        <span class="source-citations-title">📚 Rujukan Terverifikasi:</span>
        <div class="citation-chips">${chips}</div>
      </div>
    `;
  }

  let actionsHtml = '';
  if (role === 'assistant' && meta.ai_response_id) {
    actionsHtml = `
      <div class="chat-actions">
        <div class="feedback-group">
          <span>Apakah jawaban ini membantu?</span>
          <button class="feedback-btn ${meta.feedback === 'HELPFUL' ? 'active-helpful' : ''}" data-action="helpful" data-response-id="${meta.ai_response_id}">👍 Ya</button>
          <button class="feedback-btn ${meta.feedback === 'UNHELPFUL' ? 'active-unhelpful' : ''}" data-action="unhelpful" data-response-id="${meta.ai_response_id}">👎 Kurang</button>
        </div>
        <div style="display:flex;gap:0.5rem;align-items:center;">
          <button class="feedback-btn" data-action="copy" title="Salin Jawaban">📋 Salin</button>
          <button class="feedback-btn" data-action="trace" data-response-id="${meta.ai_response_id}" title="Lacak Potongan Sumber">🔍 Traceability</button>
        </div>
      </div>
    `;
  }

  let modelBadgeHtml = '';
  if (role === 'assistant') {
    const displayModel = formatModelName(meta.model);
    modelBadgeHtml = `
      <div class="ai-model-tag">
        <span class="ai-pulse-dot"></span>
        <span class="ai-model-name">⚡ <strong>${escapeHtml(displayModel)}</strong></span>
        <span class="ai-model-divider">•</span>
        <span class="ai-model-grounding">Terhubung Basis Pengetahuan PMR WIRA</span>
      </div>
    `;
  }

  bubble.innerHTML = `
    <div class="chat-avatar">${avatar}</div>
    <div class="chat-content">
      ${modelBadgeHtml}
      ${bannerHtml}
      ${conflictHtml}
      <div class="markdown-body">${formatMarkdown(content)}</div>
      ${citationHtml}
      ${actionsHtml}
    </div>
  `;

  // Attach chip click listeners to open source drawer
  bubble.querySelectorAll('.citation-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      openSourceDrawer({
        title: chip.dataset.sourceTitle,
        chapter: chip.dataset.chapter,
        page: chip.dataset.page,
        chunkId: chip.dataset.chunkId
      });
    });
  });

  // Attach feedback and action buttons
  bubble.querySelectorAll('.feedback-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.action;
      const respId = btn.dataset.responseId;

      if (action === 'copy') {
        navigator.clipboard.writeText(content);
        Toast.show('Jawaban berhasil disalin ke clipboard!', 'success');
      } else if (action === 'trace') {
        openTraceDrawer(respId);
      } else if (action === 'helpful') {
        await API.sendFeedback(respId, 'HELPFUL', null);
        btn.classList.add('active-helpful');
        btn.parentElement.querySelector('[data-action="unhelpful"]').classList.remove('active-unhelpful');
        Toast.show('Terima kasih atas penilaian positif Anda!', 'success');
      } else if (action === 'unhelpful') {
        openFeedbackModal(respId);
      }
    });
  });

  container.appendChild(bubble);
}

// ----------------------------------------------------
// 3. ENSIKLOPEDIA MATERI (MATERIALS)
// ----------------------------------------------------
async function loadMaterialsView() {
  const container = document.getElementById('materials-grid');
  const catFilter = document.getElementById('category-filter');
  const searchInput = document.getElementById('material-search');

  if (!container) return;
  container.innerHTML = '<div class="typing-indicator" style="grid-column: 1/-1; margin: 3rem auto;"><div class="typing-dot"></div><div class="typing-dot"></div></div>';

  try {
    const res = await API.getMaterials();
    const materials = res.materials || [];
    const categories = res.categories || [];

    // Populate category dropdown
    if (catFilter) {
      catFilter.innerHTML = '<option value="">Semua Kategori</option>' + categories.map(c => `
        <option value="${c.id}">${escapeHtml(c.name)}</option>
      `).join('');
    }

    renderMaterialsList(materials);

    // Search and filter listeners
    const triggerFilter = async () => {
      const catVal = catFilter ? catFilter.value : '';
      const qVal = searchInput ? searchInput.value.trim() : '';
      const filtered = await API.getMaterials({ category_id: catVal, q: qVal });
      renderMaterialsList(filtered.materials);
    };

    if (catFilter) catFilter.onchange = triggerFilter;
    if (searchInput) {
      let debounce;
      searchInput.oninput = () => {
        clearTimeout(debounce);
        debounce = setTimeout(triggerFilter, 300);
      };
    }
  } catch (e) {
    container.innerHTML = '<p style="color:#EF4444;text-align:center;grid-column:1/-1;">Gagal memuat materi.</p>';
  }
}

function renderMaterialsList(materials) {
  const container = document.getElementById('materials-grid');
  if (!container) return;

  if (materials.length === 0) {
    container.innerHTML = '<p style="color:var(--text-subtle);grid-column:1/-1;text-align:center;padding:3rem;">Tidak ada materi yang sesuai.</p>';
    return;
  }

  container.innerHTML = materials.map(m => `
    <div class="topic-card" data-material-id="${m.id}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.75rem;">
        <span class="badge badge-primary">${escapeHtml(m.category_name || 'Umum')}</span>
        <span class="badge badge-draft" style="font-size:0.7rem;">v${escapeHtml(m.current_version || '1.0')}</span>
      </div>
      <h3 class="topic-title">${escapeHtml(m.title)}</h3>
      <p class="topic-desc">${escapeHtml(m.summary || 'Panduan pertolongan pertama terverifikasi PMR WIRA.')}</p>
      <div class="topic-meta">
        <span>📖 Bab Resmi PMI Wira</span>
        <span style="color:#FDA4AF;font-weight:600;">Buka Materi →</span>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.topic-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.materialId;
      navigateTo('material-detail', { id });
    });
  });
}

// ----------------------------------------------------
// 4. DETAIL MATERI & VERSION HISTORY
// ----------------------------------------------------
async function loadMaterialDetail(id) {
  const container = document.getElementById('material-detail-content');
  if (!container) return;

  container.innerHTML = '<div class="typing-indicator" style="margin: 3rem auto;"><div class="typing-dot"></div><div class="typing-dot"></div></div>';

  try {
    const res = await API.getMaterialDetail(id);
    const m = res.material;
    const versions = res.versions || [];

    const versionsHtml = versions.map(v => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem;border-bottom:1px solid var(--border-subtle);font-size:0.85rem;">
        <div>
          <span class="badge badge-draft">v${escapeHtml(v.version)}</span>
          <span style="margin-left:0.5rem;font-weight:600;">${escapeHtml(v.change_reason || 'Pembaruan materi')}</span>
          <div style="color:var(--text-subtle);font-size:0.75rem;margin-top:0.2rem;">Oleh: ${escapeHtml(v.created_by_name || 'Admin')} • ${v.created_at}</div>
        </div>
        <div>
          <span class="badge ${v.status === 'ACTIVE' ? 'badge-active' : 'badge-draft'}">${v.status}</span>
        </div>
      </div>
    `).join('');

    container.innerHTML = `
      <div style="max-width:900px;margin:0 auto;padding:2rem 1.5rem;">
        <button class="btn btn-secondary btn-sm" id="btn-back-materials" style="margin-bottom:1.5rem;">← Kembali ke Ensiklopedia</button>
        
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;margin-bottom:1.25rem;">
          <div>
            <span class="badge badge-primary">${escapeHtml(m.category_name || 'Umum')}</span>
            <span class="badge badge-active" style="margin-left:0.5rem;">Versi Aktif: v${escapeHtml(m.current_version || '1.0')}</span>
          </div>
          ${['ADMIN', 'SUPER_ADMIN'].includes(State.user?.role) ? `
            <div style="display:flex;gap:0.5rem;">
              <button class="btn btn-secondary btn-sm" id="btn-edit-mat" data-id="${m.id}">✏️ Edit Materi</button>
              <button class="btn btn-outline-danger btn-sm" id="btn-rollback-mat" data-id="${m.id}">⏮️ Rollback Versi</button>
            </div>
          ` : ''}
        </div>

        <h1 style="font-size:2.4rem;font-weight:800;color:#FFF;margin-bottom:1rem;">${escapeHtml(m.title)}</h1>
        <p style="font-size:1.1rem;color:var(--text-muted);margin-bottom:2rem;line-height:1.6;border-left:3px solid var(--pmi-primary);padding-left:1rem;">
          ${escapeHtml(m.summary || '')}
        </p>

        <div class="markdown-body" style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);padding:2rem;margin-bottom:3rem;line-height:1.8;">
          ${formatMarkdown(m.content)}
        </div>

        <div style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);padding:1.5rem;">
          <h3 style="font-size:1.1rem;color:#FFF;margin-bottom:1rem;">📜 Riwayat Versi & Audit Perubahan</h3>
          <div style="display:flex;flex-direction:column;">
            ${versionsHtml}
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-back-materials').addEventListener('click', () => navigateTo('materials'));

    const editBtn = document.getElementById('btn-edit-mat');
    if (editBtn) {
      editBtn.addEventListener('click', () => openEditMaterialModal(m));
    }

    const rollbackBtn = document.getElementById('btn-rollback-mat');
    if (rollbackBtn) {
      rollbackBtn.addEventListener('click', () => openRollbackModal(m, versions));
    }
  } catch (e) {
    container.innerHTML = '<p style="color:#EF4444;text-align:center;">Gagal memuat rincian materi.</p>';
  }
}

// ----------------------------------------------------
// 5. SUMBER & PEDOMAN (SOURCES)
// ----------------------------------------------------
async function loadSourcesView() {
  const container = document.getElementById('sources-list-container');
  if (!container) return;

  container.innerHTML = '<div class="typing-indicator" style="margin: 3rem auto;"><div class="typing-dot"></div><div class="typing-dot"></div></div>';

  try {
    const res = await API.getSources();
    const sources = res.sources || [];

    container.innerHTML = sources.map(s => {
      const isPrimary = s.authority === 'PRIMARY';
      return `
        <div class="topic-card" style="margin-bottom:1.5rem;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.75rem;">
            <div>
              <span class="badge ${isPrimary ? 'badge-primary' : 'badge-supplementary'}">
                ${isPrimary ? '👑 Otoritas Utama (Primary)' : '🌐 Rujukan Pelengkap (Supplementary)'}
              </span>
              <span class="badge badge-active" style="margin-left:0.5rem;">Versi Aktif: v${escapeHtml(s.active_version || '1.0')}</span>
            </div>
            <span style="font-size:0.8rem;color:var(--text-subtle);">Tahun: ${s.active_year || '-'}</span>
          </div>

          <h3 style="font-size:1.4rem;font-weight:700;color:#FFF;margin-bottom:0.4rem;">${escapeHtml(s.title)}</h3>
          <p style="font-size:0.9rem;color:var(--text-muted);margin-bottom:1rem;">${escapeHtml(s.description || '')}</p>

          <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:0.75rem;background:rgba(0,0,0,0.2);padding:1rem;border-radius:var(--radius-md);margin-bottom:1rem;font-size:0.85rem;">
            <div><strong>Organisasi:</strong> <span style="color:var(--text-muted);">${escapeHtml(s.organization)}</span></div>
            <div><strong>Penyusun/Penulis:</strong> <span style="color:var(--text-muted);">${escapeHtml(s.author || '-')}</span></div>
            <div><strong>Negara:</strong> <span style="color:var(--text-muted);">${escapeHtml(s.country)}</span></div>
            <div><strong>Bahasa:</strong> <span style="color:var(--text-muted);">${escapeHtml(s.language)}</span></div>
          </div>

          <div style="display:flex;justify-content:flex-end;">
            <button class="btn btn-secondary btn-sm" onclick="openSourceVersionsModal(${s.id})">
              📜 Lihat Semua Versi (${s.version_count})
            </button>
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    container.innerHTML = '<p style="color:#EF4444;text-align:center;">Gagal memuat daftar sumber.</p>';
  }
}

// ----------------------------------------------------
// 6. PROFIL PENGGUNA
// ----------------------------------------------------
async function loadProfileView() {
  if (!State.user) {
    navigateTo('landing');
    return;
  }

  const u = State.user;
  document.getElementById('profile-name-display').textContent = u.name;
  document.getElementById('profile-role-display').textContent = `${u.role} • PMR ${u.pmr_level}`;
  document.getElementById('profile-email-display').textContent = u.email;

  document.getElementById('input-profile-name').value = u.name;
  document.getElementById('input-profile-email').value = u.email;

  const form = document.getElementById('profile-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const name = document.getElementById('input-profile-name').value;
    const email = document.getElementById('input-profile-email').value;
    const curPass = document.getElementById('input-profile-curpass').value;
    const newPass = document.getElementById('input-profile-newpass').value;

    try {
      const res = await API.updateProfile({
        name,
        email,
        current_password: curPass || undefined,
        new_password: newPass || undefined
      });
      State.setUser(res.user);
      Toast.show('Profil Anda berhasil diperbarui!', 'success');
      document.getElementById('input-profile-curpass').value = '';
      document.getElementById('input-profile-newpass').value = '';
    } catch (err) {
      Toast.show(err.message, 'error');
    }
  };
}

// ----------------------------------------------------
// 7. ADMIN DASHBOARD & CONTROLS
// ----------------------------------------------------
function setupAdminTabs() {
  document.querySelectorAll('.admin-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.admin-tab-content').forEach(c => c.style.display = 'none');

      btn.classList.add('active');
      const targetTab = btn.dataset.tab;
      const content = document.getElementById(`admin-tab-${targetTab}`);
      if (content) content.style.display = 'block';

      loadAdminTabContent(targetTab);
    });
  });
}

async function loadAdminView() {
  // Load Overview by default
  loadAdminTabContent('overview');
}

async function loadAdminTabContent(tab) {
  switch (tab) {
    case 'overview':
      loadAdminOverview();
      break;
    case 'materials':
      loadAdminMaterials();
      break;
    case 'sources':
      loadAdminSources();
      break;
    case 'upload':
      initAdminUpload();
      break;
    case 'review':
      loadAdminReviewCenter();
      break;
    case 'diff':
      initAdminDiffViewer();
      break;
    case 'users':
      loadAdminUsers();
      break;
    case 'ailogs':
      loadAdminAiLogs();
      break;
    case 'audit':
      loadAdminAuditLogs();
      break;
    case 'settings':
      loadAdminSettings();
      break;
  }
}

async function loadAdminOverview() {
  const statsContainer = document.getElementById('admin-stats-grid');
  const changesContainer = document.getElementById('admin-recent-changes');

  if (!statsContainer) return;

  try {
    const res = await API.getAdminDashboard();
    const s = res.stats;

    statsContainer.innerHTML = `
      <div class="stat-card">
        <span class="stat-val">${s.totalUsers}</span>
        <span class="stat-label">Total Pengguna</span>
      </div>
      <div class="stat-card">
        <span class="stat-val" style="color:#FDA4AF;">${s.totalMaterials}</span>
        <span class="stat-label">Materi Terbit</span>
      </div>
      <div class="stat-card">
        <span class="stat-val" style="color:#38BDF8;">${s.totalChunks}</span>
        <span class="stat-label">Knowledge Chunks</span>
      </div>
      <div class="stat-card">
        <span class="stat-val" style="color:#34D399;">${s.activeSources}</span>
        <span class="stat-label">Sumber Aktif</span>
      </div>
      <div class="stat-card">
        <span class="stat-val" style="color:#FBBF24;">${s.pendingReviews}</span>
        <span class="stat-label">Pending Review</span>
      </div>
      <div class="stat-card">
        <span class="stat-val" style="color:#A855F7;">${s.totalAiQuestions}</span>
        <span class="stat-label">Pertanyaan AI</span>
      </div>
    `;

    if (changesContainer) {
      changesContainer.innerHTML = (res.recentChanges || []).map(c => `
        <div style="display:flex;justify-content:space-between;padding:0.75rem 0;border-bottom:1px solid var(--border-subtle);font-size:0.85rem;">
          <div>
            <span class="audit-chip">${escapeHtml(c.action)}</span>
            <span style="margin-left:0.5rem;font-weight:600;">${escapeHtml(c.reason || 'Perubahan data')}</span>
            <div style="font-size:0.75rem;color:var(--text-subtle);margin-top:0.2rem;">Oleh: ${escapeHtml(c.user_name || 'Sistem')} (${c.user_role || '-'})</div>
          </div>
          <span style="font-size:0.75rem;color:var(--text-subtle);">${c.created_at}</span>
        </div>
      `).join('');
    }
  } catch (e) {
    statsContainer.innerHTML = '<p style="color:#EF4444;">Gagal memuat ringkasan admin.</p>';
  }
}

async function loadAdminMaterials() {
  const container = document.getElementById('admin-materials-table-body');
  if (!container) return;

  try {
    const res = await API.getMaterials();
    container.innerHTML = (res.materials || []).map(m => `
      <tr>
        <td>#${m.id}</td>
        <td><strong>${escapeHtml(m.title)}</strong></td>
        <td><span class="badge badge-primary">${escapeHtml(m.category_name || '-')}</span></td>
        <td><span class="badge badge-draft">v${escapeHtml(m.current_version || '1.0')}</span></td>
        <td><span class="badge ${m.status === 'ACTIVE' ? 'badge-active' : 'badge-draft'}">${m.status}</span></td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="editMaterialFromAdmin(${m.id})">Edit</button>
          <button class="btn btn-outline-danger btn-sm" onclick="rollbackMaterialFromAdmin(${m.id})">Rollback</button>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    container.innerHTML = '<tr><td colspan="6" style="color:#EF4444;text-align:center;">Gagal memuat materi.</td></tr>';
  }
}

async function loadAdminSources() {
  const container = document.getElementById('admin-sources-table-body');
  if (!container) return;

  try {
    const res = await API.getSources();
    container.innerHTML = (res.sources || []).map(s => `
      <tr>
        <td>#${s.id}</td>
        <td><strong>${escapeHtml(s.title)}</strong></td>
        <td>${escapeHtml(s.organization)}</td>
        <td><span class="badge ${s.authority === 'PRIMARY' ? 'badge-primary' : 'badge-supplementary'}">${s.authority}</span></td>
        <td>v${escapeHtml(s.active_version || '1.0')} (${s.active_year || '-'})</td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="openSourceVersionsModal(${s.id})">Kelola Versi (${s.version_count})</button>
          <button class="btn btn-secondary btn-sm" onclick="openCreateVersionModal(${s.id})">+ Versi Baru</button>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    container.innerHTML = '<tr><td colspan="6" style="color:#EF4444;text-align:center;">Gagal memuat sumber.</td></tr>';
  }
}

function initAdminUpload() {
  const form = document.getElementById('admin-upload-form');
  if (!form) return;

  // Populate source dropdown
  API.getSources().then(res => {
    const select = document.getElementById('upload-source-select');
    if (select) {
      select.innerHTML = (res.sources || []).map(s => `
        <option value="${s.id}">${escapeHtml(s.title)} (${escapeHtml(s.organization)})</option>
      `).join('');
    }
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    const fileInput = document.getElementById('upload-file-input');
    if (!fileInput.files[0]) {
      Toast.show('Pilih file dokumen terlebih dahulu.', 'error');
      return;
    }

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    formData.append('source_id', document.getElementById('upload-source-select').value);
    formData.append('version', document.getElementById('upload-version-input').value);
    formData.append('edition', document.getElementById('upload-edition-input').value);
    formData.append('chapter_name', document.getElementById('upload-chapter-input').value);

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Mengunggah & Mengekstrak...';

    try {
      const res = await API.uploadDocument(formData);
      Toast.show(res.message, 'success');
      form.reset();
      loadAdminOverview();
    } catch (err) {
      Toast.show(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Mulai Upload & Indexing';
    }
  };
}

async function loadAdminReviewCenter() {
  const versionsContainer = document.getElementById('review-versions-list');
  const flaggedContainer = document.getElementById('review-flagged-list');

  if (!versionsContainer) return;

  try {
    const res = await API.getReviewCenter();
    const vList = res.pendingSourceVersions || [];
    const fList = res.flaggedResponses || [];

    if (vList.length === 0) {
      versionsContainer.innerHTML = '<p style="color:var(--text-subtle);font-size:0.85rem;padding:1rem;">Tidak ada dokumen / versi yang menunggu review.</p>';
    } else {
      versionsContainer.innerHTML = vList.map(v => `
        <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border-subtle);padding:1rem;border-radius:var(--radius-md);margin-bottom:0.75rem;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <strong>${escapeHtml(v.source_title)} — Versi ${escapeHtml(v.version)}</strong>
            <p style="font-size:0.8rem;color:var(--text-muted);margin:0.25rem 0;">${escapeHtml(v.change_summary || '')}</p>
            <span style="font-size:0.75rem;color:var(--text-subtle);">Pengunggah: ${escapeHtml(v.uploader_name || 'Admin')}</span>
          </div>
          <div style="display:flex;gap:0.5rem;">
            <button class="btn btn-primary btn-sm" onclick="processReviewAction('source_version', ${v.id}, 'APPROVE')">Setujui & Aktifkan</button>
            <button class="btn btn-outline-danger btn-sm" onclick="processReviewAction('source_version', ${v.id}, 'REJECT')">Tolak</button>
          </div>
        </div>
      `).join('');
    }

    if (flaggedContainer) {
      if (fList.length === 0) {
        flaggedContainer.innerHTML = '<p style="color:var(--text-subtle);font-size:0.85rem;padding:1rem;">Tidak ada jawaban AI yang ditandai atau mendapat feedback negatif.</p>';
      } else {
        flaggedContainer.innerHTML = fList.map(f => `
          <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border-subtle);padding:1rem;border-radius:var(--radius-md);margin-bottom:0.75rem;">
            <div style="display:flex;justify-content:space-between;margin-bottom:0.4rem;">
              <strong style="color:#FDA4AF;">Pertanyaan: "${escapeHtml(f.question)}"</strong>
              <span class="badge ${f.feedback === 'UNHELPFUL' ? 'badge-primary' : 'badge-draft'}">${f.feedback || 'FLAGGED'}</span>
            </div>
            <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.5rem;">Catatan: ${escapeHtml(f.feedback_reason || f.flag_notes || 'Memerlukan pengecekan akurasi rujukan')}</p>
            <button class="btn btn-secondary btn-sm" onclick="openTraceDrawer(${f.id})">🔍 Periksa Chunks</button>
          </div>
        `).join('');
      }
    }
  } catch (e) {
    versionsContainer.innerHTML = '<p style="color:#EF4444;">Gagal memuat review center.</p>';
  }
}

async function processReviewAction(type, id, action) {
  const reason = prompt(`Masukkan catatan untuk tindakan ${action}:`);
  try {
    const res = await API.processReview(type, id, action, reason);
    Toast.show(res.message, 'success');
    loadAdminReviewCenter();
  } catch (e) {
    Toast.show(e.message, 'error');
  }
}

function initAdminDiffViewer() {
  const btn = document.getElementById('btn-run-diff');
  if (!btn) return;

  btn.onclick = async () => {
    const v1Id = document.getElementById('diff-v1-input').value.trim();
    const v2Id = document.getElementById('diff-v2-input').value.trim();
    const type = document.getElementById('diff-type-select').value;

    if (!v1Id || !v2Id) {
      Toast.show('Masukkan dua ID versi yang ingin dibandingkan.', 'error');
      return;
    }

    try {
      const res = await API.compareVersions(v1Id, v2Id, type);
      const diffContainer = document.getElementById('diff-results-container');
      const d = res.diff;

      let linesHtml = '';
      d.removed.forEach(l => {
        linesHtml += `<div class="diff-line removed">- ${escapeHtml(l)}</div>`;
      });
      d.added.forEach(l => {
        linesHtml += `<div class="diff-line added">+ ${escapeHtml(l)}</div>`;
      });

      diffContainer.innerHTML = `
        <div style="display:flex;gap:1rem;margin-bottom:1rem;font-size:0.85rem;">
          <span style="color:#34D399;">+ ${d.total_added} Baris Ditambahkan</span>
          <span style="color:#F87171;">- ${d.total_removed} Baris Dihapus / Diubah</span>
        </div>
        <div class="diff-container">${linesHtml || '<div style="color:var(--text-subtle);padding:1rem;">Tidak ada perbedaan teks yang signifikan antar versi.</div>'}</div>
      `;
    } catch (err) {
      Toast.show(err.message, 'error');
    }
  };
}

async function loadAdminUsers() {
  const container = document.getElementById('admin-users-table-body');
  if (!container) return;

  try {
    const res = await API.getAdminUsers();
    container.innerHTML = (res.users || []).map(u => `
      <tr>
        <td>#${u.id}</td>
        <td><strong>${escapeHtml(u.name)}</strong></td>
        <td>${escapeHtml(u.username)}</td>
        <td>${escapeHtml(u.email)}</td>
        <td>
          <select class="form-control" style="padding:0.2rem 0.5rem;width:auto;" onchange="changeUserRole(${u.id}, this.value)" ${State.user.role !== 'SUPER_ADMIN' ? 'disabled' : ''}>
            <option value="USER" ${u.role === 'USER' ? 'selected' : ''}>USER (PMR Wira)</option>
            <option value="ADMIN" ${u.role === 'ADMIN' ? 'selected' : ''}>ADMIN (Pembina)</option>
            <option value="SUPER_ADMIN" ${u.role === 'SUPER_ADMIN' ? 'selected' : ''}>SUPER_ADMIN</option>
          </select>
        </td>
        <td><span class="badge ${u.status === 'ACTIVE' ? 'badge-active' : 'badge-primary'}">${u.status}</span></td>
      </tr>
    `).join('');
  } catch (e) {
    container.innerHTML = '<tr><td colspan="6" style="color:#EF4444;text-align:center;">Gagal memuat pengguna.</td></tr>';
  }
}

async function changeUserRole(userId, role) {
  try {
    const res = await API.updateUserRole(userId, role);
    Toast.show(res.message, 'success');
  } catch (err) {
    Toast.show(err.message, 'error');
  }
}

async function loadAdminAiLogs() {
  const container = document.getElementById('admin-ailogs-table-body');
  if (!container) return;

  try {
    const res = await API.getAiLogs();
    container.innerHTML = (res.logs || []).map(l => `
      <tr>
        <td>#${l.id}</td>
        <td><strong>${escapeHtml(l.question || '-')}</strong></td>
        <td>${(l.confidence * 100).toFixed(0)}%</td>
        <td>
          <span class="badge ${l.feedback === 'HELPFUL' ? 'badge-active' : (l.feedback === 'UNHELPFUL' ? 'badge-primary' : 'badge-draft')}">
            ${l.feedback || 'None'}
          </span>
        </td>
        <td>${l.is_flagged ? '🚩 Flagged' : '✓ Normal'}</td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="openTraceDrawer(${l.id})">🔍 Trace</button>
          <button class="btn btn-outline-danger btn-sm" onclick="toggleFlagAiLog(${l.id}, ${l.is_flagged ? 0 : 1})">
            ${l.is_flagged ? 'Unflag' : '🚩 Flag'}
          </button>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    container.innerHTML = '<tr><td colspan="6" style="color:#EF4444;text-align:center;">Gagal memuat log AI.</td></tr>';
  }
}

async function toggleFlagAiLog(id, state) {
  const notes = state ? prompt('Masukkan alasan menandai respon AI ini:') : '';
  try {
    const res = await API.flagAiResponse(id, state, notes);
    Toast.show(res.message, 'success');
    loadAdminAiLogs();
  } catch (e) {
    Toast.show(e.message, 'error');
  }
}

async function loadAdminAuditLogs() {
  const container = document.getElementById('admin-audit-table-body');
  if (!container) return;

  try {
    const res = await API.getAuditLogs();
    container.innerHTML = (res.logs || []).map(a => `
      <tr>
        <td>#${a.id}</td>
        <td><span class="audit-chip">${escapeHtml(a.action)}</span></td>
        <td>${escapeHtml(a.entity_type)} #${a.entity_id || '-'}</td>
        <td><strong>${escapeHtml(a.user_name || 'System')}</strong></td>
        <td>${escapeHtml(a.reason || '-')}</td>
        <td style="font-size:0.75rem;color:var(--text-subtle);">${a.created_at}</td>
      </tr>
    `).join('');
  } catch (e) {
    container.innerHTML = '<tr><td colspan="6" style="color:#EF4444;text-align:center;">Gagal memuat log audit.</td></tr>';
  }
}

async function loadAdminSettings() {
  const form = document.getElementById('admin-settings-form');
  if (!form) return;

  try {
    const res = await API.getSettings();
    const s = res.settings || {};

    document.getElementById('setting-ai-model').value = s.ai_model || 'gemini-3.8-flash';
    document.getElementById('setting-strict-rag').value = s.strict_rag_grounding || 'true';
    document.getElementById('setting-pmi-priority').value = s.pmi_wira_priority || 'HIGHEST';
    document.getElementById('setting-safety-banner').value = s.safety_alert_banner || 'true';

    form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const payload = {
          ai_model: document.getElementById('setting-ai-model').value,
          strict_rag_grounding: document.getElementById('setting-strict-rag').value,
          pmi_wira_priority: document.getElementById('setting-pmi-priority').value,
          safety_alert_banner: document.getElementById('setting-safety-banner').value
        };
        const updateRes = await API.updateSettings(payload);
        Toast.show(updateRes.message, 'success');
      } catch (err) {
        Toast.show(err.message, 'error');
      }
    };
  } catch (e) {
    console.error('Settings load error:', e);
  }
}

// ----------------------------------------------------
// 8. DRAWER & MODAL HELPERS
// ----------------------------------------------------
function setupDrawer() {
  const drawer = document.getElementById('source-drawer');
  const closeBtn = document.getElementById('drawer-close-btn');
  if (closeBtn && drawer) {
    closeBtn.addEventListener('click', () => drawer.classList.remove('open'));
  }
}

function openSourceDrawer({ title, chapter, page, chunkId }) {
  const drawer = document.getElementById('source-drawer');
  const titleEl = document.getElementById('drawer-title');
  const bodyEl = document.getElementById('drawer-body');

  titleEl.textContent = `${title} (Hal. ${page || '?'})`;
  bodyEl.innerHTML = `
    <div style="margin-bottom:1rem;">
      <span class="badge badge-primary">Rujukan Terverifikasi PMI</span>
      <h3 style="font-size:1.2rem;color:#FFF;margin:0.5rem 0;">${escapeHtml(chapter)}</h3>
      <p style="color:var(--text-muted);font-size:0.85rem;">Halaman fisik buku cetak: <strong>${page || '-'}</strong></p>
    </div>
    <div style="background:rgba(0,0,0,0.3);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:1.25rem;font-size:0.9rem;line-height:1.7;color:#E2E8F0;">
      <p>Kutipan resmi dari buku <em>"${escapeHtml(title)}"</em>:</p>
      <hr style="border:0;border-top:1px dashed var(--border-subtle);margin:0.75rem 0;">
      <p>Materi pada bagian ini merupakan rujukan standar kurikulum PMR Tingkat Wira yang disusun oleh Palang Merah Indonesia Pusat untuk penanganan medis dasar dan penilaian korban di lapangan.</p>
    </div>
  `;
  drawer.classList.add('open');
}

async function openTraceDrawer(responseId) {
  const drawer = document.getElementById('source-drawer');
  const titleEl = document.getElementById('drawer-title');
  const bodyEl = document.getElementById('drawer-body');

  titleEl.textContent = `Traceability Respon AI #${responseId}`;
  bodyEl.innerHTML = '<div class="typing-indicator" style="margin:2rem auto;"><div class="typing-dot"></div><div class="typing-dot"></div></div>';
  drawer.classList.add('open');

  try {
    const res = await API.getTrace(responseId);
    const chunks = res.chunks || [];

    bodyEl.innerHTML = `
      <div style="margin-bottom:1.25rem;font-size:0.85rem;">
        <div><strong>Model AI:</strong> <span class="badge badge-primary">${escapeHtml(formatModelName(res.model))}</span> <span style="font-size:0.75rem;color:var(--text-subtle);">(${escapeHtml(res.model)})</span></div>
        <div style="margin-top:0.25rem;"><strong>Skor Keyakinan:</strong> ${(res.confidence * 100).toFixed(0)}%</div>
        <div style="margin-top:0.25rem;"><strong>Chunks RAG Terambil:</strong> ${chunks.length} potongan</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:1rem;">
        ${chunks.map((c, i) => `
          <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:1rem;">
            <div style="display:flex;justify-content:space-between;margin-bottom:0.4rem;font-size:0.8rem;">
              <span class="badge ${c.authority === 'PRIMARY' ? 'badge-primary' : 'badge-supplementary'}">${c.authority}</span>
              <span style="color:var(--text-subtle);">Chunk #${c.id} • Hal. ${c.page_number || '?'}</span>
            </div>
            <strong style="color:#FDA4AF;font-size:0.9rem;">${escapeHtml(c.source_title)} — ${escapeHtml(c.chapter)}</strong>
            <pre style="white-space:pre-wrap;font-size:0.8rem;color:var(--text-muted);margin-top:0.5rem;font-family:var(--font-main);line-height:1.5;">${escapeHtml(c.content)}</pre>
          </div>
        `).join('')}
      </div>
    `;
  } catch (err) {
    bodyEl.innerHTML = '<p style="color:#EF4444;">Gagal menelusuri trace data.</p>';
  }
}

// ----------------------------------------------------
// 9. AUTH MODALS
// ----------------------------------------------------
function setupAuthModals() {
  const modal = document.getElementById('auth-modal');
  const closeBtn = document.getElementById('auth-modal-close');
  if (closeBtn && modal) {
    closeBtn.onclick = () => modal.classList.remove('active');
  }

  // Tab switcher
  document.getElementById('tab-btn-login')?.addEventListener('click', () => switchAuthTab('login'));
  document.getElementById('tab-btn-register')?.addEventListener('click', () => switchAuthTab('register'));


  // Login form submit
  document.getElementById('login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const idVal = document.getElementById('login-identifier').value;
    const passVal = document.getElementById('login-password').value;

    try {
      const res = await API.login(idVal, passVal);
      API.setToken(res.token);
      State.setUser(res.user);
      Toast.show(`Selamat datang kembali, ${res.user.name}!`, 'success');
      modal.classList.remove('active');
    } catch (err) {
      Toast.show(err.message, 'error');
    }
  });

  // Register form submit
  document.getElementById('register-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name: document.getElementById('reg-name').value,
      username: document.getElementById('reg-username').value,
      email: document.getElementById('reg-email').value,
      password: document.getElementById('reg-password').value,
      pmr_level: 'WIRA'
    };

    try {
      const res = await API.register(payload);
      API.setToken(res.token);
      State.setUser(res.user);
      Toast.show('Pendaftaran berhasil! Selamat bergabung di PMR WIRA.', 'success');
      modal.classList.remove('active');
    } catch (err) {
      Toast.show(err.message, 'error');
    }
  });
}

function openAuthModal(tab = 'login') {
  const modal = document.getElementById('auth-modal');
  if (modal) {
    modal.classList.add('active');
    switchAuthTab(tab);
  }
}

function switchAuthTab(tab) {
  const loginTabBtn = document.getElementById('tab-btn-login');
  const regTabBtn = document.getElementById('tab-btn-register');
  const loginForm = document.getElementById('login-form');
  const regForm = document.getElementById('register-form');

  if (tab === 'login') {
    loginTabBtn.classList.add('active');
    regTabBtn.classList.remove('active');
    loginForm.style.display = 'block';
    regForm.style.display = 'none';
  } else {
    regTabBtn.classList.add('active');
    loginTabBtn.classList.remove('active');
    regForm.style.display = 'block';
    loginForm.style.display = 'none';
  }
}

// ----------------------------------------------------
// 10. EDIT & ROLLBACK MODALS
// ----------------------------------------------------
function openEditMaterialModal(material) {
  const modal = document.getElementById('edit-material-modal');
  if (!modal) return;

  document.getElementById('edit-mat-id').value = material.id;
  document.getElementById('edit-mat-title').value = material.title;
  document.getElementById('edit-mat-summary').value = material.summary || '';
  document.getElementById('edit-mat-content').value = material.content;
  document.getElementById('edit-mat-reason').value = '';

  modal.classList.add('active');

  document.getElementById('edit-mat-close').onclick = () => modal.classList.remove('active');

  document.getElementById('edit-material-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const id = document.getElementById('edit-mat-id').value;
      const res = await API.updateMaterial(id, {
        title: document.getElementById('edit-mat-title').value,
        summary: document.getElementById('edit-mat-summary').value,
        content: document.getElementById('edit-mat-content').value,
        change_reason: document.getElementById('edit-mat-reason').value
      });
      Toast.show(res.message, 'success');
      modal.classList.remove('active');
      loadMaterialDetail(id);
    } catch (err) {
      Toast.show(err.message, 'error');
    }
  };
}

function openRollbackModal(material, versions) {
  const modal = document.getElementById('rollback-material-modal');
  if (!modal) return;

  const select = document.getElementById('rollback-version-select');
  select.innerHTML = versions.filter(v => v.id !== material.current_version_id).map(v => `
    <option value="${v.id}">Versi ${escapeHtml(v.version)} (${v.created_at}) — ${escapeHtml(v.change_reason || '')}</option>
  `).join('');

  modal.classList.add('active');
  document.getElementById('rollback-close').onclick = () => modal.classList.remove('active');

  document.getElementById('rollback-form').onsubmit = async (e) => {
    e.preventDefault();
    if (!confirm('Apakah Anda yakin ingin melakukan rollback ke versi yang dipilih? Tindakan ini akan tercatat dalam Audit Log.')) return;

    try {
      const targetId = select.value;
      const reason = document.getElementById('rollback-reason').value;
      const res = await API.rollbackMaterial(material.id, {
        target_version_id: targetId,
        reason
      });
      Toast.show(res.message, 'success');
      modal.classList.remove('active');
      loadMaterialDetail(material.id);
    } catch (err) {
      Toast.show(err.message, 'error');
    }
  };
}

// Global window helpers for inline HTML events
window.editMaterialFromAdmin = async (id) => {
  const res = await API.getMaterialDetail(id);
  openEditMaterialModal(res.material);
};

window.rollbackMaterialFromAdmin = async (id) => {
  const res = await API.getMaterialDetail(id);
  openRollbackModal(res.material, res.versions);
};

window.openSourceVersionsModal = async (sourceId) => {
  const res = await API.getSourceDetail(sourceId);
  const versions = res.versions || [];
  alert(`Versi Dokumen "${res.source.title}":\n\n` + versions.map(v => 
    `• Versi ${v.version} (${v.publication_year}) [${v.status}] — ${v.change_summary || '-'}`
  ).join('\n'));
};

window.openCreateVersionModal = (sourceId) => {
  const version = prompt('Masukkan nomor versi baru (contoh: 2.0):');
  if (!version) return;
  const summary = prompt('Masukkan ringkasan perubahan:');
  API.createSourceVersion(sourceId, { version, change_summary: summary, status: 'PENDING_REVIEW' })
    .then(res => {
      Toast.show(res.message, 'success');
      loadAdminSources();
    })
    .catch(err => Toast.show(err.message, 'error'));
};

// MARKDOWN FORMATTER UTILITY — Full support for Gemini AI structured output
function formatMarkdown(text) {
  if (!text) return '';

  const lines = text.split('\n');
  const output = [];
  let inOrderedList = false;
  let inUnorderedList = false;
  let paragraphBuffer = [];

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function inlineFormat(str) {
    let s = esc(str);
    s = s.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
    s = s.replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.08);padding:0.15rem 0.4rem;border-radius:4px;font-size:0.88em;color:#FCA5A5;">$1</code>');
    return s;
  }

  function flushParagraph() {
    if (paragraphBuffer.length > 0) {
      output.push('<p>' + paragraphBuffer.join('<br>') + '</p>');
      paragraphBuffer = [];
    }
  }

  function closeLists() {
    if (inOrderedList) { output.push('</ol>'); inOrderedList = false; }
    if (inUnorderedList) { output.push('</ul>'); inUnorderedList = false; }
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (trimmed === '') {
      flushParagraph();
      closeLists();
      continue;
    }

    if (/^-{3,}$/.test(trimmed) || /^\*{3,}$/.test(trimmed)) {
      flushParagraph(); closeLists();
      output.push('<hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:1rem 0;">');
      continue;
    }

    const h3Match = trimmed.match(/^###\s+(.+)$/);
    if (h3Match) { flushParagraph(); closeLists(); output.push('<h3>' + inlineFormat(h3Match[1]) + '</h3>'); continue; }
    const h2Match = trimmed.match(/^##\s+(.+)$/);
    if (h2Match) { flushParagraph(); closeLists(); output.push('<h2 style="font-size:1.3rem;font-weight:700;color:#FFF;margin:1.5rem 0 0.5rem;">' + inlineFormat(h2Match[1]) + '</h2>'); continue; }
    const h1Match = trimmed.match(/^#\s+(.+)$/);
    if (h1Match) { flushParagraph(); closeLists(); output.push('<h1 style="font-size:1.6rem;font-weight:800;color:#FFF;margin:1.5rem 0 0.75rem;">' + inlineFormat(h1Match[1]) + '</h1>'); continue; }

    if (trimmed.startsWith('>')) {
      flushParagraph(); closeLists();
      output.push('<blockquote style="border-left:3px solid #F59E0B;padding-left:1rem;color:#FDE68A;margin:0.75rem 0;">' + inlineFormat(trimmed.replace(/^>\s*/, '')) + '</blockquote>');
      continue;
    }

    const olMatch = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
    if (olMatch) {
      flushParagraph();
      if (inUnorderedList) { output.push('</ul>'); inUnorderedList = false; }
      if (!inOrderedList) { output.push('<ol>'); inOrderedList = true; }
      output.push('<li>' + inlineFormat(olMatch[2]) + '</li>');
      continue;
    }

    const ulMatch = trimmed.match(/^[-*\u2022]\s+(.+)$/);
    if (ulMatch) {
      flushParagraph();
      if (inOrderedList) { output.push('</ol>'); inOrderedList = false; }
      if (!inUnorderedList) { output.push('<ul>'); inUnorderedList = true; }
      output.push('<li>' + inlineFormat(ulMatch[1]) + '</li>');
      continue;
    }

    const subMatch = raw.match(/^\s{2,}[-*\u2022]\s+(.+)$/);
    if (subMatch) {
      output.push('<li style="margin-left:1.5rem;list-style-type:circle;">' + inlineFormat(subMatch[1]) + '</li>');
      continue;
    }
    const subOlMatch = raw.match(/^\s{2,}(\d+)[.)]\s+(.+)$/);
    if (subOlMatch) {
      output.push('<li style="margin-left:1.5rem;">' + inlineFormat(subOlMatch[2]) + '</li>');
      continue;
    }

    paragraphBuffer.push(inlineFormat(trimmed));
  }

  flushParagraph();
  closeLists();

  return output.join('\n');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatModelName(rawModel) {
  if (!rawModel) return 'Google Gemini AI';
  if (rawModel.includes('3.8')) return 'Google Gemini 3.8 Flash';
  if (rawModel.includes('3.7')) return 'Google Gemini 3.7 Flash';
  if (rawModel.includes('3.6')) return 'Google Gemini 3.6 Flash';
  if (rawModel.includes('3.5')) return 'Google Gemini 3.5 Flash';
  if (rawModel.includes('gemini')) return 'Google Gemini AI';
  return 'Basis Data Pertolongan Pertama PMR WIRA';
}
