# JP Radar Robô v2.2

Backend Node.js + Puppeteer para analisar links da Biblioteca de Anúncios do Facebook.

## Melhorias v2.2

- Mantém somente anúncios ativos por `active_status=active`
- Melhora captura dos cards reais
- Tenta extrair anunciante, ID, data, copy, CTA, imagens, vídeos, domínio e landing page
- Gera `topCreatives` com score inicial
- Retorna dados mais limpos para painel

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
