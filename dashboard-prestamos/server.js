const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Middleware
app.use(cookieParser());
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// Data store helpers
function readJson(filename, defaultValue) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
    return defaultValue;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return defaultValue;
  }
}

function writeJson(filename, data) {
  fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2));
}

function uuidv4() {
  return crypto.randomUUID();
}

// Data stores
let loans = readJson('loans.json', []);
let payments = readJson('payments.json', []);
let incomes = readJson('incomes.json', []);
let settings = readJson('settings.json', { projectionMonths: 24 });

// Auth middleware
function requireAuth(req, res, next) {
  if (req.cookies.session) {
    next();
  } else {
    res.status(401).json({ error: 'No autorizado' });
  }
}

// Auth routes
app.get('/auth/microsoft', (req, res) => {
  const clientId = process.env.MS_CLIENT_ID;
  if (!clientId) {
    return res.status(500).send('MS_CLIENT_ID no configurado');
  }
  
  const tenantId = process.env.MS_TENANT_ID || 'common';
  const redirectUri = process.env.MS_REDIRECT_URI || `http://localhost:${PORT}/auth/callback`;
  const scope = encodeURIComponent('openid profile email');
  
  const authUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?` +
    `client_id=${clientId}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_mode=query` +
    `&scope=${scope}` +
    `&state=${uuidv4()}` +
    `&prompt=login`;
  
  res.redirect(authUrl);
});

app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send('Código de autorización faltante');
  }
  
  try {
    const redirectUri = process.env.MS_REDIRECT_URI || `http://localhost:${PORT}/auth/callback`;
    const clientId = process.env.MS_CLIENT_ID;
    const clientSecret = process.env.MS_CLIENT_SECRET;
    const tenantId = process.env.MS_TENANT_ID || 'common';
    
    // Exchange code for token
    const tokenResponse = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });
    
    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token error:', errorText);
      throw new Error('Error al obtener token');
    }
    
    const tokens = await tokenResponse.json();
    
    // Get user info
    const userResponse = await fetch('https://graph.microsoft.com/oidc/userinfo', {
      headers: { 'Authorization': `Bearer ${tokens.access_token}` }
    });
    
    const userInfo = await userResponse.json();
    
    // Create session
    const sessionId = uuidv4();
    const sessions = readJson('sessions.json', {});
    sessions[sessionId] = {
      email: userInfo.email,
      name: userInfo.name,
      createdAt: new Date().toISOString()
    };
    writeJson('sessions.json', sessions);
    
    // Set cookie and redirect
    res.cookie('session', sessionId, { 
      httpOnly: true, 
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    res.redirect('/dashboard.html');
    
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).send('Error de autenticación');
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const sessions = readJson('sessions.json', {});
  const session = sessions[req.cookies.session];
  if (!session) {
    return res.status(401).json({ error: 'Sesión inválida' });
  }
  res.json({ email: session.email, name: session.name });
});

app.post('/api/auth/logout', (req, res) => {
  const sessions = readJson('sessions.json', {});
  delete sessions[req.cookies.session];
  writeJson('sessions.json', sessions);
  res.clearCookie('session');
  res.json({ success: true });
});

// Loan routes
app.get('/api/loans', requireAuth, (req, res) => {
  res.json(loans);
});

app.post('/api/loans', requireAuth, (req, res) => {
  const loan = {
    id: uuidv4(),
    ...req.body,
    createdAt: new Date().toISOString()
  };
  loans.push(loan);
  writeJson('loans.json', loans);
  res.status(201).json(loan);
});

app.put('/api/loans/:id', requireAuth, (req, res) => {
  const index = loans.findIndex(l => l.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Préstamo no encontrado' });
  }
  loans[index] = { ...loans[index], ...req.body };
  writeJson('loans.json', loans);
  res.json(loans[index]);
});

app.delete('/api/loans/:id', requireAuth, (req, res) => {
  const index = loans.findIndex(l => l.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Préstamo no encontrado' });
  }
  loans.splice(index, 1);
  writeJson('loans.json', loans);
  res.status(204).send();
});

// Payment routes
app.get('/api/payments', requireAuth, (req, res) => {
  const { loanId } = req.query;
  const filtered = loanId 
    ? payments.filter(p => p.loanId === loanId)
    : payments;
  res.json(filtered.sort((a, b) => new Date(b.date) - new Date(a.date)));
});

app.post('/api/payments', requireAuth, (req, res) => {
  const payment = {
    id: uuidv4(),
    ...req.body,
    createdAt: new Date().toISOString()
  };
  payments.push(payment);
  writeJson('payments.json', payments);
  res.status(201).json(payment);
});

app.delete('/api/payments/:id', requireAuth, (req, res) => {
  const index = payments.findIndex(p => p.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Pago no encontrado' });
  }
  payments.splice(index, 1);
  writeJson('payments.json', payments);
  res.status(204).send();
});

// Income routes
app.get('/api/incomes', requireAuth, (req, res) => {
  res.json(incomes);
});

app.post('/api/incomes', requireAuth, (req, res) => {
  const income = {
    id: uuidv4(),
    ...req.body,
    createdAt: new Date().toISOString()
  };
  incomes.push(income);
  writeJson('incomes.json', incomes);
  res.status(201).json(income);
});

app.put('/api/incomes/:id', requireAuth, (req, res) => {
  const index = incomes.findIndex(i => i.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Ingreso no encontrado' });
  }
  incomes[index] = { ...incomes[index], ...req.body };
  writeJson('incomes.json', incomes);
  res.json(incomes[index]);
});

app.delete('/api/incomes/:id', requireAuth, (req, res) => {
  const index = incomes.findIndex(i => i.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Ingreso no encontrado' });
  }
  incomes.splice(index, 1);
  writeJson('incomes.json', incomes);
  res.status(204).send();
});

// Settings routes
app.get('/api/settings', requireAuth, (req, res) => {
  res.json(settings);
});

app.put('/api/settings', requireAuth, (req, res) => {
  settings = { ...settings, ...req.body };
  writeJson('settings.json', settings);
  res.json(settings);
});

// Financial calculation helpers
function calculateAmortization(loan, payments = []) {
  const principal = Number(loan.principal || 0);
  const rateAnnual = Number(loan.rateAnnual || 0);
  const termMonths = Number(loan.termMonths || 0);
  const monthlyRate = rateAnnual / 100 / 12;

  const loanPayments = payments
    .filter(p => p.loanId === loan.id)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const schedule = [];
  let balance = principal;
  let currentDate = new Date(loan.startDate);

  let fixedPayment = 0;
  if (loan.system === 'frances') {
    if (monthlyRate > 0 && termMonths > 0) {
      fixedPayment = principal * (monthlyRate * Math.pow(1 + monthlyRate, termMonths)) / 
                     (Math.pow(1 + monthlyRate, termMonths) - 1);
    } else if (termMonths > 0) {
      fixedPayment = principal / termMonths;
    }
  }

  let interestOnlyPayment = 0;
  if (loan.system === 'americano') {
    interestOnlyPayment = principal * monthlyRate;
  }

  for (let month = 1; month <= termMonths; month++) {
    const inGrace = loan.graceType === 'total' && month <= (Number(loan.graceMonths) || 0);
    
    let interest = balance * monthlyRate;
    let principalPayment = 0;
    let totalPayment = 0;

    if (inGrace) {
      totalPayment = interest;
      if (loan.graceCapitalize) {
        balance += interest;
      }
    } else {
      if (loan.system === 'frances') {
        totalPayment = fixedPayment;
        principalPayment = totalPayment - interest;
        balance -= principalPayment;
      } else if (loan.system === 'aleman') {
        principalPayment = principal / termMonths;
        totalPayment = principalPayment + interest;
        balance -= principalPayment;
      } else if (loan.system === 'americano') {
        if (month === termMonths) {
          totalPayment = interest + balance;
          principalPayment = balance;
          balance = 0;
        } else {
          totalPayment = interestOnlyPayment;
        }
      }
    }

    // Apply actual payments for this period
    const periodPayments = loanPayments.filter(p => {
      const pDate = new Date(p.date);
      const monthDiff = (pDate.getFullYear() - currentDate.getFullYear()) * 12 + 
                       (pDate.getMonth() - currentDate.getMonth());
      return monthDiff === 0;
    });
    
    let actualPayment = 0;
    periodPayments.forEach(p => {
      actualPayment += Number(p.amount || 0);
    });

    // Update balance based on actual payment
    if (actualPayment > 0 && !inGrace && loan.system !== 'americano') {
      const excess = actualPayment - interest;
      if (excess > 0) {
        balance -= excess;
      }
    } else if (actualPayment > 0 && loan.system === 'americano' && month === termMonths) {
      balance = 0;
    }

    schedule.push({
      month,
      date: new Date(currentDate).toISOString().split('T')[0],
      scheduledPayment: Math.max(0, Number(totalPayment.toFixed(2))),
      actualPayment: actualPayment > 0 ? Number(actualPayment.toFixed(2)) : 0,
      interest: Math.max(0, Number(interest.toFixed(2))),
      principal: Math.max(0, Number(principalPayment.toFixed(2))),
      balance: Math.max(0, Number(balance.toFixed(2)))
    });

    currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
  }
  
  return schedule;
}

function getCurrentMonthIndex(loan) {
  const start = new Date(loan.startDate);
  const now = new Date();
  return (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
}

app.get('/api/loans/:id/schedule', requireAuth, (req, res) => {
  const loan = loans.find(l => l.id === req.params.id);
  if (!loan) {
    return res.status(404).json({ error: 'Préstamo no encontrado' });
  }
  const schedule = calculateAmortization(loan, payments);
  res.json(schedule);
});

app.get('/api/projection', requireAuth, (req, res) => {
  const months = Number(req.query.months || settings.projectionMonths || 24);
  const projection = [];
  
  const today = new Date();
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();
  
  let cumulativeBalance = 0;
  let criticalMonth = null;
  let minBalance = Infinity;
  
  for (let i = 0; i < months; i++) {
    const monthDate = new Date(currentYear, currentMonth + i, 1);
    const monthStr = monthDate.toISOString().slice(0, 7);
    
    let monthlyIncome = 0;
    incomes.forEach(income => {
      if (income.active) {
        const startDate = new Date(income.startDate);
        const monthDiff = (monthDate.getFullYear() - startDate.getFullYear()) * 12 + 
                         (monthDate.getMonth() - startDate.getMonth());
        if (monthDiff >= 0) monthlyIncome += Number(income.amount || 0);
      }
    });
    
    let monthlyPayments = 0;
    const paymentDetails = [];
    
    loans.forEach(loan => {
      const schedule = calculateAmortization(loan, payments);
      const monthSchedule = schedule[i];
      if (monthSchedule && monthSchedule.balance > 0) {
        const payment = monthSchedule.actualPayment || monthSchedule.scheduledPayment || 0;
        monthlyPayments += payment;
        paymentDetails.push({
          loanId: loan.id,
          loanName: loan.name,
          bank: loan.bank,
          payment: Number(payment.toFixed(2)),
          balance: Number(monthSchedule.balance.toFixed(2))
        });
      }
    });
    
    const netFlow = monthlyIncome - monthlyPayments;
    cumulativeBalance += netFlow;
    
    if (cumulativeBalance < minBalance) {
      minBalance = cumulativeBalance;
      criticalMonth = monthStr;
    }
    
    projection.push({
      month: monthStr,
      income: Number(monthlyIncome.toFixed(2)),
      payments: Number(monthlyPayments.toFixed(2)),
      netFlow: Number(netFlow.toFixed(2)),
      cumulativeBalance: Number(cumulativeBalance.toFixed(2)),
      paymentDetails
    });
  }
  
  res.json({
    projection,
    summary: {
      avgFlow: Number((cumulativeBalance / months).toFixed(2)),
      criticalMonth,
      minBalance: Number(minBalance.toFixed(2)),
      finalBalance: Number(cumulativeBalance.toFixed(2))
    }
  });
});

// Serve dashboard index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Dashboard running on http://localhost:${PORT}`);
  console.log(`Auth: ${process.env.MS_CLIENT_ID ? 'Microsoft Entra ID' : 'disabled (set MS_CLIENT_ID)'}`);
});
