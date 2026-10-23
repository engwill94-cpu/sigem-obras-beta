# SIGEM Obras — Painel modernizado (versão para validação)

Atualização visual do painel de obras, preservando a autenticação Supabase e as operações de cadastro e edição. Inclui pesquisa, filtros, indicadores de quantidade, cartões e botão **Entrar** (abre uma tela temporária de preparação da interface interna).

**Não há dados fictícios de progresso**: as barras de evolução dependem de medições futuras. As miniaturas são elementos gráficos neutros, não fotografias reais.

## Publicação (somente após aprovação)
Substituir os arquivos `index.html`, `style.css`, `app.js`, `config.js` e `README.md` na raiz do repositório GitHub Pages. O `config.js` foi mantido do pacote fornecido. Não publicar chaves secretas, `service_role` ou senhas.

## Testes
1. Entrar com a conta administradora.
2. Confirmar que a obra já cadastrada aparece.
3. Testar busca e filtros.
4. Clicar em **Editar**, alterar um campo de teste e confirmar no Supabase.
5. Clicar em **Entrar** e **Voltar ao painel de obras**.
6. Sair, atualizar a página e verificar que o login é exigido.

A página é pública no GitHub Pages; dados são protegidos pelas regras do Supabase. Use apenas documentos e dados fictícios enquanto não houver autorização institucional.
