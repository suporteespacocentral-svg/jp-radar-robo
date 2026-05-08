# JP Radar Robô v2.1

Backend Node.js + Puppeteer para analisar links da Biblioteca de Anúncios do Facebook.

## Melhorias v2.1

- Força `active_status=active`
- Tenta capturar quantidade de resultados ativos
- Tenta ler cards de anúncios
- Tenta extrair datas, copies, links externos e possíveis páginas de venda
- Retorna score/validação inicial
- Retorna `adsExtracted` e lista `ads`

## Render

Build Command:

```bash
npm install
```

Start Command:

```bash
npm start
```

## Node

Usar Node 20.x.
