/* Settings page */

const toastEl = document.getElementById('toast');

function showToast(msg, kind = 'info') {
  toastEl.textContent = msg;
  toastEl.className = 'toast ' + kind;
  toastEl.style.display = 'block';
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toastEl.style.display = 'none'; }, 2800);
}

function showStatus(id, msg, ok) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.className = 'settings-status ' + (ok ? 'settings-status-ok' : 'settings-status-err');
  el.style.display = 'block';
}
function hideStatus(id) { document.getElementById(id).style.display = 'none'; }

/* ── Toggle password visibility ─────────────────────── */
function wireToggle(toggleId, inputId) {
  document.getElementById(toggleId).addEventListener('click', () => {
    const inp = document.getElementById(inputId);
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });
}
wireToggle('meta-toggle', 'meta-token');
wireToggle('gemini-toggle', 'gemini-key');

/* ── Load current settings ──────────────────────────── */
async function load() {
  try {
    const s = await api.get('/api/settings');

    // Secrets: show preview if set
    const metaInp = document.getElementById('meta-token');
    if (s.meta_access_token && s.meta_access_token.set) {
      metaInp.placeholder = s.meta_access_token.preview + ' (saved)';
    }
    const geminiInp = document.getElementById('gemini-key');
    if (s.gemini_api_key && s.gemini_api_key.set) {
      geminiInp.placeholder = s.gemini_api_key.preview + ' (saved)';
    }

    // Prefs
    document.getElementById('sync-freq').value = s.sync_frequency || 'daily';
    document.getElementById('date-range').value = s.date_range_days || 30;
    document.getElementById('roas-threshold').value = s.winner_roas_threshold ?? 2.0;
    document.getElementById('spend-threshold').value = s.iteration_spend_threshold ?? 100;
  } catch (e) {
    showToast('Failed to load settings: ' + e.message, 'error');
  }
}

/* ── Meta: Save & Connect ───────────────────────────── */
document.getElementById('meta-save').addEventListener('click', async () => {
  const btn = document.getElementById('meta-save');
  const token = document.getElementById('meta-token').value.trim();

  if (!token) {
    showStatus('meta-status', 'Please paste your Meta access token above.', false);
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Connecting…';
  hideStatus('meta-status');

  try {
    // Save the token first
    await api.put('/api/settings', { meta_access_token: token });

    // Then test the connection
    const r = await api.post('/api/settings/test-meta', { token });
    if (r.ok) {
      const name = (r.user && r.user.name) || 'account';
      const count = r.ad_accounts_count != null ? r.ad_accounts_count : 0;
      const accountSummary = count === 0
        ? `Connected as ${name}, but this user has no ad accounts. Make sure your Facebook user is an admin on at least one ad account in Business Settings.`
        : `Connected as ${name} — found ${count} ad account${count === 1 ? '' : 's'}.`;
      showStatus('meta-status', accountSummary, count > 0);
      document.getElementById('meta-token').value = '';
      showToast('Meta token saved and verified');
      load(); // refresh placeholder
    } else {
      showStatus('meta-status', 'Token saved but connection test failed: ' + (r.error || 'unknown error'), false);
    }
  } catch (e) {
    showStatus('meta-status', 'Could not connect to Meta: ' + e.message, false);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save & Connect';
  }
});

/* ── Gemini: Save Key ───────────────────────────────── */
document.getElementById('gemini-save').addEventListener('click', async () => {
  const btn = document.getElementById('gemini-save');
  const key = document.getElementById('gemini-key').value.trim();

  if (!key) {
    showStatus('gemini-status', 'Please paste your Gemini API key above.', false);
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Saving…';
  hideStatus('gemini-status');

  try {
    await api.put('/api/settings', { gemini_api_key: key });
    showStatus('gemini-status', 'Gemini API key saved. Creatives will be analyzed after the next sync.', true);
    document.getElementById('gemini-key').value = '';
    showToast('Gemini key saved');
    load();
  } catch (e) {
    showStatus('gemini-status', 'Error: ' + e.message, false);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Key';
  }
});

/* ── Preferences: Save ──────────────────────────────── */
document.getElementById('prefs-save').addEventListener('click', async () => {
  const btn = document.getElementById('prefs-save');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  hideStatus('prefs-status');

  const patch = {
    sync_frequency: document.getElementById('sync-freq').value,
    date_range_days: Number(document.getElementById('date-range').value),
    winner_roas_threshold: Number(document.getElementById('roas-threshold').value),
    iteration_spend_threshold: Number(document.getElementById('spend-threshold').value),
  };

  try {
    await api.put('/api/settings', patch);
    showStatus('prefs-status', 'Preferences saved.', true);
    showToast('Preferences saved');
  } catch (e) {
    showStatus('prefs-status', 'Error: ' + e.message, false);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Preferences';
  }
});

/* ── Init ────────────────────────────────────────────── */
load();
