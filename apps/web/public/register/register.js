const form = document.getElementById('registerForm');
const urlToken = new URLSearchParams(location.search).get('token');

// Apply API URL from config (set before htmx processes DOMContentLoaded)
const _apiUrl = window.APP_CONFIG?.apiRegister;
if (_apiUrl && form) {
    form.setAttribute('hx-post', _apiUrl);
} else if (form) {
    console.warn('APP_CONFIG.apiRegister is not set — form will not submit. Load config.js before this script.');
}

const getSubmitButton = (targetForm) => targetForm?.querySelector('button[type="submit"], input[type="submit"]');
const isSmsRequestForm = (targetForm) => {
  return Boolean(targetForm.querySelector('input[name="phone"]')) && !targetForm.querySelector('input[name="otp"]');
};

let turnstileToken = null;
let turnstileWidgetId = null;
let pendingSubmitAfterToken = false;

const setRegisterSubmitReady = (ready) => {
  const submitButton = getSubmitButton(form);
  if (!submitButton) return;
  submitButton.disabled = !ready;
  submitButton.setAttribute('aria-disabled', ready ? 'false' : 'true');
};

const reportTurnstileIssue = (message) => {
  console.warn(message);
  const result = document.getElementById('result');
  if (result) {
    result.textContent = message;
    result.classList.add('server-error');
  }
  setRegisterSubmitReady(false);
};

const resetTurnstile = () => {
  turnstileToken = null;
  pendingSubmitAfterToken = false;
  if (turnstileWidgetId !== null && window.turnstile?.reset) {
    window.turnstile.reset(turnstileWidgetId);
  }
};

const initTurnstile = (attempt = 0) => {
  if (!form || turnstileWidgetId !== null) return;

  const sitekey = window.APP_CONFIG?.turnstileSitekey;
  if (!sitekey) {
    reportTurnstileIssue('TURNSTILE_SITEKEY ontbreekt. Registreren is tijdelijk niet mogelijk.');
    return;
  }

  if (!window.turnstile?.render) {
    if (attempt >= 20) {
      reportTurnstileIssue('De Cloudflare Turnstile-spambeveiliging kon niet worden geladen. Ververs de pagina en probeer het opnieuw.');
      return;
    }
    window.setTimeout(() => initTurnstile(attempt + 1), 100);
    return;
  }

  const container = document.getElementById('turnstile-widget');
  if (!container) return;

  turnstileWidgetId = window.turnstile.render(container, {
    sitekey,
    theme: 'light',
    appearance: 'interaction-only',
    callback: (token) => {
      turnstileToken = token;
      setRegisterSubmitReady(true);
      if (pendingSubmitAfterToken) {
        pendingSubmitAfterToken = false;
        if (typeof form.requestSubmit === 'function') form.requestSubmit(getSubmitButton(form));
        else htmx.trigger(form, 'submit');
      }
    },
    'expired-callback': () => {
      turnstileToken = null;
    },
    'error-callback': (errorCode) => {
      turnstileToken = null;
      pendingSubmitAfterToken = false;
      setSubmittingState(form, false);

      if (['110200', '400020'].includes(String(errorCode))) {
        reportTurnstileIssue('Registreren is tijdelijk niet mogelijk, omdat dit webadres niet goed is ingesteld in Cloudflare Turnstile.');
        return;
      }

      reportTurnstileIssue('De Cloudflare Turnstile-spambeveiliging kon niet worden geladen. Ververs de pagina en probeer het opnieuw.');
      console.warn(`Turnstile error code: ${errorCode || 'unknown'}`);
    },
  });
  setRegisterSubmitReady(true);
};

const setSubmittingState = (targetForm, submitting) => {
  const submitButton = getSubmitButton(targetForm);
  if (!submitButton) return;

  if (submitting) {
    if (targetForm.dataset.submitting === 'true') return;

    targetForm.dataset.submitting = 'true';
    targetForm.dataset.submitWasDisabled = String(submitButton.disabled);
    targetForm.dataset.submitLabel = submitButton.tagName === 'BUTTON' ? submitButton.textContent : submitButton.value;
    targetForm.setAttribute('aria-busy', 'true');
    submitButton.disabled = true;

    if (submitButton.tagName === 'BUTTON' && isSmsRequestForm(targetForm)) {
      submitButton.textContent = 'Even geduld...';
    } else if (submitButton.tagName === 'INPUT') {
      submitButton.value = 'Bezig...';
    }

    if (isSmsRequestForm(targetForm)) {
      const result = document.getElementById('result');
      if (result) {
        result.classList.remove('server-error');
        result.innerHTML = "<p class='hint' role='status' aria-live='polite'>Even geduld, we verwerken je aanvraag.</p>";
      }
    }

    return;
  }

  if (targetForm.dataset.submitting !== 'true') return;

  targetForm.dataset.submitting = 'false';
  targetForm.removeAttribute('aria-busy');

  const previousDisabled = targetForm.dataset.submitWasDisabled === 'true';
  submitButton.disabled = previousDisabled;

  if (submitButton.tagName === 'BUTTON') {
    submitButton.textContent = targetForm.dataset.submitLabel || submitButton.textContent;
  } else if (submitButton.tagName === 'INPUT') {
    submitButton.value = targetForm.dataset.submitLabel || submitButton.value;
  }
};

const showError = (input, message) => {
  input.setAttribute('aria-invalid', 'true');
  const errorId = `${input.id}-error`;
  let errorDiv = document.getElementById(errorId);
  if (!errorDiv) {
    errorDiv = document.createElement('div');
    errorDiv.id = errorId;
    errorDiv.className = 'error';
    errorDiv.setAttribute('role', 'alert');
    input.insertAdjacentElement('afterend', errorDiv);
  }
  errorDiv.textContent = message;
  errorDiv.style.display = 'block';
  const described = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
  if (!described.includes(errorId)) input.setAttribute('aria-describedby', [...described, errorId].join(' '));
};

const clearError = (input) => {
  input.removeAttribute('aria-invalid');
  const errorId = `${input.id}-error`;
  const errorDiv = document.getElementById(errorId);
  if (errorDiv) errorDiv.style.display = 'none';
};

const applyValidation = (root) => {
  root.querySelectorAll('input:not([type="hidden"])').forEach((input) => {
    input.addEventListener('invalid', (e) => {
      e.preventDefault();
      if (e.target.validity.valueMissing) {
        showError(e.target, `${e.target.placeholder || e.target.name} is verplicht`);
      } else if (e.target.validity.patternMismatch && e.target.name === 'phone') {
        showError(e.target, 'Voer een geldig telefoonnummer in met landcode (+31612345678)');
      } else if (e.target.validity.patternMismatch && e.target.name === 'otp') {
        showError(e.target, 'Voer de 6-cijferige code in die je per sms hebt ontvangen');
      } else {
        showError(e.target, 'Ongeldige invoer');
      }
    });
    input.addEventListener('input', (e) => clearError(e.target));
  });
};

const initOtpForm = (otpForm) => {
  if (!otpForm || otpForm.dataset.otpInitialized === 'true') return;

  const codeInput = otpForm.querySelector('.otp-code-input');
  const inputs = Array.from(otpForm.querySelectorAll('.otp-code-group'));
  const hiddenInput = otpForm.querySelector('#otp');
  const submitButton = otpForm.querySelector('#otp-submit');
  if (!codeInput || !inputs.length || !hiddenInput || !submitButton) return;

  otpForm.dataset.otpInitialized = 'true';
  let allSelected = false;

  const digitsOnly = (value) => value.replace(/\D/g, '');
  const getCode = () => inputs.map((input) => input.value).join('');

  const updateOtpCode = () => {
    inputs.forEach((input) => {
      input.classList.toggle('complete', input.value.length === 2);
    });

    const code = getCode();
    hiddenInput.value = code;
    submitButton.disabled = !/^\d{6}$/.test(code);
  };

  const cancelSelectAll = () => {
    allSelected = false;
    codeInput.classList.remove('select-all');
  };

  const selectAllCode = () => {
    allSelected = true;
    codeInput.classList.add('select-all');
    inputs[0].focus({ preventScroll: true });
  };

  const clearCode = ({ focusFirst = true } = {}) => {
    inputs.forEach((input) => {
      input.value = '';
    });

    cancelSelectAll();
    updateOtpCode();

    if (focusFirst) inputs[0].focus();
  };

  const focusInput = (index, select = false) => {
    const input = inputs[index];
    if (!input) return;
    input.focus();
    if (select) input.select();
  };

  const fillCode = (value) => {
    const digits = digitsOnly(value).slice(0, 6);

    inputs.forEach((input, index) => {
      const start = index * 2;
      input.value = digits.slice(start, start + 2);
    });

    cancelSelectAll();
    updateOtpCode();

    const incompleteIndex = inputs.findIndex((input) => input.value.length < 2);
    if (incompleteIndex !== -1) {
      focusInput(incompleteIndex);
    } else {
      focusInput(inputs.length - 1);
      inputs[inputs.length - 1].setSelectionRange(2, 2);
    }
  };

  const replaceAllWithDigit = (digit) => {
    clearCode({ focusFirst: false });
    inputs[0].value = digit;
    updateOtpCode();
    focusInput(0);
    inputs[0].setSelectionRange(1, 1);
  };

  inputs.forEach((input, index) => {
    input.addEventListener('focus', () => {
      if (!allSelected) input.select();
    });

    input.addEventListener('mousedown', () => {
      if (allSelected) cancelSelectAll();
    });

    input.addEventListener('input', (event) => {
      const digits = digitsOnly(event.target.value);

      if (allSelected) {
        clearCode({ focusFirst: false });
        fillCode(digits);
        return;
      }

      if (digits.length > 2) {
        fillCode(digits);
        return;
      }

      input.value = digits.slice(0, 2);
      updateOtpCode();

      if (input.value.length === 2 && index < inputs.length - 1) {
        focusInput(index + 1);
      }
    });

    input.addEventListener('keydown', (event) => {
      const key = event.key;
      const selectAllShortcut = (event.ctrlKey || event.metaKey) && key.toLowerCase() === 'a';

      if (selectAllShortcut) {
        event.preventDefault();
        selectAllCode();
        return;
      }

      if (allSelected && (key === 'Backspace' || key === 'Delete')) {
        event.preventDefault();
        clearCode();
        return;
      }

      if (allSelected && /^\d$/.test(key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        replaceAllWithDigit(key);
        return;
      }

      if (allSelected && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) {
        cancelSelectAll();
      }

      if (key === 'Backspace' && input.value === '' && index > 0) {
        event.preventDefault();
        const previousInput = inputs[index - 1];
        previousInput.value = previousInput.value.slice(0, -1);
        updateOtpCode();
        focusInput(index - 1);
        previousInput.setSelectionRange(previousInput.value.length, previousInput.value.length);
        return;
      }

      if (key === 'ArrowLeft' && input.selectionStart === 0 && index > 0) {
        event.preventDefault();
        focusInput(index - 1);
        const previousInput = inputs[index - 1];
        previousInput.setSelectionRange(previousInput.value.length, previousInput.value.length);
        return;
      }

      if (key === 'ArrowRight' && input.selectionStart === input.value.length && index < inputs.length - 1) {
        event.preventDefault();
        focusInput(index + 1);
        inputs[index + 1].setSelectionRange(0, 0);
      }
    });

    input.addEventListener('paste', (event) => {
      event.preventDefault();
      const pastedValue = event.clipboardData.getData('text');
      fillCode(pastedValue);
    });
  });

  otpForm.addEventListener('keydown', (event) => {
    const selectAllShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a';
    if (selectAllShortcut && document.activeElement === submitButton) {
      event.preventDefault();
      selectAllCode();
    }
  });

  otpForm.addEventListener('submit', () => {
    updateOtpCode();
  });

  updateOtpCode();
  inputs[0].focus();
};

const getRequestForm = (evt) => {
  const triggerElement = evt.detail && evt.detail.elt;
  if (triggerElement && triggerElement.closest) {
    const closestForm = triggerElement.closest('form');
    if (closestForm) return closestForm;
  }

  const eventTarget = evt.target;
  if (eventTarget instanceof HTMLFormElement) return eventTarget;
  if (eventTarget && eventTarget.closest) return eventTarget.closest('form');

  return null;
};

const supportsErrorSwap = (requestForm) => {
  return Boolean(requestForm) && (requestForm.id === 'registerForm' || requestForm.id === 'verification-form');
};

let verificationCodeReloadTimer;

const getReloadAfterMs = (xhr) => {
  if (!xhr?.responseText) return null;

  const fragment = document.createElement('div');
  fragment.innerHTML = xhr.responseText;
  const reloadTarget = fragment.querySelector('[data-reload-after-ms]');
  if (!reloadTarget) return null;

  const reloadDelayMs = Number.parseInt(reloadTarget.getAttribute('data-reload-after-ms') || '', 10);
  return Number.isFinite(reloadDelayMs) && reloadDelayMs >= 0 ? reloadDelayMs : null;
};

// Pre-fill token from URL (?token=...)
if (urlToken) {
  document.getElementById('token').value = urlToken;
} else if (form) {
  form.innerHTML = "<p class='error'>Ongeldige uitnodigingslink. Controleer de link in je e-mail.</p>";
}

applyValidation(document);
initOtpForm(document.getElementById('verification-form'));
initTurnstile();

if (form) {
  form.addEventListener('htmx:configRequest', (evt) => {
    if (!turnstileToken) {
      evt.preventDefault();
      return;
    }
    evt.detail.parameters['cf-turnstile-response'] = turnstileToken;
  });

  form.addEventListener('submit', (evt) => {
    if (turnstileWidgetId === null || turnstileToken) return;
    evt.preventDefault();
    pendingSubmitAfterToken = true;
    setRegisterSubmitReady(false);
    if (window.turnstile?.reset) window.turnstile.reset(turnstileWidgetId);
    if (window.turnstile?.execute) window.turnstile.execute(turnstileWidgetId);
  });
}

document.body.addEventListener('submit', (evt) => {
  const targetForm = evt.target;
  if (!(targetForm instanceof HTMLFormElement)) return;
  setSubmittingState(targetForm, true);
}, true);

document.body.addEventListener('htmx:beforeRequest', (evt) => {
  const triggerElement = evt.detail && evt.detail.elt;
  if (!triggerElement || !triggerElement.closest) return;
  setSubmittingState(triggerElement.closest('form'), true);
});

document.body.addEventListener('htmx:afterRequest', (evt) => {
  const triggerElement = evt.detail && evt.detail.elt;
  if (!triggerElement || !triggerElement.closest) return;
  const requestForm = triggerElement.closest('form');
  setSubmittingState(requestForm, false);
  if (requestForm?.id === 'registerForm') resetTurnstile();
});

// Ensure non-2xx responses are still swapped into #result
document.body.addEventListener('htmx:beforeSwap', (evt) => {
  const result = document.getElementById('result');
  const requestForm = getRequestForm(evt);
  const xhr = evt.detail && evt.detail.xhr;
  if (!xhr || !supportsErrorSwap(requestForm) || xhr.status < 400) return;

  const reloadDelayMs = getReloadAfterMs(xhr);
  if (reloadDelayMs !== null) {
    clearTimeout(verificationCodeReloadTimer);
    verificationCodeReloadTimer = window.setTimeout(() => {
      location.reload();
    }, reloadDelayMs);
  }

  evt.detail.shouldSwap = true;
  evt.detail.isError = false;

  if (requestForm.id === 'registerForm' && result) {
    evt.detail.target = result;
    result.removeAttribute('hidden');
    result.classList.add('server-error');
  }
});

// Re-apply validation listeners and initialize OTP behavior after htmx swaps
document.body.addEventListener('htmx:afterSwap', (evt) => {
  const newForm = evt.srcElement;
  const result = document.getElementById('result');
  const xhr = evt.detail && evt.detail.xhr;
  if (result && xhr && xhr.status < 400) result.classList.remove('server-error');
  if (newForm) {
    applyValidation(newForm);
    initOtpForm(newForm);
    const otpInput = newForm.querySelector('.otp-code-group, #otp');
    if (otpInput) otpInput.focus();
  }
});

// Show server HTML from non-2xx responses (htmx does not swap these by default)
document.body.addEventListener('htmx:responseError', (evt) => {
  const result = document.getElementById('result');
  const requestForm = getRequestForm(evt);
  const xhr = evt.detail && evt.detail.xhr;
  if (!result || !xhr) return;
  if (!requestForm || requestForm.id !== 'registerForm') return;
  result.classList.add('server-error');
  result.innerHTML = xhr.responseText || "<p class='error'>Onverwachte fout, probeer later opnieuw.</p>";
});

// Handle transport-level failures where no response body is available
document.body.addEventListener('htmx:sendError', () => {
  const result = document.getElementById('result');
  if (!result) return;
  result.classList.add('server-error');
  result.innerHTML = "<p class='error'>Verbinding met de server mislukt. Controleer of de public API draait op localhost:7071 en dat CORS is toegestaan.</p>";
});
