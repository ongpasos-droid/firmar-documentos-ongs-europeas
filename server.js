require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const nodemailer = require('nodemailer');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;

// --------------- MIDDLEWARE ---------------

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiter for signing endpoint
const signLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many submissions. Please try again in 15 minutes.' }
});

// --------------- DATABASE ---------------

const dbPath = path.join(__dirname, 'database', 'firmas.db');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS signatures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    association TEXT NOT NULL,
    representative_name TEXT NOT NULL,
    role TEXT NOT NULL,
    entity_name TEXT NOT NULL,
    address TEXT NOT NULL,
    postal_code TEXT NOT NULL,
    city TEXT NOT NULL,
    country TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    pdf_path TEXT NOT NULL,
    signature_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    signee_ip TEXT,
    email_sent_signee INTEGER DEFAULT 0,
    email_sent_admin INTEGER DEFAULT 0
  )
`);

// --------------- EMAIL TRANSPORT ---------------

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// --------------- TEMPLATE RENDERING ---------------

function renderTemplate(association, data) {
  const templateFile = association.toLowerCase() === 'eudicas'
    ? 'adhesion-eudicas.html'
    : 'adhesion-euemotion.html';

  let html = fs.readFileSync(
    path.join(__dirname, 'templates', templateFile),
    'utf8'
  );

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  const replacements = {
    '{{REPRESENTATIVE_NAME}}': data.representative_name,
    '{{ROLE}}': data.role,
    '{{ENTITY_NAME}}': data.entity_name,
    '{{ADDRESS}}': data.address,
    '{{POSTAL_CODE}}': data.postal_code,
    '{{CITY}}': data.city,
    '{{COUNTRY}}': data.country,
    '{{EMAIL}}': data.email,
    '{{DATE}}': dateStr,
    '{{SIGNATURE_IMAGE}}': data.signature
  };

  for (const [key, value] of Object.entries(replacements)) {
    html = html.split(key).join(value || '');
  }

  return html;
}

// --------------- PDF GENERATION ---------------

let browserInstance = null;

async function getBrowser() {
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
  }
  return browserInstance;
}

async function generatePDF(association, data) {
  const html = renderTemplate(association, data);
  const browser = await getBrowser();
  const page = await browser.newPage();

  await page.setContent(html, { waitUntil: 'networkidle0' });
  const pdfBuffer = await page.pdf({
    format: 'A4',
    margin: { top: '0', bottom: '0', left: '0', right: '0' },
    printBackground: true
  });
  await page.close();

  // Save to disk
  const safeName = data.entity_name.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
  const timestamp = Date.now();
  const filename = `Adhesion_${association}_${safeName}_${timestamp}.pdf`;
  const pdfDir = path.join(__dirname, 'pdfs', association.toLowerCase());
  const pdfPath = path.join(pdfDir, filename);

  if (!fs.existsSync(pdfDir)) {
    fs.mkdirSync(pdfDir, { recursive: true });
  }
  fs.writeFileSync(pdfPath, pdfBuffer);

  return { buffer: pdfBuffer, path: pdfPath, filename };
}

// --------------- EMAIL SENDING ---------------

async function sendEmails(association, data, pdfBuffer, pdfFilename) {
  const assocName = association.toUpperCase() === 'EUDICAS'
    ? 'EUDICAS — European Union Development, Innovation and Cooperation Association'
    : 'EUEMOTION — European Association for Emotional Management';

  const results = { signee: false, admin: false };

  // Email to signee
  try {
    await transporter.sendMail({
      from: `"${association.toUpperCase()}" <${process.env.SMTP_USER}>`,
      to: data.email,
      subject: `Adhesion Document — ${association.toUpperCase()} — Signed Copy`,
      html: `
        <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: ${association.toLowerCase() === 'eudicas' ? '#003399' : '#6B2D8B'};">
            Thank you for joining ${association.toUpperCase()}
          </h2>
          <p>Dear ${data.representative_name},</p>
          <p>Thank you for signing the adhesion document on behalf of <strong>${data.entity_name}</strong>.</p>
          <p>Please find attached your signed copy of the Adhesion Document for your records.</p>
          <p>As a reminder, adherent membership is entirely free of charge and entails no financial obligations,
          governance responsibilities, or binding commitments.</p>
          <p>We look forward to collaborating with your entity as part of our European network.</p>
          <br>
          <p>Kind regards,<br>
          <strong>${assocName}</strong><br>
          Calle Vuelta Abajo, no. 4, CP 39627, Penagos (Cantabria), Spain<br>
          ${process.env.ADMIN_EMAIL}</p>
        </div>
      `,
      attachments: [{
        filename: pdfFilename,
        content: pdfBuffer
      }]
    });
    results.signee = true;
  } catch (err) {
    console.error('Error sending email to signee:', err.message);
  }

  // Email to admin
  try {
    await transporter.sendMail({
      from: `"Signature System" <${process.env.SMTP_USER}>`,
      to: process.env.ADMIN_EMAIL,
      subject: `New Adhesion — ${association.toUpperCase()}: ${data.entity_name} (${data.country})`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px;">
          <h2 style="color: #333;">New Adhesion Received</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 6px; font-weight: bold; border-bottom: 1px solid #eee;">Association</td>
                <td style="padding: 6px; border-bottom: 1px solid #eee;">${association.toUpperCase()}</td></tr>
            <tr><td style="padding: 6px; font-weight: bold; border-bottom: 1px solid #eee;">Entity</td>
                <td style="padding: 6px; border-bottom: 1px solid #eee;">${data.entity_name}</td></tr>
            <tr><td style="padding: 6px; font-weight: bold; border-bottom: 1px solid #eee;">Representative</td>
                <td style="padding: 6px; border-bottom: 1px solid #eee;">${data.representative_name}</td></tr>
            <tr><td style="padding: 6px; font-weight: bold; border-bottom: 1px solid #eee;">Role</td>
                <td style="padding: 6px; border-bottom: 1px solid #eee;">${data.role}</td></tr>
            <tr><td style="padding: 6px; font-weight: bold; border-bottom: 1px solid #eee;">Location</td>
                <td style="padding: 6px; border-bottom: 1px solid #eee;">${data.city}, ${data.country}</td></tr>
            <tr><td style="padding: 6px; font-weight: bold; border-bottom: 1px solid #eee;">Email</td>
                <td style="padding: 6px; border-bottom: 1px solid #eee;">${data.email}</td></tr>
            <tr><td style="padding: 6px; font-weight: bold;">Date</td>
                <td style="padding: 6px;">${new Date().toISOString()}</td></tr>
          </table>
        </div>
      `,
      attachments: [{
        filename: pdfFilename,
        content: pdfBuffer
      }]
    });
    results.admin = true;
  } catch (err) {
    console.error('Error sending email to admin:', err.message);
  }

  return results;
}

// --------------- INPUT VALIDATION ---------------

function validateData(data) {
  const required = ['association', 'representative_name', 'role', 'entity_name',
    'address', 'postal_code', 'city', 'country', 'email', 'signature'];
  const missing = required.filter(f => !data[f] || !data[f].trim());
  if (missing.length > 0) {
    return { valid: false, error: `Missing required fields: ${missing.join(', ')}` };
  }
  if (!['eudicas', 'euemotion'].includes(data.association.toLowerCase())) {
    return { valid: false, error: 'Invalid association. Must be EUDICAS or EUEMOTION.' };
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(data.email)) {
    return { valid: false, error: 'Invalid email address.' };
  }
  if (!data.signature.startsWith('data:image/')) {
    return { valid: false, error: 'Invalid signature format.' };
  }
  // Sanitize text inputs
  for (const key of Object.keys(data)) {
    if (typeof data[key] === 'string' && key !== 'signature') {
      data[key] = data[key].replace(/<[^>]*>/g, '').trim();
    }
  }
  return { valid: true };
}

// --------------- API ROUTES ---------------

// Sign endpoint
app.post('/api/sign', signLimiter, async (req, res) => {
  try {
    const data = req.body;
    const validation = validateData(data);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const association = data.association.toLowerCase();
    const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    // Generate PDF
    const pdf = await generatePDF(association, data);

    // Send emails
    const emailResults = await sendEmails(association, data, pdf.buffer, pdf.filename);

    // Save to database
    const stmt = db.prepare(`
      INSERT INTO signatures (association, representative_name, role, entity_name,
        address, postal_code, city, country, email, phone, pdf_path,
        signee_ip, email_sent_signee, email_sent_admin)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      association.toUpperCase(),
      data.representative_name,
      data.role,
      data.entity_name,
      data.address,
      data.postal_code,
      data.city,
      data.country,
      data.email,
      data.phone || null,
      pdf.path,
      clientIP,
      emailResults.signee ? 1 : 0,
      emailResults.admin ? 1 : 0
    );

    res.json({
      success: true,
      message: 'Document signed and sent successfully.',
      emailSent: emailResults.signee,
      signatureId: result.lastInsertRowid
    });

  } catch (err) {
    console.error('Signing error:', err);
    res.status(500).json({ error: 'An error occurred while processing your signature. Please try again.' });
  }
});

// Download signed PDF endpoint (public, requires valid signature ID)
app.get('/api/download/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid signature ID.' });
  }
  const row = db.prepare('SELECT * FROM signatures WHERE id = ?').get(id);
  if (!row || !fs.existsSync(row.pdf_path)) {
    return res.status(404).json({ error: 'Signed document not found.' });
  }
  const safeName = row.entity_name.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
  const filename = `Adhesion_${row.association}_${safeName}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.sendFile(path.resolve(row.pdf_path));
});

// Document preview endpoint — returns plain text content of a template
app.get('/api/preview/:association', (req, res) => {
  const assoc = req.params.association.toLowerCase();
  if (!['eudicas', 'euemotion'].includes(assoc)) {
    return res.status(400).json({ error: 'Invalid association.' });
  }
  const templateFile = assoc === 'eudicas'
    ? 'adhesion-eudicas.html'
    : 'adhesion-euemotion.html';
  try {
    let html = fs.readFileSync(path.join(__dirname, 'templates', templateFile), 'utf8');
    // Strip placeholder tokens so preview shows clean template text
    html = html.replace(/\{\{[^}]+\}\}/g, '___');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    res.status(500).json({ error: 'Could not load document preview.' });
  }
});

// --------------- ADMIN ROUTES ---------------

function adminAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Panel"');
    return res.status(401).send('Authentication required');
  }
  const credentials = Buffer.from(auth.split(' ')[1], 'base64').toString();
  const [user, pass] = credentials.split(':');
  if (user === 'admin' && pass === process.env.ADMIN_PASSWORD) {
    return next();
  }
  res.setHeader('WWW-Authenticate', 'Basic realm="Admin Panel"');
  return res.status(401).send('Invalid credentials');
}

app.get('/admin', adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'panel.html'));
});

app.get('/api/signatures', adminAuth, (req, res) => {
  const filter = req.query.association;
  let rows;
  if (filter && ['eudicas', 'euemotion'].includes(filter.toLowerCase())) {
    rows = db.prepare('SELECT * FROM signatures WHERE LOWER(association) = ? ORDER BY signature_date DESC')
      .all(filter.toLowerCase());
  } else {
    rows = db.prepare('SELECT * FROM signatures ORDER BY signature_date DESC').all();
  }
  res.json(rows);
});

app.get('/api/signatures/:id/pdf', adminAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM signatures WHERE id = ?').get(req.params.id);
  if (!row || !fs.existsSync(row.pdf_path)) {
    return res.status(404).json({ error: 'PDF not found' });
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Adhesion_${row.association}_${row.entity_name}.pdf"`);
  res.sendFile(path.resolve(row.pdf_path));
});

app.get('/api/signatures/export/csv', adminAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM signatures ORDER BY signature_date DESC').all();
  const headers = ['ID', 'Association', 'Representative', 'Role', 'Entity', 'Address',
    'Postal Code', 'City', 'Country', 'Email', 'Phone', 'Date', 'Email Sent'];
  const csv = [
    headers.join(','),
    ...rows.map(r => [
      r.id, r.association, `"${r.representative_name}"`, `"${r.role}"`, `"${r.entity_name}"`,
      `"${r.address}"`, r.postal_code, `"${r.city}"`, `"${r.country}"`, r.email,
      r.phone || '', r.signature_date, r.email_sent_signee ? 'Yes' : 'No'
    ].join(','))
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="signatures_export.csv"');
  res.send(csv);
});

// --------------- START SERVER ---------------

app.listen(PORT, () => {
  console.log(`Signature server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} to access the application`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  if (browserInstance) browserInstance.close();
  db.close();
  process.exit(0);
});
