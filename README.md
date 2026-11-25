# Card Collection App

Simple multi-user card library: Express 5 API (Netlify Function via serverless-http) + Mongoose + MongoDB Atlas, with a plain HTML/JS frontend in `front_end/`. See `planOutline.md` for the design.

## Setup

```
npm install express mongoose serverless-http
```

This installs the latest versions and writes them into `package.json`. Record the installed versions here after installing:

- express: v5.3.0
- mongoose: v9.12.3
- serverless-http: v4.0.0


## Run locally

```
npm run dev
```

Open the URL Netlify prints (normally http://localhost:8888). Check `http://localhost:8888/api/health` first.

## Deploy

1. Push to GitHub (confirm `.env` is not tracked).
2. In the Netlify Dashboard, create a site from the repo. `netlify.toml` already sets the publish directory, functions directory and `/api/*` redirect; no build command is needed.
3. Add `MONGODB_URI` under Site configuration > Environment variables (scope: Functions).
4. In Atlas > Network Access, allow Netlify's IPs (`0.0.0.0/0`).

## Fonts

Loaded from Google Fonts in the `<head>` of both HTML files (one `<link>` per family): Fugaz One (buttons, subtitles, card names), Iosevka Charon (card details and body text) and Courier Prime.

`GungsuhChe` (title and form-field text) is a Microsoft font and is **not** hosted by Google Fonts. The CSS uses it when it is installed on the viewer's computer and falls back to Courier Prime (title) / Iosevka Charon (fields) otherwise. To change this, edit `--font-title` and `--font-field` at the top of `front_end/style.css`.
