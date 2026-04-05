// ═══════════════════════════════════════════════════════════════════════════
// NWES Optometrist Self-Validation Form
// Google Apps Script Web App
//
// HOW TO DEPLOY:
//   1. Go to script.google.com → New project → paste this code
//   2. Edit the GITHUB_TOKEN constant below (use a fine-grained PAT with
//      Contents: Read & Write on the nwes-providers repo)
//   3. Deploy → New deployment → Type: Web app
//      Execute as: Me (lucho.claudetools@gmail.com)
//      Who has access: Anyone
//   4. Copy the deployment URL — that's the base URL used in outreach emails
//
// TO SWITCH TO A PROFESSIONAL EMAIL:
//   Update REPLY_TO below and re-authenticate the Google account that owns
//   this script. No other changes needed.
// ═══════════════════════════════════════════════════════════════════════════

const GH_OWNER      = 'LuchoClaudeTools';
const GH_REPO       = 'nwes-providers';
const GH_BRANCH     = 'main';
const GITHUB_TOKEN  = ''; // ← paste your GitHub PAT here (keep out of version control)
const REPLY_TO      = 'lucho.claudetools@gmail.com'; // update when switching to practice email
const TOKEN_TTL_DAYS = 30;

// ── GitHub API helpers ────────────────────────────────────────────────────

function ghGet(path) {
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}?ref=${GH_BRANCH}`;
  const res = UrlFetchApp.fetch(url, {
    headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error(`GitHub GET ${path} failed: ${res.getContentText()}`);
  return JSON.parse(res.getContentText());
}

function ghPut(path, content, message, sha) {
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`;
  const payload = { message, content: Utilities.base64Encode(content), branch: GH_BRANCH };
  if (sha) payload.sha = sha;
  const res = UrlFetchApp.fetch(url, {
    method: 'put',
    headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code !== 200 && code !== 201) throw new Error(`GitHub PUT ${path} failed: ${res.getContentText()}`);
  return JSON.parse(res.getContentText());
}

function fetchTokens() {
  const data = ghGet('tokens.json');
  const raw = Utilities.newBlob(Utilities.base64Decode(data.content)).getDataAsString();
  return { tokens: JSON.parse(raw), sha: data.sha };
}

function saveTokens(tokens, sha) {
  ghPut('tokens.json', JSON.stringify(tokens, null, 2), 'Update tokens.json', sha);
}

// ── CSV helpers ───────────────────────────────────────────────────────────

function fetchProviders() {
  const data = ghGet('providers.csv');
  const raw = Utilities.newBlob(Utilities.base64Decode(data.content)).getDataAsString();
  return { csv: raw, sha: data.sha, providers: parseCSV(raw) };
}

function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n');
  const headers = csvSplitRow(lines[0]);
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = csvSplitRow(line);
    const obj = {};
    headers.forEach((h, i) => obj[h] = vals[i] || '');
    return obj;
  });
}

function csvSplitRow(line) {
  const fields = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      i++;
      let f = '';
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { f += '"'; i += 2; }
        else if (line[i] === '"') { i++; break; }
        else { f += line[i++]; }
      }
      fields.push(f);
      if (i < line.length && line[i] === ',') i++;
    } else {
      let f = '';
      while (i < line.length && line[i] !== ',') f += line[i++];
      fields.push(f);
      if (i < line.length && line[i] === ',') i++;
    }
  }
  return fields;
}

function csvField(v) {
  const s = String(v == null ? '' : v);
  if (/[,"\n\r]/.test(s) || s !== s.trim()) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

const CSV_HEADERS = ['id','displayName','practice','address','city','phone','email','website',
  'specialty','ownership','catComanage','glaucTC','distMain','distEast','doctors','notes','confirmed'];

function serializeCSV(providers) {
  const rows = [CSV_HEADERS.join(',')];
  for (const p of providers) {
    const doctors = Array.isArray(p.doctors) ? p.doctors.join('|') : (p.doctors || '');
    rows.push(CSV_HEADERS.map(h => {
      if (h === 'doctors') return csvField(doctors);
      return csvField(p[h] === undefined ? '' : p[h]);
    }).join(','));
  }
  return rows.join('\n') + '\n';
}

// ── Token validation ──────────────────────────────────────────────────────

function validateToken(token) {
  const { tokens, sha } = fetchTokens();
  const entry = tokens[token];
  if (!entry) return { valid: false, reason: 'not_found' };
  if (entry.used) return { valid: false, reason: 'used' };
  if (new Date() > new Date(entry.expiresAt)) return { valid: false, reason: 'expired' };
  return { valid: true, entry, tokens, sha };
}

// ── Web app entry points ──────────────────────────────────────────────────

function doGet(e) {
  const token = (e.parameter && e.parameter.token) || '';
  if (!token) return HtmlService.createHtmlOutput(errorPage('Missing token', 'No token was provided in the link. Please use the link from your email.'));

  let result;
  try { result = validateToken(token); }
  catch (err) { return HtmlService.createHtmlOutput(errorPage('Error', 'Could not connect to the provider database. Please try again later.')); }

  if (!result.valid) {
    const messages = {
      not_found: 'This link is not recognized. Please use the exact link from your email.',
      used: 'This link has already been used. Your information has been updated. If you need to make additional changes, please contact our office.',
      expired: `This link expired ${TOKEN_TTL_DAYS} days after it was sent. Please contact our office to request a new link.`
    };
    return HtmlService.createHtmlOutput(errorPage('Link Unavailable', messages[result.reason] || 'This link is not valid.'));
  }

  let providers, providerSha;
  try {
    const fetched = fetchProviders();
    providers = fetched.providers;
    providerSha = fetched.sha;
  } catch (err) {
    return HtmlService.createHtmlOutput(errorPage('Error', 'Could not load provider data. Please try again later.'));
  }

  const provider = providers.find(p => String(p.id) === String(result.entry.providerId));
  if (!provider) return HtmlService.createHtmlOutput(errorPage('Not Found', 'Provider record not found. Please contact our office.'));

  return HtmlService.createHtmlOutput(formPage(token, provider));
}

function doPost(e) {
  const token = (e.parameter && e.parameter.token) || '';
  if (!token) return HtmlService.createHtmlOutput(errorPage('Missing token', 'No token provided.'));

  let result;
  try { result = validateToken(token); }
  catch (err) { return HtmlService.createHtmlOutput(errorPage('Error', 'Could not validate your link. Please try again.')); }

  if (!result.valid) return HtmlService.createHtmlOutput(errorPage('Link Unavailable', 'This link is no longer valid.'));

  // Collect submitted fields
  const p = e.parameter;
  const fields = ['displayName','practice','address','city','phone','email','website','catComanage','glaucTC'];

  let providers, csvSha;
  try {
    const fetched = fetchProviders();
    providers = fetched.providers;
    csvSha = fetched.sha;
  } catch (err) {
    return HtmlService.createHtmlOutput(errorPage('Error', 'Could not load provider data. Please try again.'));
  }

  const idx = providers.findIndex(pr => String(pr.id) === String(result.entry.providerId));
  if (idx < 0) return HtmlService.createHtmlOutput(errorPage('Not Found', 'Provider record not found.'));

  const original = Object.assign({}, providers[idx]);
  fields.forEach(f => { if (p[f] !== undefined) providers[idx][f] = p[f].trim(); });
  providers[idx].confirmed = 'true';

  // Save updated CSV
  try {
    ghPut('providers.csv', serializeCSV(providers),
      `Optometrist self-update: ${providers[idx].displayName}`, csvSha);
  } catch (err) {
    return HtmlService.createHtmlOutput(errorPage('Save Error', 'Your changes could not be saved. Please try again or contact our office.'));
  }

  // Invalidate token
  try {
    result.tokens[token].used = true;
    result.tokens[token].usedAt = new Date().toISOString();
    saveTokens(result.tokens, result.sha);
  } catch (err) {
    // Non-fatal — log but continue
    console.error('Token invalidation failed:', err);
  }

  // Send confirmation email to optometrist
  try {
    const to = result.entry.email || providers[idx].email;
    if (to) {
      MailApp.sendEmail({
        to,
        replyTo: REPLY_TO,
        subject: 'Your information has been updated — Northwest Eye Surgeons',
        htmlBody: confirmationEmail(providers[idx])
      });
    }
  } catch (err) {
    console.error('Confirmation email failed:', err);
  }

  // Notify NWES staff
  try {
    MailApp.sendEmail({
      to: REPLY_TO,
      subject: `Provider self-update: ${providers[idx].displayName}`,
      htmlBody: staffNotificationEmail(original, providers[idx])
    });
  } catch (err) {
    console.error('Staff notification failed:', err);
  }

  return HtmlService.createHtmlOutput(successPage(providers[idx]));
}

// ── HTML pages ────────────────────────────────────────────────────────────

function formPage(token, d) {
  const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const catOpts = ['Yes','No','Limited / Varies'].map(v => `<option value="${v}"${d.catComanage===v?' selected':''}>${v}</option>`).join('');
  const glaucOpts = ['Yes','No','Limited / Varies'].map(v => `<option value="${v}"${d.glaucTC===v?' selected':''}>${v}</option>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Update Your Information — Northwest Eye Surgeons</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f4f8;color:#1a202c;min-height:100vh}
  .header{background:#1a3a6b;color:#fff;padding:20px 24px}
  .header h1{font-size:18px;font-weight:600;margin-bottom:4px}
  .header p{font-size:13px;opacity:.8}
  .card{background:#fff;border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,.08);margin:24px auto;max-width:640px;padding:28px}
  .intro{background:#e8f0fb;border-left:4px solid #1a3a6b;padding:14px 16px;border-radius:0 6px 6px 0;margin-bottom:24px;font-size:14px;line-height:1.6}
  .section-title{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#4a5568;margin:20px 0 12px}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
  .row.full{grid-template-columns:1fr}
  .field label{display:block;font-size:12px;font-weight:600;color:#718096;margin-bottom:5px}
  .field input,.field select{width:100%;border:1.5px solid #cbd5e0;border-radius:6px;padding:9px 11px;font-size:14px;transition:border-color .15s}
  .field input:focus,.field select:focus{outline:none;border-color:#1a3a6b;box-shadow:0 0 0 3px rgba(26,58,107,.1)}
  .readonly-badge{font-size:11px;color:#a0aec0;margin-left:6px;font-weight:normal}
  .footer-bar{display:flex;justify-content:space-between;align-items:center;margin-top:28px;padding-top:20px;border-top:1px solid #e2e8f0}
  .footer-bar p{font-size:12px;color:#718096}
  .btn-submit{background:#1a3a6b;color:#fff;border:none;border-radius:7px;padding:11px 28px;font-size:15px;font-weight:600;cursor:pointer;transition:background .15s}
  .btn-submit:hover{background:#163166}
  @media(max-width:520px){.row{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="header">
  <h1>Northwest Eye Surgeons</h1>
  <p>Referring Provider Information Update</p>
</div>
<div class="card">
  <div class="intro">
    Please review your information below and correct anything that is out of date.
    When you click <strong>Submit Updates</strong>, your record will be marked as verified.
    Fields marked <span class="readonly-badge">read-only</span> cannot be changed here — contact our office for those.
  </div>
  <form method="post">
    <input type="hidden" name="token" value="${esc(token)}">

    <div class="section-title">Provider Identity <span class="readonly-badge">read-only</span></div>
    <div class="row">
      <div class="field"><label>Name</label><input type="text" value="${esc(d.displayName)}" disabled></div>
      <div class="field"><label>Practice</label><input type="text" name="practice" value="${esc(d.practice)}"></div>
    </div>

    <div class="section-title">Contact Information</div>
    <div class="row full">
      <div class="field"><label>Street Address</label><input type="text" name="address" value="${esc(d.address)}"></div>
    </div>
    <div class="row">
      <div class="field"><label>City</label><input type="text" name="city" value="${esc(d.city)}"></div>
      <div class="field"><label>Phone</label><input type="tel" name="phone" value="${esc(d.phone)}"></div>
    </div>
    <div class="row">
      <div class="field"><label>Email</label><input type="email" name="email" value="${esc(d.email)}"></div>
      <div class="field"><label>Website</label><input type="text" name="website" value="${esc(d.website)}"></div>
    </div>

    <div class="section-title">Co-Management Services</div>
    <div class="row">
      <div class="field"><label>Cataract Co-Management</label><select name="catComanage">${catOpts}</select></div>
      <div class="field"><label>Glaucoma Team Care</label><select name="glaucTC">${glaucOpts}</select></div>
    </div>

    <div class="footer-bar">
      <p>Changes are saved securely. This link expires ${TOKEN_TTL_DAYS} days after it was sent.</p>
      <button type="submit" class="btn-submit">Submit Updates</button>
    </div>
  </form>
</div>
</body>
</html>`;
}

function successPage(d) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Updated — Northwest Eye Surgeons</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f4f8;color:#1a202c;min-height:100vh;display:flex;align-items:center;justify-content:center}
  .card{background:#fff;border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,.08);max-width:480px;width:90%;padding:40px;text-align:center}
  .check{font-size:48px;margin-bottom:16px}
  h2{font-size:20px;margin-bottom:10px;color:#1a3a6b}
  p{font-size:14px;color:#4a5568;line-height:1.6}
  .name{font-weight:600;color:#1a202c}
</style>
</head>
<body>
<div class="card">
  <div class="check">✓</div>
  <h2>Information Updated</h2>
  <p>Thank you, <span class="name">${String(d.displayName||'').replace(/</g,'&lt;')}</span>.</p>
  <p style="margin-top:10px">Your information has been updated and verified in our referring provider directory. A confirmation has been sent to your email.</p>
  <p style="margin-top:16px;font-size:12px;color:#718096">Questions? Contact Northwest Eye Surgeons at (614) 436-5700.</p>
</div>
</body>
</html>`;
}

function errorPage(title, message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Northwest Eye Surgeons</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f4f8;color:#1a202c;min-height:100vh;display:flex;align-items:center;justify-content:center}
  .card{background:#fff;border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,.08);max-width:480px;width:90%;padding:40px;text-align:center}
  .icon{font-size:40px;margin-bottom:16px}
  h2{font-size:20px;margin-bottom:10px;color:#c53030}
  p{font-size:14px;color:#4a5568;line-height:1.6}
</style>
</head>
<body>
<div class="card">
  <div class="icon">⚠</div>
  <h2>${title.replace(/</g,'&lt;')}</h2>
  <p>${message.replace(/</g,'&lt;')}</p>
  <p style="margin-top:16px;font-size:12px;color:#718096">Need help? Contact Northwest Eye Surgeons at (614) 436-5700.</p>
</div>
</body>
</html>`;
}

// ── Email templates ───────────────────────────────────────────────────────

function confirmationEmail(d) {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;color:#1a202c">
  <div style="background:#1a3a6b;padding:20px 24px;border-radius:8px 8px 0 0">
    <h1 style="color:#fff;font-size:17px;margin:0">Northwest Eye Surgeons</h1>
  </div>
  <div style="background:#fff;padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
    <p>Dear ${(d.displayName||'Doctor').replace(/</g,'&lt;')},</p>
    <p style="margin-top:12px">Your information in our referring provider directory has been successfully updated and verified. Thank you!</p>
    <p style="margin-top:16px;font-size:13px;color:#718096">Questions? Reply to this email or call us at (614) 436-5700.</p>
  </div>
</div>`;
}

function staffNotificationEmail(original, updated) {
  const fields = ['displayName','practice','address','city','phone','email','website','catComanage','glaucTC'];
  const changes = fields.filter(f => (original[f]||'') !== (updated[f]||''));
  const changeRows = changes.length
    ? changes.map(f => `<tr><td style="padding:4px 8px;font-weight:600;color:#4a5568">${f}</td><td style="padding:4px 8px;color:#c53030;text-decoration:line-through">${(original[f]||'—').replace(/</g,'&lt;')}</td><td style="padding:4px 8px;color:#276749">${(updated[f]||'—').replace(/</g,'&lt;')}</td></tr>`).join('')
    : '<tr><td colspan="3" style="padding:8px;color:#718096">No field changes — confirmed as-is</td></tr>';

  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;color:#1a202c">
  <div style="background:#1a3a6b;padding:16px 20px;border-radius:8px 8px 0 0">
    <h1 style="color:#fff;font-size:16px;margin:0">Provider Self-Update Notification</h1>
  </div>
  <div style="background:#fff;padding:20px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
    <p><strong>${(updated.displayName||'').replace(/</g,'&lt;')}</strong> (${(updated.practice||'').replace(/</g,'&lt;')}) submitted an update via the web form.</p>
    <table style="margin-top:16px;border-collapse:collapse;width:100%;font-size:13px">
      <thead><tr style="background:#f7fafc">
        <th style="padding:6px 8px;text-align:left;color:#4a5568">Field</th>
        <th style="padding:6px 8px;text-align:left;color:#4a5568">Before</th>
        <th style="padding:6px 8px;text-align:left;color:#4a5568">After</th>
      </tr></thead>
      <tbody>${changeRows}</tbody>
    </table>
    <p style="margin-top:16px;font-size:12px;color:#718096">Record has been updated in providers.csv and marked confirmed: true.</p>
  </div>
</div>`;
}
