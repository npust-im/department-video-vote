import { withSupabase } from 'npm:@supabase/server@1';

type NewUser = { name: string; username: string; password: string };
const normalize = (value: unknown) => String(value ?? '').trim().normalize('NFC').toLowerCase();
const validName = (value: string) => value.length >= 1 && value.length <= 80 && !/[\p{Cc}@]/u.test(value);
const validPassword = (value: string) => value.length >= 1 && value.length <= 72;

async function authPassword(password: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`department-video-vote-v1:${password}`));
  return `Aa1!${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function voterEmail(username: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(username));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `u-${hex}@accounts.example.com`;
}

const fail = (error: string, status = 400) => Response.json({ ok: false, error }, { status });

Deno.serve(withSupabase({ auth: 'user' }, async (request, context) => {
  if (request.method !== 'POST') return fail('僅支援 POST。', 405);
  const actorId = context.userClaims?.id;
  if (!actorId) return fail('請先登入。', 401);

  // 角色只從資料庫讀取；瀏覽器提供的角色欄位與 user_metadata 都不可信。
  const { data: actor, error: actorError } = await context.supabaseAdmin
    .from('profiles').select('role').eq('id', actorId).single();
  if (actorError || actor?.role !== 'admin') return fail('只有管理員可使用此功能。', 403);

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return fail('請提供有效的 JSON 資料。'); }

  if (body.action === 'change_admin_password') {
    const password = String(body.password ?? '');
    if (!validPassword(password)) return fail('新密碼不可空白且最多 72 字元。');
    const { error } = await context.supabaseAdmin.auth.admin.updateUserById(actorId, {
      password: await authPassword(password),
    });
    if (error) return fail(`管理員密碼更新失敗：${error.message}`);
    return Response.json({ ok: true });
  }

  if (body.action === 'create_users') {
    const input = body.users;
    if (!Array.isArray(input) || input.length < 1 || input.length > 20) return fail('每批須有 1 至 20 位使用者。');
    const users: NewUser[] = input.map((raw) => ({
      name: String(raw?.name ?? '').trim(),
      username: normalize(raw?.name),
      password: String(raw?.password ?? ''),
    }));
    if (users.some((user) => !validName(user.name) || !validName(user.username) || !validPassword(user.password))) {
      return fail('帳號資料格式錯誤：姓名與密碼不可空白，密碼最多 72 字元。');
    }
    let added = 0;
    let skipped = 0;
    const errors: string[] = [];
    const seen = new Set<string>();
    for (const user of users) {
      if (seen.has(user.username)) { skipped++; continue; }
      seen.add(user.username);
      const { data: existing, error: lookupError } = await context.supabaseAdmin
        .from('profiles').select('id').eq('username', user.username).maybeSingle();
      if (lookupError) { errors.push(`${user.username}：帳號檢查失敗`); continue; }
      if (existing) { skipped++; continue; }

      const { data: created, error: createError } = await context.supabaseAdmin.auth.admin.createUser({
        email: await voterEmail(user.username),
        password: await authPassword(user.password),
        email_confirm: true,
      });
      if (createError || !created.user) {
        errors.push(`${user.username}：${createError?.message || '無法建立登入帳號'}`);
        continue;
      }
      const { error: profileError } = await context.supabaseAdmin.from('profiles').insert({
        id: created.user.id, name: user.name, username: user.username, role: 'voter',
      });
      if (profileError) {
        await context.supabaseAdmin.auth.admin.deleteUser(created.user.id);
        if (profileError.code === '23505') skipped++;
        else errors.push(`${user.username}：無法儲存使用者資料`);
      } else added++;
    }
    return Response.json({ ok: true, added, skipped, errors });
  }

  if (body.action === 'update_user') {
    const id = String(body.id ?? '');
    const name = String(body.name ?? '').trim();
    const username = normalize(name);
    const password = String(body.password ?? '');
    if (!validName(name) || !validName(username) || (password && !validPassword(password))) return fail('使用者資料格式錯誤。');
    const { data: current } = await context.supabaseAdmin.from('profiles')
      .select('id,name,username,role').eq('id', id).single();
    if (!current || current.role !== 'voter') return fail('找不到一般使用者。', 404);
    if (username !== current.username) {
      const { data: duplicate } = await context.supabaseAdmin.from('profiles')
        .select('id').eq('username', username).maybeSingle();
      if (duplicate) return fail('此帳號已被使用。');
    }
    const { error: updateProfileError } = await context.supabaseAdmin.from('profiles')
      .update({ name, username }).eq('id', id);
    if (updateProfileError) return fail(updateProfileError.code === '23505' ? '此帳號已被使用。' : '無法修改使用者資料。');
    const attributes: { email?: string; email_confirm?: boolean; password?: string } = {};
    if (username !== current.username) {
      attributes.email = await voterEmail(username);
      attributes.email_confirm = true;
    }
    if (password) attributes.password = await authPassword(password);
    if (Object.keys(attributes).length) {
      const { error: authError } = await context.supabaseAdmin.auth.admin.updateUserById(id, attributes);
      if (authError) {
        await context.supabaseAdmin.from('profiles').update({ name: current.name, username: current.username }).eq('id', id);
        return fail(`登入資料修改失敗：${authError.message}`);
      }
    }
    return Response.json({ ok: true });
  }

  if (body.action === 'sync_names') {
    const ids = body.ids;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 20 || ids.some((id) => typeof id !== 'string')) {
      return fail('每批須提供 1 至 20 個使用者 ID。');
    }
    let updated = 0;
    const errors: string[] = [];
    for (const id of ids) {
      const { data: current } = await context.supabaseAdmin.from('profiles')
        .select('id,name,username,role').eq('id', id).single();
      if (!current || current.role !== 'voter') { errors.push(`${id}：找不到一般使用者`); continue; }
      const username = normalize(current.name);
      if (!validName(username)) { errors.push(`${current.name}：姓名格式無效`); continue; }
      if (username === current.username) continue;
      const { data: duplicate } = await context.supabaseAdmin.from('profiles')
        .select('id').eq('username', username).maybeSingle();
      if (duplicate) { errors.push(`${current.name}：姓名與現有帳號重複`); continue; }
      const { error: authError } = await context.supabaseAdmin.auth.admin.updateUserById(id, {
        email: await voterEmail(username), email_confirm: true,
      });
      if (authError) { errors.push(`${current.name}：${authError.message}`); continue; }
      const { error: profileError } = await context.supabaseAdmin.from('profiles')
        .update({ username }).eq('id', id);
      if (profileError) {
        await context.supabaseAdmin.auth.admin.updateUserById(id, {
          email: await voterEmail(current.username), email_confirm: true,
        });
        errors.push(`${current.name}：帳號資料更新失敗`);
      } else updated++;
    }
    return Response.json({ ok: true, updated, errors });
  }

  if (body.action === 'delete_user') {
    const id = String(body.id ?? '');
    const { data: target } = await context.supabaseAdmin.from('profiles')
      .select('role').eq('id', id).single();
    if (!target || target.role !== 'voter') return fail('找不到一般使用者。', 404);
    const { error } = await context.supabaseAdmin.auth.admin.deleteUser(id);
    if (error) return fail(`刪除失敗：${error.message}`);
    return Response.json({ ok: true });
  }

  return fail('不支援的操作。');
}));
