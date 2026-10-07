import { createClient } from '@supabase/supabase-js';
import readXlsxFile from 'read-excel-file';
import './style.css';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const configured = Boolean(url && key && !url.includes('YOUR_PROJECT'));
const supabase = configured ? createClient(url, key) : null;
const state = { user: null, profile: null, options: [], votes: [], users: [] };
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
const normalizeUsername = (value) => String(value ?? '').trim().toLowerCase();
const validUsername = (value) => /^[a-z0-9._-]{1,64}$/.test(normalizeUsername(value));
const validVideoUrl = (value) => {
  try {
    const parsed = new URL(value);
    return ['https:', 'http:'].includes(parsed.protocol) && parsed.hostname && value.length <= 2000;
  } catch { return false; }
};

let toastTimer;
function toast(message, type = '') {
  const element = $('#toast');
  element.textContent = message;
  element.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.className = 'toast'; }, 5500);
}

function setBusy(form, busy) {
  const button = form.querySelector('button[type="submit"]');
  if (button) button.disabled = busy;
}

function openLogin() {
  if (!configured) return toast('請先完成 Supabase 設定，詳見 README。', 'error');
  if (state.user) return document.querySelector('#works').scrollIntoView();
  $('#login-dialog').showModal();
}

async function voterEmail(username) {
  const bytes = new TextEncoder().encode(normalizeUsername(username));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `u-${hex}@accounts.example.com`;
}

async function fetchAll(table, columns, apply = (query) => query) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await apply(supabase.from(table).select(columns)).range(offset, offset + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

async function refresh() {
  if (!configured) {
    $('#work-count').textContent = '尚未設定資料庫';
    $('#works-grid').innerHTML = '<div class="error-state"><strong>網站尚未完成連線設定</strong>請依 README 設定 Supabase 專案與 GitHub Pages 環境變數。</div>';
    return;
  }
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    state.user = authError ? null : user;
    state.profile = null;
    if (state.user) {
      const { data, error } = await supabase.from('profiles').select('id,name,username,role').eq('id', state.user.id).single();
      if (error) throw error;
      state.profile = data;
    }
    const { data: options, error: optionsError } = await supabase.from('options')
      .select('id,title,video_url,created_at').order('created_at', { ascending: false });
    if (optionsError) throw optionsError;
    state.options = options;
    state.votes = [];
    state.users = [];
    if (state.profile?.role === 'voter') {
      state.votes = await fetchAll('votes', 'user_id,option_id', (query) => query.eq('user_id', state.user.id));
    } else if (state.profile?.role === 'admin') {
      [state.votes, state.users] = await Promise.all([
        fetchAll('votes', 'user_id,option_id'),
        fetchAll('profiles', 'id,name,username,role', (query) => query.eq('role', 'voter')),
      ]);
    }
    render();
  } catch (error) {
    console.error(error);
    $('#work-count').textContent = '載入失敗';
    $('#works-grid').innerHTML = '<div class="error-state"><strong>暫時無法載入作品</strong>請確認網路及 Supabase 設定後重新整理。</div>';
    toast(`資料載入失敗：${error.message}`, 'error');
  }
}

function render() {
  const profile = state.profile;
  $('#user-label').hidden = !profile;
  $('#user-label').textContent = profile ? `你好，${profile.name}` : '';
  $('#login-button').hidden = Boolean(profile);
  $('#logout-button').hidden = !profile;
  $('#nav-admin').hidden = profile?.role !== 'admin';
  $('#admin').hidden = profile?.role !== 'admin';
  $('#closing-login').textContent = profile ? '返回作品 ↑' : '前往登入 ↗';
  renderWorks();
  if (profile?.role === 'admin') renderAdmin();
}

function renderWorks() {
  $('#work-count').textContent = `共 ${state.options.length} 部作品`;
  const selectedId = state.profile?.role === 'voter' ? state.votes[0]?.option_id : null;
  if (!state.options.length) {
    $('#works-grid').innerHTML = '<div class="empty-state"><strong>作品即將登場</strong>主辦單位尚未發布投票選項，請稍後再來。</div>';
    return;
  }
  $('#works-grid').innerHTML = state.options.map((option, index) => {
    const safeUrl = validVideoUrl(option.video_url) ? option.video_url : '#';
    const linkLabel = safeUrl === '#' ? '無效的影片連結' : safeUrl;
    const selected = selectedId === option.id;
    const disabled = Boolean(selectedId) || state.profile?.role === 'admin';
    const buttonText = selected ? '✓ 已投給這部' : selectedId ? '已完成投票' : '投這部影片';
    return `<article class="work-card ${selected ? 'selected' : ''}">
      <div class="work-visual"><span class="work-number">ENTRY ${String(index + 1).padStart(2, '0')}</span><span class="work-play"></span>${selected ? '<span class="selected-tag">你的選擇</span>' : ''}</div>
      <div class="work-body"><span class="work-type">FEATURE FILM / 參賽作品</span><h3 class="work-title">${escapeHtml(option.title)}</h3><span class="work-domain" title="${escapeHtml(linkLabel)}">${escapeHtml(linkLabel)}</span>
      <div class="work-actions"><a class="watch-link" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" ${safeUrl === '#' ? 'aria-disabled="true"' : ''}>觀看影片 ↗</a><button class="vote-button ${selected ? 'selected-vote' : ''}" type="button" data-vote="${option.id}" ${disabled ? 'disabled' : ''}>${buttonText}</button></div></div></article>`;
  }).join('');
}

function renderAdmin() {
  $('#stat-users').textContent = state.users.length;
  $('#stat-options').textContent = state.options.length;
  $('#stat-votes').textContent = state.votes.length;
  renderUsers();
  const counts = new Map();
  state.votes.forEach((vote) => counts.set(vote.option_id, (counts.get(vote.option_id) || 0) + 1));
  $('#options-list').innerHTML = state.options.length ? state.options.map((option) => `<div class="list-item"><div class="list-primary"><strong>${escapeHtml(option.title)}</strong><small>${escapeHtml(option.video_url)}</small></div><span class="vote-count">${counts.get(option.id) || 0} 票</span></div>`).join('') : '<div class="small-empty">尚未新增作品。</div>';
}

function renderUsers() {
  const search = $('#user-search').value.trim().toLowerCase();
  const filtered = state.users.filter((user) => `${user.name} ${user.username}`.toLowerCase().includes(search));
  const voted = new Set(state.votes.map((vote) => vote.user_id));
  $('#users-list').innerHTML = filtered.length ? filtered.map((user) => `<div class="list-item"><div class="list-primary"><strong>${escapeHtml(user.name)}</strong><small>${escapeHtml(user.username)} · ${voted.has(user.id) ? '已投票' : '尚未投票'}</small></div><div class="list-actions"><button class="icon-button" type="button" data-edit="${user.id}">修改</button><button class="icon-button danger" type="button" data-delete="${user.id}">刪除</button></div></div>`).join('') : '<div class="small-empty">沒有符合的使用者。</div>';
}

function addUserRow() {
  const row = document.createElement('div');
  row.className = 'form-row user-form-row';
  row.innerHTML = '<input name="name" placeholder="姓名" maxlength="80" aria-label="姓名" /><input name="username" placeholder="帳號" maxlength="64" aria-label="帳號" /><input name="password" type="password" placeholder="至少 6 字元" aria-label="密碼" /><button class="remove-row" type="button" aria-label="移除此列">×</button>';
  $('#manual-user-rows').append(row);
}

function addOptionRow() {
  const row = document.createElement('div');
  row.className = 'form-row option-form-row';
  row.innerHTML = '<input name="title" placeholder="輸入作品名稱" maxlength="150" aria-label="作品名稱" /><input name="video_url" type="url" placeholder="https://..." aria-label="影片連結" /><button class="remove-row" type="button" aria-label="移除此列">×</button>';
  $('#option-rows').append(row);
}

function validateUsers(rows) {
  if (!rows.length || rows.length > 2000) throw new Error('每次請提供 1 至 2,000 位使用者。');
  return rows.map((row, index) => {
    const name = String(row.name ?? '').trim();
    const username = normalizeUsername(row.username);
    const password = String(row.password ?? '');
    if (!name || name.length > 80 || !validUsername(username) || password.length < 6 || password.length > 72) {
      throw new Error(`第 ${index + 1} 筆資料格式不正確。姓名與帳號不可空白，帳號僅限英數字、點、底線及連字號，密碼需 6 至 72 字元。`);
    }
    return { name, username, password };
  });
}

async function functionCall(body) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) {
    let message = error.message;
    try { message = (await error.context.json()).error || message; } catch { /* response unavailable */ }
    throw new Error(message);
  }
  if (!data?.ok) throw new Error(data?.error || '管理功能執行失敗。');
  return data;
}

async function createUsers(rows) {
  const validated = validateUsers(rows);
  const seen = new Set();
  const unique = validated.filter((row) => {
    if (seen.has(row.username)) return false;
    seen.add(row.username);
    return true;
  });
  let added = 0;
  let skipped = validated.length - unique.length;
  const errors = [];
  for (let offset = 0; offset < unique.length; offset += 20) {
    const chunk = unique.slice(offset, offset + 20);
    const result = await functionCall({ action: 'create_users', users: chunk });
    added += result.added || 0;
    skipped += result.skipped || 0;
    errors.push(...(result.errors || []));
    toast(`匯入進度：${Math.min(offset + 20, unique.length)} / ${unique.length}`);
  }
  await refresh();
  toast(`完成：新增 ${added} 位、略過 ${skipped} 位${errors.length ? `；失敗 ${errors.length} 位：${errors.slice(0, 3).join('、')}` : ''}。`, errors.length ? 'error' : 'success');
}

function manualRows() {
  return [...document.querySelectorAll('#manual-user-rows .form-row')].map((row) => ({
    name: row.querySelector('[name="name"]').value,
    username: row.querySelector('[name="username"]').value,
    password: row.querySelector('[name="password"]').value,
  })).filter((row) => row.name || row.username || row.password);
}

async function excelRows(file) {
  if (!file || !file.name.toLowerCase().endsWith('.xlsx')) throw new Error('請選擇 .xlsx Excel 檔。');
  if (file.size > 5 * 1024 * 1024) throw new Error('Excel 檔案不可超過 5 MB。');
  const sheet = await readXlsxFile(file);
  if (!sheet.length) throw new Error('Excel 沒有資料。');
  const names = sheet[0].map((value) => String(value ?? '').trim().toLowerCase());
  const aliases = { name: ['姓名', 'name'], username: ['帳號', '账号', 'username', 'account'], password: ['密碼', '密码', 'password'] };
  const column = Object.fromEntries(Object.entries(aliases).map(([field, values]) => [field, names.findIndex((name) => values.includes(name))]));
  if (Object.values(column).some((index) => index < 0)) throw new Error('第一列必須包含「姓名、帳號、密碼」欄位。');
  return sheet.slice(1).map((cells) => ({ name: cells[column.name], username: cells[column.username], password: cells[column.password] }))
    .filter((row) => Object.values(row).some((value) => value != null && String(value).trim()));
}

async function vote(optionId) {
  if (!state.profile) return openLogin();
  if (state.profile.role !== 'voter') return toast('管理員帳號不能投票。', 'error');
  if (state.votes.length) return toast('此帳號已投過票。', 'error');
  const option = state.options.find((item) => item.id === optionId);
  if (!option || !confirm(`確定投給「${option.title}」嗎？送出後無法更改。`)) return;
  const { error } = await supabase.from('votes').insert({ user_id: state.user.id, option_id: optionId });
  if (error) return toast(error.code === '23505' ? '此帳號已投過票。' : `投票失敗：${error.message}`, 'error');
  await refresh();
  toast('投票成功，謝謝你的參與！', 'success');
}

$('#year').textContent = new Date().getFullYear();
$('#login-button').addEventListener('click', openLogin);
$('#closing-login').addEventListener('click', openLogin);
$('#logout-button').addEventListener('click', async () => {
  const { error } = await supabase.auth.signOut();
  if (error) return toast(error.message, 'error');
  await refresh();
  toast('已登出。', 'success');
});
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => document.getElementById(button.dataset.close).close()));
document.querySelectorAll('.modal').forEach((dialog) => dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); }));

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const account = $('#login-username').value.trim();
  const password = $('#login-password').value;
  if (!account.includes('@') && !validUsername(account)) return toast('帳號格式不正確。', 'error');
  setBusy(form, true);
  try {
    const email = account.includes('@') ? account : await voterEmail(account);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error('帳號或密碼不正確。');
    $('#login-dialog').close();
    form.reset();
    await refresh();
    toast(`歡迎回來，${state.profile?.name || account}！`, 'success');
    if (state.profile?.role === 'admin') $('#admin').scrollIntoView();
  } catch (error) { toast(error.message, 'error'); }
  finally { setBusy(form, false); }
});

$('#works-grid').addEventListener('click', (event) => {
  const button = event.target.closest('[data-vote]');
  if (button) vote(Number(button.dataset.vote));
});
$('#add-user-row').addEventListener('click', addUserRow);
$('#add-option-row').addEventListener('click', addOptionRow);
document.querySelectorAll('.form-rows').forEach((container) => container.addEventListener('click', (event) => {
  if (!event.target.matches('.remove-row')) return;
  const rows = container.querySelectorAll('.form-row');
  if (rows.length > 1) event.target.closest('.form-row').remove();
  else rows[0].querySelectorAll('input').forEach((input) => { input.value = ''; });
}));

$('#manual-users-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  setBusy(form, true);
  try { await createUsers(manualRows()); form.reset(); $('#manual-user-rows').innerHTML = ''; addUserRow(); }
  catch (error) { toast(error.message, 'error'); }
  finally { setBusy(form, false); }
});

$('#excel-file').addEventListener('change', (event) => { $('#file-name').textContent = event.target.files[0]?.name || ''; });
$('#excel-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  setBusy(form, true);
  try { await createUsers(await excelRows($('#excel-file').files[0])); form.reset(); $('#file-name').textContent = ''; }
  catch (error) { toast(error.message, 'error'); }
  finally { setBusy(form, false); }
});

$('#options-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const rows = [...document.querySelectorAll('#option-rows .form-row')].map((row) => ({
    title: row.querySelector('[name="title"]').value.trim(), video_url: row.querySelector('[name="video_url"]').value.trim(),
  })).filter((row) => row.title || row.video_url);
  if (!rows.length || rows.length > 100 || rows.some((row) => !row.title || row.title.length > 150 || !validVideoUrl(row.video_url))) {
    return toast('請輸入 1 至 100 筆選項，每筆需有作品名稱與有效的 http(s) 影片連結。', 'error');
  }
  setBusy(form, true);
  try {
    const { error } = await supabase.from('options').insert(rows);
    if (error) throw error;
    $('#option-rows').innerHTML = ''; addOptionRow();
    await refresh();
    toast(`已新增 ${rows.length} 個投票選項。`, 'success');
  } catch (error) { toast(error.message, 'error'); }
  finally { setBusy(form, false); }
});

$('#user-search').addEventListener('input', renderUsers);
$('#users-list').addEventListener('click', async (event) => {
  const editButton = event.target.closest('[data-edit]');
  const deleteButton = event.target.closest('[data-delete]');
  if (editButton) {
    const user = state.users.find((item) => item.id === editButton.dataset.edit);
    if (!user) return;
    $('#edit-id').value = user.id;
    $('#edit-name').value = user.name;
    $('#edit-username').value = user.username;
    $('#edit-password').value = '';
    $('#edit-dialog').showModal();
  }
  if (deleteButton) {
    const user = state.users.find((item) => item.id === deleteButton.dataset.delete);
    if (!user || !confirm(`確定刪除「${user.name}（${user.username}）」嗎？其投票紀錄也會移除。`)) return;
    try { await functionCall({ action: 'delete_user', id: user.id }); await refresh(); toast('使用者已刪除。', 'success'); }
    catch (error) { toast(error.message, 'error'); }
  }
});

$('#edit-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const name = $('#edit-name').value.trim();
  const username = normalizeUsername($('#edit-username').value);
  const password = $('#edit-password').value;
  if (!name || name.length > 80 || !validUsername(username) || (password && (password.length < 6 || password.length > 72))) {
    return toast('姓名或帳號格式不正確；新密碼需 6 至 72 字元。', 'error');
  }
  setBusy(form, true);
  try {
    await functionCall({ action: 'update_user', id: $('#edit-id').value, name, username, password });
    $('#edit-dialog').close();
    await refresh();
    toast('使用者資料已更新。', 'success');
  } catch (error) { toast(error.message, 'error'); }
  finally { setBusy(form, false); }
});

addUserRow();
addOptionRow();
if (configured) supabase.auth.onAuthStateChange(() => { setTimeout(refresh, 0); });
refresh();
