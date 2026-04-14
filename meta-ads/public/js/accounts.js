const tbody = document.querySelector('#tbl tbody');
const tbl = document.getElementById('tbl');
const empty = document.getElementById('empty');
const modal = document.getElementById('modal');
const confirmModal = document.getElementById('confirm');
const form = document.getElementById('add-form');
const formErr = document.getElementById('form-err');
const toast = document.getElementById('toast');

let pendingDelete = null;

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function showToast(msg, kind = 'info') {
  toast.textContent = msg;
  toast.className = 'toast ' + kind;
  toast.style.display = 'block';
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toast.style.display = 'none'; }, 2800);
}

async function load() {
  const rows = await api.get('/api/accounts');
  if (!rows.length) {
    tbl.style.display = 'none';
    empty.style.display = 'block';
    return;
  }
  tbl.style.display = 'table';
  empty.style.display = 'none';
  tbody.innerHTML = rows.map(a => `
    <tr>
      <td>
        <div style="font-weight:500">${escapeHtml(a.name)}</div>
        ${a.timezone ? `<div style="color:var(--muted);font-size:11px">${escapeHtml(a.timezone)}</div>` : ''}
      </td>
      <td><code style="font-size:12px;color:var(--muted)">${escapeHtml(a.external_id)}</code></td>
      <td>${escapeHtml(a.currency || '—')}</td>
      <td>
        <button class="pill ${a.status === 'active' ? 'pill-on' : 'pill-off'}"
                data-id="${a.id}" data-active="${a.status === 'active'}"
                title="Click to ${a.status === 'active' ? 'pause' : 'activate'}">
          <span class="pill-dot"></span>${a.status === 'active' ? 'Active' : 'Paused'}
        </button>
      </td>
      <td style="text-align:right">
        <button class="icon-btn danger-hover" data-del="${a.id}" data-name="${escapeHtml(a.name)}" title="Delete">🗑</button>
      </td>
    </tr>`).join('');

  tbody.querySelectorAll('.pill').forEach(btn =>
    btn.addEventListener('click', () => toggleActive(btn, btn.dataset.id, btn.dataset.active !== 'true')));
  tbody.querySelectorAll('[data-del]').forEach(btn =>
    btn.addEventListener('click', () => askDelete(btn.dataset.del, btn.dataset.name)));
}

async function toggleActive(btn, id, next) {
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    await api.put(`/api/accounts/${id}`, { active: next });
    showToast(next ? 'Account activated' : 'Account paused');
    await load();
  } catch (e) {
    showToast(e.message, 'error');
    btn.disabled = false;
  }
}

function askDelete(id, name) {
  pendingDelete = id;
  document.getElementById('confirm-name').textContent = name;
  confirmModal.style.display = 'flex';
}

document.getElementById('confirm-cancel').addEventListener('click', () => {
  confirmModal.style.display = 'none';
  pendingDelete = null;
});
document.getElementById('confirm-ok').addEventListener('click', async () => {
  if (!pendingDelete) return;
  try {
    await api.del(`/api/accounts/${pendingDelete}`);
    showToast('Account deleted');
    confirmModal.style.display = 'none';
    pendingDelete = null;
    load();
  } catch (e) {
    showToast(e.message, 'error');
  }
});

function openAdd() {
  form.reset();
  formErr.style.display = 'none';
  modal.style.display = 'flex';
  setTimeout(() => form.querySelector('[name=name]').focus(), 50);
}
function closeAdd() { modal.style.display = 'none'; }

document.getElementById('add-btn').addEventListener('click', openAdd);
document.getElementById('add-empty-btn').addEventListener('click', openAdd);
document.getElementById('modal-close').addEventListener('click', closeAdd);
document.getElementById('cancel-btn').addEventListener('click', closeAdd);
modal.addEventListener('click', e => { if (e.target === modal) closeAdd(); });
confirmModal.addEventListener('click', e => { if (e.target === confirmModal) confirmModal.style.display = 'none'; });

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeAdd(); confirmModal.style.display = 'none'; }
});

form.addEventListener('submit', async e => {
  e.preventDefault();
  formErr.style.display = 'none';
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    const r = await api.post('/api/accounts', data);
    showToast(r.created ? 'Account added' : 'Account updated');
    closeAdd();
    load();
  } catch (err) {
    formErr.textContent = err.message;
    formErr.style.display = 'block';
  }
});

load();
