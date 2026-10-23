# SIGEM Obras — v4 revisada (auditoria estática)

Arquivos: `index.html`, `style.css`, `app.js`, `config.js`, `obra-banner.jpg`.

## Alterações
- Revisado o HTML: scripts externos identificados, política de referência reduzida e botões de navegação com `type="button"`.
- Revisado o JavaScript: validação da conexão antes do login e limpeza de indicadores de contratos quando a consulta falha ou não retorna registros.
- CSS preservado para manter o design aprovado.
- Configuração pública do Supabase preservada; **não** contém chave secreta.
- JPEG validado estruturalmente.

## Limites da verificação
- A análise estática não equivale a varredura por antivírus.
- A biblioteca Supabase ainda é carregada de `cdn.jsdelivr.net`; é necessário validar esse domínio com a TI.
- Não foi realizado teste integrado com o Supabase no navegador.
- O bloqueio do Defender não foi identificado por nome; não há garantia de que a nova versão será permitida.

**Não publique nem force o download se o antivírus corporativo bloquear. Solicite análise da TI.**
