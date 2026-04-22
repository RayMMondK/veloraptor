# SpeedLoad 🚀

**Download accelerator gratuito — mais rápido que o IDM.**
Paga se quiser (estilo WinRAR).

## Como funciona

- Divide cada arquivo em **N segmentos** paralelos (padrão: 16)
- Baixa todos os segmentos **ao mesmo tempo** via conexões HTTP Range
- Remonta o arquivo no disco sem overhead
- Funciona com qualquer servidor que suporte `Accept-Ranges: bytes`
- Detecta automaticamente servidores sem suporte e faz download simples

## Features vs IDM

| Feature | IDM | SpeedLoad |
|---|---|---|
| Parallel segments | ✅ max 16 | ✅ até 64 |
| Gratuito | ❌ pago | ✅ sempre |
| Código aberto | ❌ | ✅ |
| Sem ads/bloatware | ❌ | ✅ |
| Thread visualization | ❌ | ✅ |
| Limite de velocidade | ✅ | ✅ |
| Windows | ✅ | ✅ |
| Mac | ❌ | ✅ |
| Linux | ❌ | ✅ |

## Instalar e rodar

### Pré-requisitos
- Node.js 18+ → https://nodejs.org
- npm (vem com Node.js)

### Passos

```bash
# 1. Instalar dependências
npm install

# 2. Rodar em modo dev
npm start

# 3. Gerar .exe (Windows)
npm run build

# Gerar para Mac
npm run build-mac

# Gerar para Linux
npm run build-linux
```

O instalador `.exe` vai aparecer na pasta `dist/`.

## Estrutura do projeto

```
speedload/
├── src/
│   ├── main.js       ← Electron main + download engine
│   ├── preload.js    ← Bridge segura main <-> renderer
│   └── index.html    ← UI completa
├── assets/
│   └── icon.ico      ← Ícone (adicionar manualmente)
└── package.json
```

## Customizar

**Mais threads**: Edite o `<select>` em `index.html` para adicionar opções como 128x.

**Ícone**: Coloque `icon.ico` (256x256) em `assets/` antes de fazer o build.

**Donate link**: Mude `https://buymeacoffee.com/speedload` em `main.js`.

## Licença

MIT — livre pra usar, modificar e distribuir.
Feito com Electron + Node.js nativo (sem libs pesadas).
