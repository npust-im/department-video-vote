# 系所映像｜特色影片競賽

網站前端部署於 GitHub Pages；Supabase 負責帳號驗證、資料庫及管理員帳號操作。GitHub Pages 本身只能提供靜態檔案，登入與「每人限投一票」由 Supabase 的 Auth、資料庫主鍵與 Row Level Security 執行。

## 功能

- 使用主辦單位建立的帳號、密碼登入；每個帳號只能投給一部作品一次，送出後不能改票。
- 作品卡顯示名稱與影片連結，使用者可先觀看再投票。
- 管理員可從 `.xlsx` 匯入帳號、手動新增一筆或多筆帳號、修改或刪除帳號。
- 管理員可一次新增多筆作品（作品名稱與影片網址），並查看使用者投票狀態及各作品票數。
- 刪除使用者時，該使用者的投票紀錄也會刪除，票數會隨之減少。

## 1. 建立 Supabase 專案

1. 在 [Supabase](https://supabase.com/dashboard) 建立專案。
2. 進入 **SQL Editor**，執行 [`supabase/schema.sql`](supabase/schema.sql)。
3. 進入 **Authentication → Users**，使用 **Add user** 建立一個管理員。使用你自己的 Email 和至少 8 字元的密碼，並確認該帳號已完成 Email 驗證。記下這個 Email。
   建立後，建議在 **Authentication → Settings** 關閉 **Allow new users to sign up**，讓一般帳號只能由管理員建立。
4. 回到 SQL Editor，將下方 `admin@example.com` 換成剛建立的管理員 Email，執行：

   ```sql
   insert into public.profiles (id, name, username, role)
   select id, '管理員', 'admin', 'admin'
   from auth.users
   where email = 'admin@example.com';
   ```

   應顯示新增 1 筆。管理員在網站登入時輸入完整 Email；一般投票者輸入 Excel 中的帳號。

5. 部署管理員 Edge Function。在本專案目錄執行：

   ```powershell
   npx supabase login
   npx supabase functions deploy admin-users --project-ref zocsjiwkdobmtwrhjhga --use-api
   ```

   Edge Function 使用 Supabase 伺服器內建的 Secret Key，不要把 Secret Key、Service Role Key 或使用者密碼上傳到 GitHub。

6. 在 **Project Settings → API Keys** 取得 **Project URL** 與 **Publishable key**。這兩項是前端公開設定；只能使用 `sb_publishable_...` 開頭的金鑰，不能填 Secret Key。

## 2. 設定 GitHub Pages

1. 在 `https://github.com/npust-im/department-video-vote` 的 **Settings → Secrets and variables → Actions → Variables** 建立：

   | 變數 | 值 |
   | --- | --- |
   | `VITE_SUPABASE_URL` | Supabase Project URL，例如 `https://xxxxx.supabase.co` |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase Publishable key |

2. 在 **Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**。
3. 推送到 `main` 後，[`deploy.yml`](.github/workflows/deploy.yml) 會自動建置並部署。網站預期網址是 `https://npust-im.github.io/department-video-vote/`。
   若尚未填入兩個變數，頁面會顯示「尚未完成連線設定」；填入後重新執行部署工作流程即可啟用。

## 3. 本機啟動

需要 Node.js 20.19+ 或 22.12+。

```powershell
Copy-Item .env.example .env.local
# 在 .env.local 填入 Supabase Project URL 與 Publishable key
npm ci
npm run dev
```

`.env.local`、`node_modules` 與 `dist` 已列入 `.gitignore`。請不要把 Excel 名單或含密碼的檔案提交到倉庫。

## Excel 欄位格式

請將欄名放在第一列，資料從第二列開始；只讀取第一個工作表。欄位順序可調整，也可有其他欄位。

| 姓名 | 帳號 | 密碼 |
| --- | --- | --- |
| 王小明 | student001 | example123 |
| 李小華 | student002 | example456 |

支援英文欄名 `name`、`username`、`password`。帳號限 1–64 個英文字母、數字、`.`、`_`、`-`，不分大小寫；密碼長度為 6–72 字元。建議將 Excel 的帳號與密碼欄設為「文字」，避免前導零被 Excel 移除。每次最多匯入 2,000 筆；前端分批送出，重複帳號會略過。Excel 原始密碼只用來建立 Supabase Auth 帳號，不會寫入本專案的資料庫。

## 投票限制

`votes.user_id` 是資料庫主鍵，且 Row Level Security 只允許登入的投票者以自己的 ID 新增投票。這能防止重複送出、修改請求或繞過前端按鈕。限制單位是「帳號」；主辦單位應確保名單中每人只有一個帳號。

## 專案結構

- `index.html`、`src/`：GitHub Pages 網站
- `supabase/schema.sql`：資料表與權限規則
- `supabase/functions/admin-users/`：管理員建立、修改、刪除帳號的後端
- `.github/workflows/deploy.yml`：GitHub Pages 自動部署
