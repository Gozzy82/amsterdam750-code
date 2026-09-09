const USE_MSAL = !!window.APP_CONFIG.msalClientId;
let msalInstance = null;
const ADMIN_API_SCOPE = USE_MSAL ? `api://${window.APP_CONFIG.msalClientId}/access_as_user` : '';

if (USE_MSAL) {
  msalInstance = new msal.PublicClientApplication({
    auth: {
      clientId: window.APP_CONFIG.msalClientId,
      authority: `https://login.microsoftonline.com/${window.APP_CONFIG.msalTenantId}`,
      redirectUri: `${location.origin}/admin/`,
    },
    cache: { cacheLocation: 'sessionStorage', storeAuthStateInCookie: false },
  });
}

async function getToken() {
  const accounts = msalInstance.getAllAccounts();
  if (!accounts.length) return null;

  try {
    const result = await msalInstance.acquireTokenSilent({
      scopes: [ADMIN_API_SCOPE],
      account: accounts[0],
    });
    return result.accessToken;
  } catch {
    return null;
  }
}

async function getHeaders() {
  const headers = {};
  if (USE_MSAL) {
    const token = await getToken();
    if (!token) throw new Error('Geen geldig token. Log opnieuw in.');
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function sendInvites() {
  const headers = await getHeaders();
  const response = await fetch(window.APP_CONFIG.apiSendInvites, { headers });
  if (response.status === 401 || response.status === 403) throw new Error('Toegang geweigerd.');
  if (!response.ok) throw new Error(`Serverfout: ${response.status}`);
  return response.json();
}

async function resetPreRegistrations() {
  const headers = await getHeaders();
  headers['Content-Type'] = 'application/json';
  const endpoint = window.APP_CONFIG.apiResetPreregistrations || 'http://localhost:7072/api/reset-preregistrations';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ confirm: true }),
  });
  if (response.status === 401 || response.status === 403) throw new Error('Toegang geweigerd.');
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error || `Serverfout: ${response.status}`);
  return payload;
}

async function deletePreRegistrations() {
  const headers = await getHeaders();
  headers['Content-Type'] = 'application/json';
  const endpoint = window.APP_CONFIG.apiDeletePreregistrations || 'http://localhost:7072/api/delete-preregistrations';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ confirm: true }),
  });
  if (response.status === 401 || response.status === 403) throw new Error('Toegang geweigerd.');
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error || `Serverfout: ${response.status}`);
  return payload;
}

async function loadStats() {
  const headers = await getHeaders();
  const response = await fetch(window.APP_CONFIG.apiStats, { headers });
  if (response.status === 401 || response.status === 403) throw new Error('Toegang geweigerd.');
  if (!response.ok) throw new Error(`Serverfout: ${response.status}`);
  return response.json();
}

function showStats(data) {
  const today = new Date().toISOString().slice(0, 10);
  const todayEntry = data.dailyCounts.find((entry) => entry.date === today);

  document.getElementById('c-total').textContent = data.totalRegistrations;
  document.getElementById('c-today').textContent = todayEntry?.count ?? 0;
  document.getElementById('c-challenge').textContent = data.counters.challenge_shown ?? 0;
  document.getElementById('c-passed').textContent = data.counters.challenge_passed ?? 0;
  document.getElementById('c-honeypot').textContent = data.counters.blocked_honeypot ?? 0;

  document.getElementById('chart').innerHTML = '';
  renderChart(data.dailyCounts);

  document.getElementById('last-updated').textContent = `Bijgewerkt: ${new Date().toLocaleTimeString('nl-NL')}`;
}

function renderChart(days) {
  document.getElementById('chart-loading').hidden = true;

  const container = document.getElementById('chart');
  const widthWithMargins = container.clientWidth || 800;
  const margin = { top: 8, right: 16, bottom: 62, left: 36 };
  const width = widthWithMargins - margin.left - margin.right;
  const height = 240 - margin.top - margin.bottom;

  const svg = d3.select('#chart')
    .append('svg')
    .attr('width', widthWithMargins)
    .attr('height', 240)
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  const x = d3.scaleBand()
    .domain(days.map((entry) => entry.date))
    .range([0, width])
    .padding(0.25);

  const maxCount = d3.max(days, (entry) => entry.count) || 1;
  const y = d3.scaleLinear()
    .domain([0, maxCount])
    .nice()
    .range([height, 0]);

  svg.append('g')
    .attr('class', 'grid')
    .call(d3.axisLeft(y).ticks(4).tickSize(-width).tickFormat(''))
    .select('.domain').remove();

  svg.append('g')
    .attr('class', 'axis')
    .attr('transform', `translate(0,${height})`)
    .call(
      d3.axisBottom(x)
        .tickValues(days.filter((_, index) => index % 5 === 0).map((entry) => entry.date)),
    )
    .selectAll('text')
    .attr('transform', 'rotate(-35)')
    .style('text-anchor', 'end')
    .attr('dy', '.35em')
    .attr('dx', '-.5em');

  svg.append('g')
    .attr('class', 'axis')
    .call(d3.axisLeft(y).ticks(4).tickFormat(d3.format('d')));

  svg.selectAll('.bar')
    .data(days)
    .join('rect')
    .attr('class', 'bar')
    .attr('x', (entry) => x(entry.date))
    .attr('y', (entry) => y(entry.count))
    .attr('width', x.bandwidth())
    .attr('height', (entry) => height - y(entry.count))
    .attr('rx', 3)
    .append('title')
    .text((entry) => `${entry.date}: ${entry.count} registratie${entry.count !== 1 ? 's' : ''}`);
}

async function showDashboard(displayName) {
  document.getElementById('auth-panel').hidden = true;
  document.getElementById('stats-panel').classList.add('visible');
  if (displayName) {
    document.getElementById('user-info').textContent = displayName;
    document.getElementById('logout-btn').hidden = false;
  }

  try {
    const data = await loadStats();
    showStats(data);
  } catch (error) {
    const errorElement = document.getElementById('auth-error');
    errorElement.textContent = error.message;
    errorElement.hidden = false;
    document.getElementById('auth-panel').hidden = false;
    document.getElementById('stats-panel').classList.remove('visible');
  }
}

document.getElementById('send-invites-btn').addEventListener('click', async () => {
  try {
    const result = await sendInvites();
    alert(`Uitnodigingen verstuurd: ${JSON.stringify(result)}`);
  } catch (error) {
    alert(`Fout bij versturen uitnodigingen: ${error.message}`);
  }
});

document.getElementById('reset-preregistrations-btn').addEventListener('click', async () => {
  const confirmed = window.confirm('Weet je zeker dat je de invite-status wilt resetten voor alle pre-registraties?');
  if (!confirmed) return;

  try {
    const result = await resetPreRegistrations();
    alert(`Invite-status gereset voor ${result.reset} pre-registraties.`);
    const data = await loadStats();
    showStats(data);
  } catch (error) {
    alert(`Fout bij resetten: ${error.message}`);
  }
});

document.getElementById('delete-preregistrations-btn').addEventListener('click', async () => {
  const confirmed = window.confirm('Weet je zeker dat je ALLE pre-registraties wilt verwijderen? Dit kan niet ongedaan worden gemaakt!');
  if (!confirmed) return;

  try {
    const result = await deletePreRegistrations();
    const totalTables = result.reinitializedTables?.length || 0;
    alert(`${totalTables} tabellen opnieuw geïnitialiseerd.`);
    const data = await loadStats();
    showStats(data);
  } catch (error) {
    alert(`Fout bij verwijderen: ${error.message}`);
  }
});

document.getElementById('login-btn').addEventListener('click', async () => {
  if (!USE_MSAL || !msalInstance) return;
  const errorElement = document.getElementById('auth-error');
  errorElement.hidden = true;

  try {
    await msalInstance.loginRedirect({
      scopes: [ADMIN_API_SCOPE],
    });
  } catch (error) {
    errorElement.textContent = error.message || 'Login mislukt.';
    errorElement.hidden = false;
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  const accounts = msalInstance.getAllAccounts();
  await msalInstance.logoutRedirect({ account: accounts[0] });
});

document.getElementById('refresh-btn').addEventListener('click', async () => {
  try {
    const data = await loadStats();
    showStats(data);
  } catch {
    document.getElementById('auth-panel').hidden = false;
    document.getElementById('stats-panel').classList.remove('visible');
  }
});

async function init() {
  if (!USE_MSAL) {
    document.getElementById('login-btn').hidden = true;
    await showDashboard(null);
    return;
  }

  await msalInstance.initialize();
  try {
    const redirectResult = await msalInstance.handleRedirectPromise();
    if (redirectResult) {
      await showDashboard(redirectResult.account.name || redirectResult.account.username);
      return;
    }
  } catch (error) {
    const errorElement = document.getElementById('auth-error');
    errorElement.textContent = error.message || 'Login mislukt.';
    errorElement.hidden = false;
  }

  const accounts = msalInstance.getAllAccounts();
  if (accounts.length > 0) {
    await showDashboard(accounts[0].name || accounts[0].username);
  }
}

init();
