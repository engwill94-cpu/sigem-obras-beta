# SIGEM — padrão obrigatório de cadastro e indexação

Todos os novos módulos de upload devem:

1. Salvar o arquivo original no bucket privado da obra, sem substituí-lo por OCR.
2. Inserir o registro em uma das tabelas de bibliotecas documentais. Os gatilhos `sigem_indexacao_sync` criam a fila em `documento_indexacao`.
3. Após o INSERT bem-sucedido, executar `window.sigemIndexarNovoArquivo(nomeDaTabela, obraId)`. Esta é a API comum de indexação; não criar rotinas OCR independentes em novos módulos.
4. Para PDFs suportados (até 12 MB e 80 páginas na versão inicial), `ocr-universal.js` examina cada página, extrai texto existente e aplica Tesseract em português às páginas sem texto. O conteúdo é gravado como trechos pesquisáveis com referência à página. O arquivo original não é modificado.
5. Para outros formatos ou PDFs acima dos limites, manter o cadastro e registrar a limitação de indexação; não declarar sucesso sem trechos gravados.
6. Na exclusão, remover o registro documental e o objeto original (e eventuais derivados). O gatilho elimina a indexação e, por cascata, seus trechos.

O módulo compartilhado `ocr-universal.js` deve ser carregado antes de `indexation.js`. O processamento OCR no navegador exige que a página permaneça aberta. OCR não substitui leitura estruturada de Excel; formatos XLS/XLSX/XLSM necessitam parser próprio. Esta implementação não é um serviço OCR em segundo plano independente do navegador.

**Não reprocessar registros concluídos automaticamente.** Reprocessamento deve ser explícito, controlado e não deve eliminar conteúdo válido.
