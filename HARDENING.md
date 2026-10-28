# Correções de leitura e registros de conversão

## Site

- SheetJS CE atualizado de 0.18.5 para 0.20.3, versão fixa do CDN oficial.
- Leitura de CSV/TSV/TXT e planilhas binárias em Worker descartável. O Worker é
  terminado após 20 segundos ou quando um novo arquivo válido é selecionado.
  Não há fallback que volte a analisar arquivos na thread da interface.
- Limites de entrada: 40 MB, 100 abas, 50 mil linhas, 2.048 colunas,
  250 mil células acumuladas e 16 milhões de caracteres de conteúdo.
  Todas as dimensões declaradas são conferidas antes de expandir as abas
  em grades. Arquivos esparsos com dimensões enormes são rejeitados.
- HTML de células, fórmulas e macros não são necessários à conversão:
  não são solicitados pelo leitor. O texto formatado é preservado.
- O painel pode repetir consultas após falhas temporárias, mantendo os dados
  ocultos durante a falha. Uma negação explícita de autorização exige nova
  verificação de sessão antes de voltar a consultar.

Workers reduzem bloqueio da interface e permitem interromper a leitura; não
garantem um teto rígido de memória para toda descompactação realizada pela
biblioteca. A verificação das dimensões acontece após o parser da biblioteca,
mas antes de `sheet_to_json`. Manter o limite de tamanho é necessário.
Uma política CSP na hospedagem deve permitir os scripts locais do Worker e a
versão fixa do CDN SheetJS. O arquivo selecionado é enviado somente ao Worker
local, nunca a um servidor de conversão.

## Supabase

Aplicar `supabase/conversion-hardening.sql` pelo SQL Editor após o SQL base.
A atualização mantém a assinatura de `registrar_conversao(text)`, a trava
transacional existente, o histórico e o limite diário atual.

A função aceita somente as seis ferramentas conhecidas e permite até 20
registros por janela de 60 segundos por usuário, inclusive nas contas sem
limite diário. Rejeições não criam registros. O site explica quando aguardar.
Isso reduz abuso por conta, mas não substitui controles contra criação massiva
de contas, nem prova que um arquivo foi realmente convertido. Métricas continuam
sendo registros enviados pelo cliente. Autenticidade exigiria processamento ou
outro recurso controlado pelo servidor.

## Validar

Executar `npm test` para testes locais. Os testes usam o código real dos módulos
com SDK/DOM/Worker simulados; os casos XLSX simulam o parser. Antes de publicar,
conferir XLSX, XLS, ODS, CSV, texto com acentos, abas/linhas ocultas e arquivos
com células deslocadas em navegadores desktop e celular com a biblioteca real.

Executar `supabase/tests/conversion-hardening.sql` como proprietário em ambiente
de teste para verificar negação anônima, ferramentas inválidas e frequência.
O script insere registros temporários e faz ROLLBACK; exige uma conta confirmada.
Conferir também consumo normal abaixo da frequência, limite diário e chamadas
concorrentes com duas conexões. Os testes SQL não foram executados neste ambiente.

Referências oficiais:
- https://cdn.sheetjs.com/advisories/CVE-2023-30533
- https://cdn.sheetjs.com/advisories/CVE-2024-22363
- https://docs.sheetjs.com/docs/getting-started/installation/standalone/
