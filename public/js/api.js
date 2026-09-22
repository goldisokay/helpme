// HelpMe! API Client

const API = {
  getToken() {
    return localStorage.getItem('helpme_token');
  },

  setToken(token) {
    if (token) {
      localStorage.setItem('helpme_token', token);
    } else {
      localStorage.removeItem('helpme_token');
    }
  },

  getUser() {
    try {
      const u = localStorage.getItem('helpme_user');
      return u ? JSON.parse(u) : null;
    } catch (e) {
      return null;
    }
  },

  setUser(user) {
    if (user) {
      localStorage.setItem('helpme_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('helpme_user');
    }
  },

  async request(endpoint, options = {}) {
    const token = this.getToken();
    const headers = {
      ...options.headers
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      if (options.body && typeof options.body === 'object') {
        options.body = JSON.stringify(options.body);
      }
    }

    try {
      const res = await fetch(endpoint, { ...options, headers });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Terjadi kesalahan pada permintaan.');
      }
      return data;
    } catch (err) {
      console.error(`API Error on ${endpoint}:`, err);
      throw err;
    }
  },

  // AUTH
  login(usernameOrEmail, password) {
    return this.request('/api/auth/login', {
      method: 'POST',
      body: { usernameOrEmail, password }
    });
  },

  register(payload) {
    return this.request('/api/auth/register', {
      method: 'POST',
      body: payload
    });
  },

  getMe() {
    return this.request('/api/auth/me');
  },

  updateProfile(payload) {
    return this.request('/api/auth/profile', {
      method: 'PUT',
      body: payload
    });
  },

  // CHAT
  getChatSessions() {
    return this.request('/api/chat/sessions');
  },

  createChatSession(title) {
    return this.request('/api/chat/sessions', {
      method: 'POST',
      body: { title }
    });
  },

  getChatSession(id) {
    return this.request(`/api/chat/sessions/${id}`);
  },

  deleteChatSession(id) {
    return this.request(`/api/chat/sessions/${id}`, { method: 'DELETE' });
  },

  sendMessage(sessionId, content) {
    return this.request(`/api/chat/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: { content }
    });
  },

  sendFeedback(aiResponseId, feedback, reason) {
    return this.request('/api/chat/feedback', {
      method: 'POST',
      body: { ai_response_id: aiResponseId, feedback, feedback_reason: reason }
    });
  },

  getTrace(responseId) {
    return this.request(`/api/chat/trace/${responseId}`);
  },

  // MATERIALS
  getMaterials(params = {}) {
    const q = new URLSearchParams(params).toString();
    return this.request(`/api/materials${q ? '?' + q : ''}`);
  },

  getMaterialDetail(id) {
    return this.request(`/api/materials/${id}`);
  },

  createMaterial(payload) {
    return this.request('/api/materials', {
      method: 'POST',
      body: payload
    });
  },

  updateMaterial(id, payload) {
    return this.request(`/api/materials/${id}`, {
      method: 'PUT',
      body: payload
    });
  },

  rollbackMaterial(id, payload) {
    return this.request(`/api/materials/${id}/rollback`, {
      method: 'POST',
      body: payload
    });
  },

  // SOURCES
  getSources() {
    return this.request('/api/sources');
  },

  getSourceDetail(id) {
    return this.request(`/api/sources/${id}`);
  },

  createSource(payload) {
    return this.request('/api/sources', {
      method: 'POST',
      body: payload
    });
  },

  createSourceVersion(sourceId, payload) {
    return this.request(`/api/sources/${sourceId}/versions`, {
      method: 'POST',
      body: payload
    });
  },

  activateSourceVersion(versionId) {
    return this.request(`/api/sources/versions/${versionId}/activate`, {
      method: 'POST'
    });
  },

  updateSourceVersionStatus(versionId, status, reason) {
    return this.request(`/api/sources/versions/${versionId}/status`, {
      method: 'POST',
      body: { status, reason }
    });
  },

  compareVersions(v1Id, v2Id, type = 'source') {
    return this.request(`/api/sources/compare?v1_id=${v1Id}&v2_id=${v2Id}&type=${type}`);
  },

  // ADMIN
  getAdminDashboard() {
    return this.request('/api/admin/dashboard');
  },

  getAdminUsers() {
    return this.request('/api/admin/users');
  },

  updateUserRole(userId, role) {
    return this.request(`/api/admin/users/${userId}/role`, {
      method: 'PUT',
      body: { role }
    });
  },

  updateUserStatus(userId, status) {
    return this.request(`/api/admin/users/${userId}/status`, {
      method: 'PUT',
      body: { status }
    });
  },

  getReviewCenter() {
    return this.request('/api/admin/review-center');
  },

  processReview(type, id, action, reason) {
    return this.request(`/api/admin/review-center/${type}/${id}/action`, {
      method: 'POST',
      body: { action, reason }
    });
  },

  getAiLogs() {
    return this.request('/api/admin/ai-logs');
  },

  flagAiResponse(responseId, isFlagged, notes) {
    return this.request(`/api/admin/ai-logs/${responseId}/flag`, {
      method: 'POST',
      body: { is_flagged: isFlagged, flag_notes: notes }
    });
  },

  getAuditLogs() {
    return this.request('/api/admin/audit-logs');
  },

  getSettings() {
    return this.request('/api/admin/settings');
  },

  updateSettings(settings) {
    return this.request('/api/admin/settings', {
      method: 'PUT',
      body: { settings }
    });
  },

  // UPLOAD
  uploadDocument(formData) {
    return this.request('/api/upload/document', {
      method: 'POST',
      body: formData
    });
  }
};

window.API = API;
