# JP Radar Robô

Backend Node.js com Puppeteer para analisar links da Biblioteca de Anúncios do Facebook.

## Endpoints

- `/health`
- `/analyze?url=LINK_DA_BIBLIOTECA`
- `POST /analyze` com JSON: `{ "url": "LINK_DA_BIBLIOTECA" }`
- `/monitor`

## Render

Build Command:

```bash
npm install
```

Start Command:

```bash
npm start
```

## Observação

A Biblioteca de Anúncios do Facebook pode bloquear scraping, exigir login ou carregar dados dinamicamente. Este robô é a primeira versão funcional para teste profissional.
