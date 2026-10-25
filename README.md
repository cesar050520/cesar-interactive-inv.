# Interactive Invitation by Cesar Ignacio 🎉

**Online-ready version** ng white-background invitation na ginawa natin. Ang lahat ng settings, pictures, background music at guest submissions ay naka-save sa isang central database at pare-pareho para sa lahat ng bisita.

## Ano ang kasama

- White background, makukulay na 3D buttons at click sounds
- Malaking cover picture sa first page na ikaw ang mag-u-upload
- Dalawang unang button: hindi sasama / sasama
- Apat na square buttons: Pagkain, Inumin, Bebot, Ako na Bahala
- Food at drink choices na puwede mong i-edit ang text, emoji, kulay at larawan
- Text box para sa custom na dadalhin
- Venue address na ikaw ang maglalagay
- Bebot surprise photo, final picture/video, at background music
- **ISUBMIT** sa huling page at confirmation pagkatapos
- Secure Admin Password at **Sagot** tab (may CSV export)
- Responses at uploaded content ay shared sa lahat ng gumagamit ng online link

## Paano i-upload sa GitHub at Render

### A. GitHub

1. I-download ang ZIP at **i-extract** sa Files app ng phone o computer.
2. Sa GitHub, gumawa ng **bagong repository** (halimbawa: `cesar-interactive-invitation`). *Mas ligtas na bagong repo para hindi mabura ang nauna mong invitation app sa GitHub.*
3. I-upload ang **mga laman ng folder**, hindi ang ZIP bilang isang file:
   - `server.js`
   - `package.json`
   - `public/index.html` (nasa `public` folder)
   - optional: `README.md`, `.gitignore`, `.env.example`
4. I-commit ang files sa `main` branch.

### B. Render

1. Sa [Render Dashboard](https://dashboard.render.com), piliin **New → Web Service**.
2. Connect GitHub at piliin ang bagong repository na ginawa mo.
3. Runtime: **Node**; Build Command: `npm install`; Start Command: `npm start`.
4. Sa **Environment** magdagdag ng tatlong variables:
   - `ADMIN_PASSWORD` = sarili mong mahaba at mahirap hulaan na password; **huwag gamitin ang 2468 online**.
   - `SESSION_SECRET` = isang mahaba at random na string, halimbawa 48+ random characters; huwag pareho ng password.
   - `DATABASE_URL` = Internal Database URL mula sa iyong Render Postgres database. May existing **cesar-party-database** sa iyong account; puwede itong gamitin dahil ang bagong app ay may sarili nitong `ci_invite_*` tables. Huwag i-post ang database URL kahit saan.
5. I-deploy. Kapag successful, magkakaroon ng `https://<app-name>.onrender.com` na link.

**Importante:** Naka-link sa ibang GitHub repo ang kasalukuyan mong `cesar-private-invites` Render service. **Huwag basta palitan** ang source files nito kung gusto mo pang panatilihin ang lumang invitation app.

### C. Paano gamitin

1. Buksan ang Render URL.
2. Pindutin ang ⚙️ icon sa upper right.
3. Ilagay ang `ADMIN_PASSWORD` na ikaw ang nagtakda.
4. Sa **Text, Buttons, Media**, puwede mong i-edit ang laman ng invitation. Ang pagbabago ay mase-save online.
5. I-share ang Render URL sa mga bisita.
6. Pumunta sa ⚙️ → **Sagot** para makita ang lahat ng natanggap na sagot at ma-export bilang CSV.

## Paalala sa database at files

- **Kinakailangan ang PostgreSQL** kapag hosted sa Render. Kung walang `DATABASE_URL`, sadyang hindi magsisimula ang hosted server para hindi mawala ang submissions sa restart o redeploy.
- Sa local computer, may local-file demo mode (ADMIN_PASSWORD default `2468` para lamang sa local test). Sa Render, required ang strong password at session secret.
- Hanggang **18 MB kada uploaded media file** at **100 MB total media** sa kasalukuyang version. Para sa malalaking video, i-compress muna.
- Maaaring mag-expire ang libreng Render PostgreSQL database. Ang existing `cesar-party-database` mo ay may expiry date na **November 23, 2026** ayon sa Render account; i-upgrade o i-backup ang mahalagang sagot bago ito mag-expire.
- Lahat ng sagot ay tatanggapin lamang kapag pinindot ng bisita ang **ISUBMIT**; ikaw lang na may admin password ang makakakita ng listahan.
- Kailangan ng internet ang online app. Hindi pa ito live hangga't hindi nai-upload ang code sa GitHub at matagumpay na na-deploy sa Render.

## Para i-test sa computer (optional)

`npm install` tapos `npm start`, at buksan `http://localhost:3000`. Local testing lang; maglagay ng `DATABASE_URL`, `ADMIN_PASSWORD` at `SESSION_SECRET` bago mag-deploy.
