# SIGEM — padrão obrigatório de cadastro e indexação

Todos os novos módulos de upload devem:

1. Salvar o arquivo original no bucket privado da obra, sem substituí-lo por OCR.
2. Inserir o registro em uma das tabelas de bibliotecas documentais. Os gatilhos `sigem_indexacao_sync` criam a fila em `documento_indexacao`.
3. Após o INSERT bem-sucedido, executar `window.sigemIndexarNovoArquivo(nomeDaTabela, obraId)`. Esta é a API comum de indexação; não criar rotinas OCR independentes em novos módulos.
4. Para PDFs suportados (até 120 MB e 1.000 páginas), `ocr-universal.js` examina cada página, extrai texto existente e aplica Tesseract em português às páginas sem texto. O conteúdo é gravado como trechos pesquisáveis com referência à página. O arquivo original não é modificado.
5. Para XLS, XLSX e XLSM, executar extração estruturada com identificação da aba, referência de célula, valores e fórmulas, com limite inicial de 250 MB. Para arquivos acima dos limites, preservar o cadastro e registrar a limitação de indexação; não declarar sucesso sem trechos gravados.
6. Na exclusão, remover o registro documental e o objeto original (e eventuais derivados). O gatilho elimina a indexação e, por cascata, seus trechos.

O módulo compartilhado `ocr-universal.js` deve ser carregado antes de `indexation.js`. O processamento OCR no navegador exige que a página permaneça aberta. Excel é processado pelo leitor estruturado comum `indexacao-grandes.js`. PDF e Excel são gravados em lotes incrementais de trechos; a execução depende do navegador aberto. O limite de 250 MB é de arquivo, não uma garantia de que qualquer planilha dessa dimensão caberá na memória do navegador. Esta implementação não é um serviço OCR em segundo plano independente do navegador.

**Não reprocessar registros concluídos automaticamente.** Reprocessamento deve ser explícito, controlado e não deve eliminar conteúdo válido.
