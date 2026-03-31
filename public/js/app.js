// ===== SIGNATURE PAD SETUP =====
let signaturePad;
let currentAssociation = '';

// State for sequential flow (Improvement 3)
let firstSignatureData = null;   // personal data from first sign
let firstSignatureAssoc = '';    // association already signed
let lastSignatureId = null;      // DB id returned after successful sign

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

// ===== IMPROVEMENT 2: DOCUMENT PREVIEW =====

async function loadDocumentPreview(assoc) {
  const previewBox = document.getElementById('doc-preview-box');
  previewBox.innerHTML = '<div class="doc-preview-loading">Loading document preview...</div>';
  try {
    const response = await fetch(`/api/preview/${assoc}`);
    if (!response.ok) throw new Error('Could not load preview');
    const html = await response.text();

    // Render in an isolated iframe so template styles don't bleed into the app
    const iframe = document.createElement('iframe');
    iframe.className = 'doc-preview-iframe';
    iframe.setAttribute('sandbox', 'allow-same-origin');
    iframe.setAttribute('title', 'Document preview');
    previewBox.innerHTML = '';
    previewBox.appendChild(iframe);

    // Write content after appending to DOM
    iframe.contentDocument.open();
    iframe.contentDocument.write(html);
    iframe.contentDocument.close();
  } catch (err) {
    previewBox.innerHTML = '<div class="doc-preview-loading" style="color:#c0392b;">Could not load document preview.</div>';
  }
}

// ===== ASSOCIATION SELECTION =====

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

  // Improvement 2: load document preview for selected association
  loadDocumentPreview(assoc);
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
      // Improvement 1: set download link if ID returned
      lastSignatureId = result.signatureId || null;
      const btnDownload = document.getElementById('btn-download-pdf');
      if (lastSignatureId) {
        btnDownload.href = `/api/download/${lastSignatureId}`;
        btnDownload.style.display = 'inline-block';
      } else {
        btnDownload.style.display = 'none';
      }

      // Sequential flow logic
      const isSecondFlow = (firstSignatureData !== null);

      // Hide all sub-sections first
      document.getElementById('confirm-next-section').style.display = 'none';
      document.getElementById('confirm-final-msg').style.display = 'none';
      document.getElementById('confirm-single-done').style.display = 'none';

      if (!isSecondFlow) {
        // First signature: save personal data and show prompt for second
        firstSignatureData = { ...data };
        firstSignatureAssoc = currentAssociation;
        const otherAssoc = currentAssociation === 'eudicas' ? 'euemotion' : 'eudicas';
        const otherAssocName = otherAssoc === 'eudicas'
          ? 'EUDICAS (European Union Development, Innovation and Cooperation Association)'
          : 'EUEMOTION (European Association for Emotional Management)';

        document.getElementById('confirm-next-text').textContent =
          `You have signed for ${currentAssociation.toUpperCase()}. You also need to sign the adhesion document for ${otherAssocName}.`;
        const continueBtn = document.getElementById('btn-continue-second');
        continueBtn.className = otherAssoc === 'euemotion' ? 'btn-submit euemotion' : 'btn-submit';
        continueBtn.dataset.nextAssoc = otherAssoc;
        document.getElementById('confirm-next-section').style.display = 'block';

      } else {
        // Second signature done: both complete, show final message
        firstSignatureData = null;
        firstSignatureAssoc = '';
        document.getElementById('confirm-final-msg').style.display = 'block';
      }

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

// ===== IMPROVEMENT 3: START SECOND FLOW =====

function startSecondFlow() {
  if (!firstSignatureData) return;

  const btn = document.getElementById('btn-continue-second');
  const nextAssoc = btn.dataset.nextAssoc || (firstSignatureAssoc === 'eudicas' ? 'euemotion' : 'eudicas');

  // Pre-fill form with saved personal data
  document.getElementById('representative_name').value = firstSignatureData.representative_name || '';
  document.getElementById('role').value = firstSignatureData.role || '';
  document.getElementById('entity_name').value = firstSignatureData.entity_name || '';
  document.getElementById('address').value = firstSignatureData.address || '';
  document.getElementById('postal_code').value = firstSignatureData.postal_code || '';
  document.getElementById('city').value = firstSignatureData.city || '';
  document.getElementById('country').value = firstSignatureData.country || '';
  document.getElementById('email').value = firstSignatureData.email || '';
  document.getElementById('phone').value = firstSignatureData.phone || '';

  // Uncheck accept checkbox so user explicitly re-accepts for the new document
  document.getElementById('accept').checked = false;

  // Switch to the new association
  currentAssociation = nextAssoc;
  document.getElementById('association').value = nextAssoc;

  const title = document.getElementById('form-title');
  const submitBtn = document.getElementById('btn-submit');

  if (nextAssoc === 'eudicas') {
    title.textContent = 'EUDICAS — Adhesion Form';
    title.className = 'form-title';
    submitBtn.className = 'btn-submit';
  } else {
    title.textContent = 'EUEMOTION — Adhesion Form';
    title.className = 'form-title euemotion';
    submitBtn.className = 'btn-submit euemotion';
  }

  document.querySelectorAll('.form-group input, .form-group select').forEach(el => {
    el.classList.toggle('euemotion', nextAssoc === 'euemotion');
  });
  document.querySelector('.checkbox-label input').style.accentColor =
    nextAssoc === 'euemotion' ? '#6B2D8B' : '#003399';

  // Reset signature pad
  signaturePad.clear();

  showView('view-form');
  setTimeout(resizeCanvas, 100);

  // Load the preview for the new association
  loadDocumentPreview(nextAssoc);

  // Scroll to signature section after brief delay
  setTimeout(() => {
    const sigSection = document.querySelector('.signature-section');
    if (sigSection) sigSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 400);
}

// ===== HELPERS =====

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
  firstSignatureData = null;
  firstSignatureAssoc = '';
  lastSignatureId = null;
  document.getElementById('btn-download-pdf').style.display = 'none';
  showView('view-landing');
}
