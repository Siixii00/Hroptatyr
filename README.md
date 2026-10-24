# 海洛塔帝聊天室

模擬《原神》坎瑞亞「賢者」海洛塔帝的網頁聊天窗。後端是零依賴的 Node 伺服器,可接任何 OpenAI 相容的 `/chat/completions` API。非官方二創。

## 啟動

```bash
copy .env.example .env   # 填入 API_BASE_URL / API_KEY / MODEL
npm start                # 然後開 http://localhost:3000
```

需要 Node 20.6 以上。

## 檔案

- `public/persona.js` — 角色設定與開場白(想調整語氣改這裡)
- `server.js` — 靜態檔案與 `/api/chat` 轉發(金鑰只在後端)
- `public/` — 前端介面,對話紀錄存在瀏覽器 localStorage
- `research/hroptatyr-notes.md` — 資料整理與來源

## 部署到 GitHub Pages

Pages 只能放靜態檔案,沒有後端,所以網頁會自動切換成「直連模式」:每位使用者在右上角「API 設定」填自己的網址、金鑰、模型,資料只存在自己的瀏覽器。**不要把金鑰寫進 repo。**

1. 建立 GitHub repo 並推上 `main` 分支
2. Settings → Pages → Source 選 **GitHub Actions**
3. 推送後 `.github/workflows/pages.yml` 會把 `public/` 發佈出去

直連模式要求該 API 允許瀏覽器跨來源(CORS)。

> 若 Pages 的 Source 設為「Deploy from a branch」(根目錄),根目錄的 `index.html` 會自動轉址到 `public/`;設為 GitHub Actions 時則直接以 `public/` 為網站根目錄。
