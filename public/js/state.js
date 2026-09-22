// HelpMe! Frontend State Management

const State = {
  user: null,
  currentView: 'landing',
  currentSessionId: null,
  sessions: [],
  selectedMaterialId: null,
  activeAdminTab: 'overview',
  currentDrawerData: null,

  init() {
    this.user = API.getUser();
  },

  setUser(user) {
    this.user = user;
    API.setUser(user);
    this.emit('userChanged', user);
  },

  setView(viewName, params = {}) {
    this.currentView = viewName;
    this.emit('viewChanged', { viewName, params });
  },

  // Simple PubSub event listener
  listeners: {},
  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  },

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => cb(data));
    }
  }
};

// UI Notification Helper
const Toast = {
  show(message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        gap: 8px;
      `;
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    const bg = type === 'error' ? '#EF4444' : (type === 'success' ? '#10B981' : '#3B82F6');
    toast.style.cssText = `
      background: ${bg};
      color: white;
      padding: 10px 18px;
      border-radius: 8px;
      font-size: 0.85rem;
      font-weight: 600;
      box-shadow: 0 4px 14px rgba(0,0,0,0.3);
      animation: fadeIn 0.2s ease;
    `;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }
};

window.State = State;
window.Toast = Toast;
