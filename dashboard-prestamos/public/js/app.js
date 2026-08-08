// Main application module
const App = {
  loans: [],
  payments: [],
  incomes: [],
  settings: {},
  projectionChart: null,

  async init() {
    const isAuthed = await Auth.checkAuth();
    if (!isAuthed) return;

    this.setupEventListeners();
    await this.loadData();
    this.setupNavigation();
  },

  setupEventListeners() {
    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const section = item.dataset.section;
        this.showSection(section);
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        item.classList.add('active');
      });
    });

    // Loan modal
    document.getElementById('addLoanBtn')?.addEventListener('click', () => this.openLoanModal());
    document.getElementById('closeLoanModal')?.addEventListener('click', () => this.closeLoanModal('loanModal'));
    document.getElementById('cancelLoanBtn')?.addEventListener('click', () => this.closeLoanModal('loanModal'));
    
    // Grace period toggle
    document.getElementById('loanGrace')?.addEventListener('change', (e) => {
      document.getElementById('graceFields').style.display = e.target.checked ? 'block' : 'none';
    });

    // Loan form
    document.getElementById('loanForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveLoan();
    });

    // Payment modal
    document.getElementById('closePaymentModal')?.addEventListener('click', () => this.closeModal('paymentModal'));
    document.getElementById('cancelPaymentBtn')?.addEventListener('click', () => this.closeModal('paymentModal'));
    document.getElementById('paymentForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.savePayment();
    });

    // Income modal
    document.getElementById('addIncomeBtn')?.addEventListener('click', () => this.openIncomeModal());
    document.getElementById('closeIncomeModal')?.addEventListener('click', () => this.closeModal('incomeModal'));
    document.getElementById('cancelIncomeBtn')?.addEventListener('click', () => this.closeModal('incomeModal'));
    document.getElementById('incomeForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveIncome();
    });

    // Loan select
    document.getElementById('loanSelect')?.addEventListener('change', (e) => {
      this.loadAmortizationTable(e.target.value);
    });

    // Projection months
    document.getElementById('projectionMonths')?.addEventListener('change', (e) => {
      this.loadProjection(parseInt(e.target.value));
    });

    // Default projection
    document.getElementById('defaultProjection')?.addEventListener('change', async (e) => {
      await API.updateSettings({ projectionMonths: parseInt(e.target.value) });
      this.settings.projectionMonths = parseInt(e.target.value);
    });
  },

  setupNavigation() {
    // Handle browser back/forward
    window.addEventListener('popstate', () => {
      const hash = window.location.hash.slice(1) || 'resumen';
      this.showSection(hash);
    });
  },

  showSection(sectionId) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById(sectionId)?.classList.add('active');
    
    // Load section-specific data
    if (sectionId === 'resumen') this.loadSummary();
    if (sectionId === 'prestamos') this.renderLoans();
    if (sectionId === 'tabla') this.renderLoanSelect();
    if (sectionId === 'flujo') this.loadProjection();
    if (sectionId === 'configuracion') this.renderIncomes();
  },

  async loadData() {
    try {
      const [loans, payments, incomes, settings] = await Promise.all([
        API.getLoans(),
        API.getPayments(),
        API.getIncomes(),
        API.getSettings()
      ]);
      
      this.loans = loans;
      this.payments = payments;
      this.incomes = incomes;
      this.settings = settings;
      
      this.loadSummary();
    } catch (error) {
      console.error('Error loading data:', error);
      this.showAlert('Error al cargar datos', 'critical');
    }
  },

  loadSummary() {
    const totalLoans = this.loans.length;
    let totalBalance = 0;
    let totalMonthlyPayment = 0;
    const alerts = [];

    this.loans.forEach(loan => {
      const schedule = this.getLoanSchedule(loan.id);
      if (schedule.length > 0) {
        const currentMonth = schedule[0];
        totalBalance += currentMonth.balance || 0;
        
        const payment = currentMonth.actualPayment || currentMonth.scheduledPayment || 0;
        totalMonthlyPayment += payment;
        
        // Check for alerts
        if (currentMonth.balance > 0 && currentMonth.balance < payment) {
          alerts.push({
            type: 'critical',
            message: `${loan.name}: Saldo menor a la cuota programada`
          });
        }
        
        if (payment > 0) {
          const lastPayment = this.payments
            .filter(p => p.loanId === loan.id)
            .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
          
          if (lastPayment) {
            const daysSinceLastPayment = Math.floor((new Date() - new Date(lastPayment.date)) / (1000 * 60 * 60 * 24));
            if (daysSinceLastPayment > 35) {
              alerts.push({
                type: 'warning',
                message: `${loan.name}: Último pago hace ${daysSinceLastPayment} días`
              });
            }
          }
        }
      }
    });

    // Check cash flow alerts
    const projectionMonths = this.settings.projectionMonths || 24;
    let negativeFlowMonths = 0;
    for (let i = 0; i < Math.min(projectionMonths, 3); i++) {
      const monthDate = new Date();
      monthDate.setMonth(monthDate.getMonth() + i);
      
      let monthlyIncome = 0;
      this.incomes.forEach(income => {
        if (income.active) {
          const startDate = new Date(income.startDate);
          if (monthDate >= startDate) monthlyIncome += Number(income.amount || 0);
        }
      });
      
      let monthlyPayments = 0;
      this.loans.forEach(loan => {
        const schedule = this.getLoanSchedule(loan.id);
        if (schedule[i]) {
          monthlyPayments += schedule[i].actualPayment || schedule[i].scheduledPayment || 0;
        }
      });
      
      if (monthlyIncome - monthlyPayments < 0) {
        negativeFlowMonths++;
      }
    }
    
    if (negativeFlowMonths > 0) {
      alerts.push({
        type: 'warning',
        message: `Flujo negativo en ${negativeFlowMonths} de los próximos 3 meses`
      });
    }

    // Update UI
    document.getElementById('totalLoans').textContent = totalLoans;
    document.getElementById('totalBalance').textContent = this.formatCurrency(totalBalance);
    document.getElementById('monthlyPayment').textContent = this.formatCurrency(totalMonthlyPayment);
    document.getElementById('alertsCount').textContent = alerts.length;

    // Render alerts
    const alertsList = document.getElementById('alertsList');
    if (alerts.length === 0) {
      alertsList.innerHTML = '<p class="no-data">No hay alertas pendientes</p>';
    } else {
      alertsList.innerHTML = alerts.map(alert => `
        <div class="alert-item ${alert.type}">
          <span>${alert.type === 'critical' ? '🔴' : '🟡'}</span>
          <span>${alert.message}</span>
        </div>
      `).join('');
    }
  },

  getLoanSchedule(loanId) {
    const loan = this.loans.find(l => l.id === loanId);
    if (!loan) return [];
    
    // Simple amortization calculation for summary
    const monthlyRate = Number(loan.rateAnnual || 0) / 100 / 12;
    const principal = Number(loan.principal || 0);
    const termMonths = Number(loan.termMonths || 0);
    
    if (monthlyRate === 0 || principal === 0 || termMonths === 0) return [];
    
    let fixedPayment = 0;
    if (loan.system === 'frances') {
      fixedPayment = principal * (monthlyRate * Math.pow(1 + monthlyRate, termMonths)) / 
                     (Math.pow(1 + monthlyRate, termMonths) - 1);
    } else if (loan.system === 'aleman') {
      fixedPayment = principal / termMonths + principal * monthlyRate;
    }
    
    const schedule = [];
    let balance = principal;
    const startDate = new Date(loan.startDate);
    
    for (let month = 0; month < termMonths; month++) {
      const interest = balance * monthlyRate;
      let principalPayment = 0;
      
      if (loan.system === 'frances') {
        principalPayment = fixedPayment - interest;
        balance -= principalPayment;
      } else if (loan.system === 'aleman') {
        principalPayment = principal / termMonths;
        balance -= principalPayment;
      } else if (loan.system === 'americano') {
        if (month === termMonths - 1) {
          principalPayment = balance;
          balance = 0;
        }
      }
      
      // Check for actual payments
      const monthDate = new Date(startDate);
      monthDate.setMonth(monthDate.getMonth() + month);
      
      const monthPayments = this.payments
        .filter(p => p.loanId === loanId)
        .filter(p => {
          const pDate = new Date(p.date);
          return pDate.getMonth() === monthDate.getMonth() && 
                 pDate.getFullYear() === monthDate.getFullYear();
        });
      
      const actualPayment = monthPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      
      schedule.push({
        month: month + 1,
        date: monthDate.toISOString().split('T')[0],
        scheduledPayment: loan.system === 'americano' && month < termMonths - 1 ? interest : fixedPayment,
        actualPayment: actualPayment || 0,
        interest: interest,
        principal: principalPayment,
        balance: Math.max(0, balance)
      });
    }
    
    return schedule;
  },

  renderLoans() {
    const container = document.getElementById('loansList');
    if (!container) return;

    if (this.loans.length === 0) {
      container.innerHTML = '<p class="no-data">No hay préstamos registrados. Agrega tu primer préstamo.</p>';
      return;
    }

    container.innerHTML = this.loans.map(loan => {
      const schedule = this.getLoanSchedule(loan.id);
      const currentMonth = schedule[0];
      const balance = currentMonth?.balance || 0;
      const payment = currentMonth?.actualPayment || currentMonth?.scheduledPayment || 0;
      
      // Determine status
      let status = 'active';
      let statusText = 'Vigente';
      if (balance <= 0) {
        status = 'success';
        statusText = 'Pagado';
      } else if (payment > balance) {
        status = 'warning';
        statusText = 'Última cuota';
      }
      
      return `
        <div class="loan-card">
          <div class="loan-card-header">
            <div>
              <h3 class="loan-card-title">${this.escapeHtml(loan.name)}</h3>
              <p class="loan-card-subtitle">${this.escapeHtml(loan.bank)} • ${this.getProductLabel(loan.product)}</p>
            </div>
            <span class="badge ${status}">${statusText}</span>
          </div>
          
          <div class="loan-card-stats">
            <div class="stat-item">
              <label>Saldo</label>
              <p>${this.formatCurrency(balance)}</p>
            </div>
            <div class="stat-item">
              <label>Cuota</label>
              <p>${this.formatCurrency(payment)}</p>
            </div>
            <div class="stat-item">
              <label>Tasa</label>
              <p>${loan.rateAnnual}% anual</p>
            </div>
            <div class="stat-item">
              <label>Plazo</label>
              <p>${loan.termMonths} meses</p>
            </div>
          </div>
          
          <div class="loan-card-actions">
            <button class="btn-primary" onclick="app.registerPayment('${loan.id}')">
              Registrar Pago
            </button>
            <button class="btn-secondary" onclick="app.viewSchedule('${loan.id}')">
              Ver Tabla
            </button>
          </div>
        </div>
      `;
    }).join('');
  },

  renderLoanSelect() {
    const select = document.getElementById('loanSelect');
    if (!select) return;
    
    select.innerHTML = '<option value="">Seleccionar préstamo</option>' +
      this.loans.map(loan => `<option value="${loan.id}">${this.escapeHtml(loan.name)} - ${this.escapeHtml(loan.bank)}</option>`).join('');
  },

  async loadAmortizationTable(loanId) {
    if (!loanId) {
      document.querySelector('#amortizationTable tbody').innerHTML = '';
      return;
    }
    
    try {
      const schedule = await API.getLoanSchedule(loanId);
      const tbody = document.querySelector('#amortizationTable tbody');
      
      tbody.innerHTML = schedule.map(row => `
        <tr>
          <td>${row.month}</td>
          <td>${row.date}</td>
          <td>${this.formatCurrency(row.scheduledPayment)}</td>
          <td>${row.actualPayment > 0 ? this.formatCurrency(row.actualPayment) : '-'}</td>
          <td>${this.formatCurrency(row.interest)}</td>
          <td>${this.formatCurrency(row.principal)}</td>
          <td>${this.formatCurrency(row.balance)}</td>
        </tr>
      `).join('');
    } catch (error) {
      console.error('Error loading schedule:', error);
    }
  },

  async loadProjection(months = null) {
    const projectionMonths = months || this.settings.projectionMonths || 24;
    try {
      const data = await API.getProjection(projectionMonths);
      const projection = data.projection;
      const summary = data.summary;
      
      // Update summary cards
      document.getElementById('avgFlow').textContent = this.formatCurrency(summary.avgFlow);
      document.getElementById('criticalPoint').textContent = summary.criticalMonth;
      document.getElementById('finalBalance').textContent = this.formatCurrency(summary.finalBalance);
      
      // Update chart
      this.updateProjectionChart(projection);
    } catch (error) {
      console.error('Error loading projection:', error);
    }
  },

  updateProjectionChart(projection) {
    const ctx = document.getElementById('cashFlowChart');
    if (!ctx) return;
    
    if (this.projectionChart) {
      this.projectionChart.destroy();
    }
    
    this.projectionChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: projection.map(p => p.month),
        datasets: [
          {
            label: 'Ingresos',
            data: projection.map(p => p.income),
            backgroundColor: '#16a34a'
          },
          {
            label: 'Egresos',
            data: projection.map(p => p.payments),
            backgroundColor: '#dc2626'
          },
          {
            label: 'Flujo Neto',
            data: projection.map(p => p.netFlow),
            backgroundColor: projection.map(p => p.netFlow >= 0 ? '#2563eb' : '#f59e0b')
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: value => this.formatCurrency(value)
            }
          }
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: context => `${context.dataset.label}: ${this.formatCurrency(context.raw)}`
            }
          }
        }
      }
    });
  },

  // Modal methods
  openLoanModal() {
    document.getElementById('loanModal').classList.add('open');
    document.getElementById('loanForm').reset();
    document.getElementById('loanId').value = '';
    document.getElementById('graceFields').style.display = 'none';
  },

  closeLoanModal() {
    document.getElementById('loanModal').classList.remove('open');
  },

  openPaymentModal(loanId) {
    document.getElementById('paymentModal').classList.add('open');
    document.getElementById('paymentLoanId').value = loanId;
    document.getElementById('paymentDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('paymentForm').reset();
  },

  closeModal(modalId) {
    document.getElementById(modalId).classList.remove('open');
  },

  openIncomeModal() {
    document.getElementById('incomeModal').classList.add('open');
    document.getElementById('incomeForm').reset();
    document.getElementById('incomeId').value = '';
    document.getElementById('incomeActive').checked = true;
  },

  // CRUD methods
  async saveLoan() {
    const loan = {
      name: document.getElementById('loanName').value,
      bank: document.getElementById('loanBank').value,
      product: document.getElementById('loanProduct').value,
      system: document.getElementById('loanSystem').value,
      principal: parseFloat(document.getElementById('loanPrincipal').value),
      rateAnnual: parseFloat(document.getElementById('loanRate').value),
      termMonths: parseInt(document.getElementById('loanTerm').value),
      startDate: document.getElementById('loanStartDate').value,
      frequency: document.getElementById('loanFrequency').value,
      insurance: parseFloat(document.getElementById('loanInsurance').value) || 0,
      graceType: document.getElementById('loanGrace').checked ? document.getElementById('graceType').value : null,
      graceMonths: document.getElementById('loanGrace').checked ? parseInt(document.getElementById('graceMonths').value) : 0
    };

    const loanId = document.getElementById('loanId').value;
    
    try {
      if (loanId) {
        await API.updateLoan(loanId, loan);
      } else {
        await API.createLoan(loan);
      }
      
      this.closeLoanModal();
      await this.loadData();
      this.renderLoans();
    } catch (error) {
      this.showAlert(error.message, 'critical');
    }
  },

  registerPayment(loanId) {
    this.openPaymentModal(loanId);
  },

  async savePayment() {
    const payment = {
      loanId: document.getElementById('paymentLoanId').value,
      date: document.getElementById('paymentDate').value,
      amount: parseFloat(document.getElementById('paymentAmount').value),
      note: document.getElementById('paymentNote').value
    };

    try {
      await API.createPayment(payment);
      this.closeModal('paymentModal');
      await this.loadData();
      this.renderLoans();
    } catch (error) {
      this.showAlert(error.message, 'critical');
    }
  },

  async saveIncome() {
    const income = {
      name: document.getElementById('incomeName').value,
      amount: parseFloat(document.getElementById('incomeAmount').value),
      startDate: document.getElementById('incomeStartDate').value,
      active: document.getElementById('incomeActive').checked
    };

    const incomeId = document.getElementById('incomeId').value;
    
    try {
      if (incomeId) {
        await API.updateIncome(incomeId, income);
      } else {
        await API.createIncome(income);
      }
      
      this.closeModal('incomeModal');
      await this.loadData();
      this.renderIncomes();
    } catch (error) {
      this.showAlert(error.message, 'critical');
    }
  },

  async deleteIncome(id) {
    if (!confirm('¿Eliminar este ingreso?')) return;
    
    try {
      await API.deleteIncome(id);
      await this.loadData();
      this.renderIncomes();
    } catch (error) {
      this.showAlert(error.message, 'critical');
    }
  },

  renderIncomes() {
    const container = document.getElementById('incomesList');
    if (!container) return;

    if (this.incomes.length === 0) {
      container.innerHTML = '<p class="no-data">No hay ingresos configurados</p>';
      return;
    }

    container.innerHTML = this.incomes.map(income => `
      <div class="list-item">
        <div class="list-item-info">
          <h4>${this.escapeHtml(income.name)}</h4>
          <p>${this.formatCurrency(income.amount)}/mes • Desde ${income.startDate}</p>
        </div>
        <div class="list-item-actions">
          <button class="btn-secondary" onclick="app.deleteIncome('${income.id}')">
            Eliminar
          </button>
        </div>
      </div>
    `).join('');
  },

  viewSchedule(loanId) {
    this.showSection('tabla');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector('[data-section="tabla"]')?.classList.add('active');
    document.getElementById('loanSelect').value = loanId;
    this.loadAmortizationTable(loanId);
  },

  // Utility methods
  formatCurrency(value) {
    const num = Number(value) || 0;
    return new Intl.NumberFormat('es-EC', {
      style: 'currency',
      currency: 'USD'
    }).format(num);
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  getProductLabel(product) {
    const labels = {
      consumo: 'Crédito de Consumo',
      tarjeta: 'Tarjeta de Crédito',
      hipotecario: 'Hipotecario',
      vehicular: 'Vehicular',
      otro: 'Otro'
    };
    return labels[product] || product;
  },

  showAlert(message, type = 'info') {
    alert(message);
  }
};

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => App.init());
