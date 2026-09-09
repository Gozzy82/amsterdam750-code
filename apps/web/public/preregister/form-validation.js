
const ensureId = (el, prefix = 'field') => {
  if (!el.id) el.id = `${prefix}-${crypto.randomUUID()}`;
  return el.id;
};

const fixEl = (el, message) => {
  // We willen aria op de echte input zetten (ook bij checkbox)
  const inputEl = el;

  if (el?.type === 'checkbox') {
    el = el.closest('.consent-field') || el.closest('label'); // visuele anchor: container
    message = 'Je moet toestemming geven om door te gaan';
  }

  return { el, inputEl, message };
};

const addDescribedBy = (inputEl, idToAdd) => {
  if (!inputEl) return;

  const current = (inputEl.getAttribute('aria-describedby') || '')
    .split(/\s+/)
    .filter(Boolean);

  if (!current.includes(idToAdd)) current.push(idToAdd);

  inputEl.setAttribute('aria-describedby', current.join(' '));
};

const removeDescribedBy = (inputEl, idToRemove) => {
  if (!inputEl) return;

  const next = (inputEl.getAttribute('aria-describedby') || '')
    .split(/\s+/)
    .filter(Boolean)
    .filter(id => id !== idToRemove);

  if (next.length) inputEl.setAttribute('aria-describedby', next.join(' '));
  else inputEl.removeAttribute('aria-describedby');
};

const showError = (el, message) => {
  ({ el, inputEl, message } = fixEl(el, message));

  // Basis aria op het input element
  inputEl?.setAttribute('aria-invalid', 'true');

  // We zoeken/plaatsen errorDiv naast de "anchor" (label of input)
  let sibling = el?.nextElementSibling;
  let errorDiv =
    (sibling?.tagName === 'DIV' && sibling.classList.contains('error'))
      ? sibling
      : null;

  // Zorg dat input een stabiele id heeft (handig voor error-id en evt. label-for)
  const baseId = ensureId(inputEl, 'field');
  const errorId = `${baseId}-error`;

  if (!errorDiv) {
    errorDiv = document.createElement('div');
    errorDiv.className = 'error';
    el.insertAdjacentElement('afterend', errorDiv);
  }

  // Geef errorDiv een id + role zodat screenreaders het als melding behandelen
  errorDiv.id = errorId;
  errorDiv.setAttribute('role', 'alert');
  errorDiv.textContent = message;
  errorDiv.style.display = 'block';

  // Koppel foutmelding aan het inputveld
  addDescribedBy(inputEl, errorId);
};

const clearError = (el) => {
  const inputEl = el?.type === 'checkbox' ? el : el;
  const baseId = inputEl?.id;

  // aria-invalid resetten
  inputEl?.removeAttribute('aria-invalid');

  // errorDiv vinden op basis van id-conventie (als input al een id had)
  if (baseId) {
    const errorId = `${baseId}-error`;
    const errorDiv = document.getElementById(errorId);
    if (errorDiv) {
      errorDiv.style.display = 'none';
    }
    removeDescribedBy(inputEl, errorId);
    return;
  }

  // fallback: als er geen id is, probeer sibling te pakken 
  const anchor = (el?.type === 'checkbox') ? el.closest('label') : el;
  const sib = anchor?.nextElementSibling;
  if (sib?.tagName === 'DIV' && sib.classList.contains('error')) {
    sib.style.display = 'none';
  }
};

const handleInvalid = (e) => {
    e.preventDefault();
    const el = e.target;
    if (el.validity.valueMissing){
        showError(el, `${el.placeholder} is verplicht`);
    }
    else if (el.validity.typeMismatch && el.type === 'email') showError(el, 'Voer een geldig e-mailadres in');
    else if (el.validity.patternMismatch && el.name === 'phone') showError(el, 'Telefoonnummer met +31 toevoegen (+31612345678)');
    else  showError(el, 'Ongeldige invoer');
};
const handleInput = (e) => {
    const el = e.target;
    clearError(el);
};

const form = document.getElementById('preForm');
if(!form){
    throw new Error('Formulier met id "preForm" niet gevonden (script niet geladen met defer?)');
}
const sendButton = document.getElementById('sendbutton');
if(!sendButton){
    throw new Error('Verstuurknop met id "sendbutton" niet gevonden');
}

const setSubmittingState = (isSubmitting) => {
  sendButton.disabled = isSubmitting;
  sendButton.setAttribute('aria-disabled', isSubmitting ? 'true' : 'false');
  const statusEl = document.getElementById('sendingStatus');
  if (statusEl) {
    statusEl.hidden = !isSubmitting;
    statusEl.textContent = isSubmitting ? 'Verzoek wordt verstuurd…' : '';
  }
};

// Apply API URL from config (set before htmx processes DOMContentLoaded)
const _apiUrl = window.APP_CONFIG?.apiPreregister;
if (_apiUrl) {
    form.setAttribute('action', _apiUrl);
    form.setAttribute('hx-post', _apiUrl);
} else {
    console.warn('APP_CONFIG.apiPreregister is not set — form will not submit. Load config.js before this script.');
}

// ── Turnstile (always-on invisible widget) ────────────────────────────────────
//
// The submit button stays disabled until Turnstile resolves (usually within
// page-load time). After each request the widget is reset so a fresh token is
// obtained for the next submission attempt.

let _cfToken = null;
let _turnstileWidgetId = null;
let _pendingSubmitAfterToken = false;

const _setSubmitReady = (ready) => {
  sendButton.disabled = !ready;
  sendButton.setAttribute('aria-disabled', ready ? 'false' : 'true');
};

const _reportTurnstileIssue = (message) => {
  console.warn(message);
  const errorContainer = document.getElementById('serverError');
  if (errorContainer) {
    errorContainer.textContent = message;
    errorContainer.classList.add('error');
    errorContainer.hidden = false;
    errorContainer.style.display = 'block';
  }
  _setSubmitReady(false);
};

// Keep button disabled until Turnstile is rendered/configured.
_setSubmitReady(false);

const _onTurnstileToken = (token) => {
  _cfToken = token;
  _setSubmitReady(true);
  if (_pendingSubmitAfterToken) {
    _pendingSubmitAfterToken = false;
    if (typeof form.requestSubmit === 'function') form.requestSubmit(sendButton);
    else htmx.trigger(form, 'submit');
  }
};

const _onTurnstileExpired = () => {
  _cfToken = null;
};

const _onTurnstileError = (errorCode) => {
  _cfToken = null;
  _pendingSubmitAfterToken = false;
  setSubmittingState(false);

  if (['110200', '400020'].includes(String(errorCode))) {
    _reportTurnstileIssue(
      'Pre-registreren is tijdelijk niet mogelijk, omdat dit webadres niet goed is ingesteld in Cloudflare Turnstile. Neem contact op met de beheerder.'
    );
    return;
  }

  _reportTurnstileIssue(
    'De Cloudflare Turnstile-spambeveiliging kon niet worden geladen. Probeer de pagina opnieuw te laden. Blijft dit probleem bestaan, neem dan contact op met de beheerder.'
  );
  console.warn(`Turnstile error code: ${errorCode || 'unknown'}`);
};

const _executeTurnstile = () => {
  if (_turnstileWidgetId !== null && window.turnstile) {
    _setSubmitReady(false);
    if (window.turnstile.reset) window.turnstile.reset(_turnstileWidgetId);
    if (window.turnstile.execute) window.turnstile.execute(_turnstileWidgetId);
  }
};

const _resetTurnstile = () => {
  _cfToken = null;
  _pendingSubmitAfterToken = false;
  if (_turnstileWidgetId !== null && window.turnstile?.reset) {
    window.turnstile.reset(_turnstileWidgetId);
  }
};

const _initTurnstile = (attempt = 0) => {
  if (_turnstileWidgetId !== null) return;

  const sitekey = window.APP_CONFIG?.turnstileSitekey;
  if (!sitekey) {
    _reportTurnstileIssue('TURNSTILE_SITEKEY ontbreekt. De knop Versturen blijft grijs totdat de Turnstile-sitekey is ingesteld.');
    return;
  }

  if (!window.turnstile?.render) {
    if (attempt >= 20) {
      _reportTurnstileIssue('Cloudflare Turnstile laadt niet. Controleer CSP, netwerktoegang en of https://challenges.cloudflare.com/turnstile/v0/api.js bereikbaar is. De knop Versturen blijft grijs totdat Turnstile een token levert.');
      return;
    }
    window.setTimeout(() => _initTurnstile(attempt + 1), 100);
    return;
  }

  const container = document.getElementById('turnstile-widget');
  if (!container) return;

  _turnstileWidgetId = window.turnstile.render(container, {
    sitekey,
    theme: 'light',
    appearance: 'interaction-only',
    callback: _onTurnstileToken,
    'expired-callback': _onTurnstileExpired,
    'error-callback': _onTurnstileError,
  });
  _setSubmitReady(true);
};

_initTurnstile();

form.querySelectorAll('input,textarea,select').forEach(el=>{
    el.addEventListener('invalid', handleInvalid);
    el.addEventListener('input', handleInput);
});

// Inject Turnstile token into every htmx request from this form.
// Abort the request if no token is available (race condition guard).
form.addEventListener('htmx:configRequest', (evt) => {
  if (!_cfToken) {
    evt.preventDefault();
    return;
  }
  evt.detail.parameters['cf-turnstile-response'] = _cfToken;
});

// Invisible Turnstile flow: on submit, execute Turnstile first when no token exists.
form.addEventListener('submit', (evt) => {
  if (_turnstileWidgetId === null) return;
  if (_cfToken) return;
  evt.preventDefault();
  _pendingSubmitAfterToken = true;
  _executeTurnstile();
});

form.addEventListener('htmx:beforeRequest', function() {
  setSubmittingState(true);
});

document.body.addEventListener('htmx:afterRequest', function(evt) {
  if (evt?.detail?.elt !== form) return;
  setSubmittingState(false);
  // Reset widget so a fresh token is ready for the next submission attempt.
  _resetTurnstile();
});

// Show server-provided HTML responses for non-2xx statuses (htmx doesn't swap them by default)
document.body.addEventListener('htmx:responseError', function(evt){
  if (evt?.detail?.elt !== form) return;
  setSubmittingState(false);
  try {
    const xhr = evt.detail && evt.detail.xhr;
    const errorContainer = document.getElementById('serverError');
    errorContainer.innerHTML = xhr.responseText;
    errorContainer.style.display = 'block';
  } catch (e) { /* ignore */
    console.error('Fout bij tonen server error message', e);
   }
});