// ===== SIGNATURE PAD SETUP =====
let signaturePad;
let currentAssociation = '';

document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('signature-pad');
  signaturePad = new SignaturePad(canvas, {
    backgroundColor: 'rgb(255, 255, 255)',
    penColor: 'rgb(0, 0, 100)',
    minWidth: 1,
    maxWidth: 2.5
  });
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
});

function resizeCanvas() {
  const canvas = document.getElementById('signature-pad');
  const wrapper = canvas.parentElement;
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  canvas.width = wrapper.offsetWidth * ratio;
  canvas.height = 200 * ratio;
  canvas.style.height = '200px';
  canvas.getContext('2d').scale(ratio, ratio);
  if (signaturePad) signaturePad.clear();
}

function clearSignature() {
  signaturePad.clear();
}

// ===== VIEW NAVIGATION =====

function showView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');
  window.scrollTo(0, 0);
}

function selectAssociation(assoc) {
  currentAssociation = assoc;
  document.getElementById('association').value = assoc;

  const title = document.getElementById('form-title');
  const submitBtn = document.getElementById('btn-submit');

  if (assoc === 'eudicas') {
    title.textContent = 'EUDICAS — Adhesion Form';
    title.className = 'form-title';
    submitBtn.className = 'btn-submit';
  } else {
    title.textContent = 'EUEMOTION — Adhesion Form';
    title.className = 'form-title euemotion';
    submitBtn.className = 'btn-submit euemotion';
  }

  // Apply accent color to inputs
  document.querySelectorAll('.form-group input, .form-group select').forEach(el => {
    el.classList.toggle('euemotion', assoc === 'euemotion');
  });
  document.querySelector('.checkbox-label input').style.accentColor =
    assoc === 'euemotion' ? '#6B2D8B' : '#003399';

  showView('view-form');
  setTimeout(resizeCanvas, 100);
}

function goBack() {
  showView('view-landing');
}

// ===== FORM SUBMISSION =====

async function submitForm() {
  // Remove previous errors
  const existingError = document.querySelector('.error-msg');
  if (existingError) existingError.remove();

  // Validate required fields
  const form = document.getElementById('adhesion-form');
  const requiredFields = form.querySelectorAll('[required]');
  let firstInvalid = null;

  requiredFields.forEach(field => {
    if (!field.value || (field.type === 'checkbox' && !field.checked)) {
      field.style.borderColor = '#c0392b';
      if (!firstInvalid) firstInvalid = field;
    } else {
      field.style.borderColor = '';
    }
  });

  if (firstInvalid) {
    showError('Please fill in all required fields.');
    firstInvalid.focus();
    return;
  }

  // Validate signature
  if (signaturePad.isEmpty()) {
    showError('Please provide your signature before submitting.');
    return;
  }

  // Validate email
  const email = document.getElementById('email').value;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    showError('Please enter a valid email address.');
    document.getElementById('email').focus();
    return;
  }

  // Collect data
  const data = {
    association: currentAssociation,
    representative_name: document.getElementById('representative_name').value.trim(),
    role: document.getElementById('role').value.trim(),
    entity_name: document.getElementById('entity_name').value.trim(),
    address: document.getElementById('address').value.trim(),
    postal_code: document.getElementById('postal_code').value.trim(),
    city: document.getElementById('city').value.trim(),
    country: document.getElementById('country').value,
    email: document.getElementById('email').value.trim(),
    phone: document.getElementById('phone').value.trim(),
    signature: signaturePad.toDataURL('image/png')
  };

  // Show loading
  const submitBtn = document.getElementById('btn-submit');
  submitBtn.disabled = true;
  document.getElementById('loading-overlay').classList.add('active');

  try {
    const response = await fetch('/api/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    const result = await response.json();

    if (response.ok && result.success) {
      showView('view-confirmation');
    } else {
      showError(result.error || 'An error occurred. Please try again.');
    }
  } catch (err) {
    showError('Network error. Please check your connection and try again.');
  } finally {
    submitBtn.disabled = false;
    document.getElementById('loading-overlay').classList.remove('active');
  }
}

function showError(message) {
  // Remove existing error
  const existing = document.querySelector('.error-msg');
  if (existing) existing.remove();

  const errorDiv = document.createElement('div');
  errorDiv.className = 'error-msg visible';
  errorDiv.textContent = message;

  const submitSection = document.querySelector('.submit-section');
  submitSection.parentNode.insertBefore(errorDiv, submitSection);

  errorDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function resetForm() {
  document.getElementById('adhesion-form').reset();
  signaturePad.clear();
  currentAssociation = '';
  showView('view-landing');
}
