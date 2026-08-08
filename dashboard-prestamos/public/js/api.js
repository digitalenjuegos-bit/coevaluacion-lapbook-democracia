// API client
const API = {
  baseUrl: '',

  async request(endpoint, options = {}) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Error de red' }));
      throw new Error(error.error || 'Error en la solicitud');
    }

    if (response.status === 204) return null;
    return response.json();
  },

  // Loans
  async getLoans() {
    return this.request('/api/loans');
  },

  async createLoan(loan) {
    return this.request('/api/loans', {
      method: 'POST',
      body: JSON.stringify(loan)
    });
  },

  async updateLoan(id, loan) {
    return this.request(`/api/loans/${id}`, {
      method: 'PUT',
      body: JSON.stringify(loan)
    });
  },

  async deleteLoan(id) {
    return this.request(`/api/loans/${id}`, {
      method: 'DELETE'
    });
  },

  async getLoanSchedule(id) {
    return this.request(`/api/loans/${id}/schedule`);
  },

  // Payments
  async getPayments(loanId = null) {
    const url = loanId ? `/api/payments?loanId=${loanId}` : '/api/payments';
    return this.request(url);
  },

  async createPayment(payment) {
    return this.request('/api/payments', {
      method: 'POST',
      body: JSON.stringify(payment)
    });
  },

  async deletePayment(id) {
    return this.request(`/api/payments/${id}`, {
      method: 'DELETE'
    });
  },

  // Incomes
  async getIncomes() {
    return this.request('/api/incomes');
  },

  async createIncome(income) {
    return this.request('/api/incomes', {
      method: 'POST',
      body: JSON.stringify(income)
    });
  },

  async updateIncome(id, income) {
    return this.request(`/api/incomes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(income)
    });
  },

  async deleteIncome(id) {
    return this.request(`/api/incomes/${id}`, {
      method: 'DELETE'
    });
  },

  // Settings
  async getSettings() {
    return this.request('/api/settings');
  },

  async updateSettings(settings) {
    return this.request('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(settings)
    });
  },

  // Projection
  async getProjection(months) {
    return this.request(`/api/projection?months=${months}`);
  },

  // Auth
  async getCurrentUser() {
    return this.request('/api/auth/me');
  },

  async logout() {
    return this.request('/api/auth/logout', {
      method: 'POST'
    });
  }
};
