// Auth module
const Auth = {
  async checkAuth() {
    try {
      const user = await API.getCurrentUser();
      this.showDashboard(user);
      return true;
    } catch {
      this.showLogin();
      return false;
    }
  },

  async login() {
    window.location.href = '/auth/microsoft';
  },

  async logout() {
    try {
      await API.logout();
    } finally {
      this.showLogin();
    }
  },

  showLogin() {
    document.getElementById('userEmail')?.textContent?.('');
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const loginBox = document.querySelector('.login-box');
    if (loginBox) loginBox.style.display = 'flex';
    document.querySelector('.sidebar')?.classList.add('hidden');
    document.querySelector('.main-content')?.classList.add('hidden');
  },

  showDashboard(user) {
    document.querySelector('.login-box')?.style && (document.querySelector('.login-box').style.display = 'none');
    document.querySelector('.sidebar')?.classList.remove('hidden');
    document.querySelector('.main-content')?.classList.remove('hidden');
    if (user?.email) {
      const el = document.getElementById('userEmail');
      if (el) el.textContent = user.email;
    }
    document.getElementById('resumen')?.classList.add('active');
  }
};

// Event listeners
document.getElementById('loginBtn')?.addEventListener('click', () => Auth.login());
document.getElementById('logoutBtn')?.addEventListener('click', () => Auth.logout());

// Check auth on load
document.addEventListener('DOMContentLoaded', () => Auth.checkAuth());
