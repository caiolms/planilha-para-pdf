# Autenticação e limites

O site usa Supabase Auth diretamente no navegador e as RPCs
`config_publica()`, `status_conversoes()` e
`registrar_conversao(p_ferramenta)`. A chave pública identifica o projeto;
ela não substitui autorização no banco. Nunca publicar chaves secretas ou
`service_role`.

O cliente bloqueia conversões enquanto a sessão não foi recuperada ou o
serviço está indisponível. Para contas, um estado de cota ausente ou inválido
não autoriza processamento. A RPC de consumo continua sendo necessária
antes do download. Uma preparação autenticada já registrada conta mesmo
se o download for cancelado; a cota local sem conta é devolvida quando o
download não é concluído pelo fluxo do site.

## Limites desta proteção

Arquivos são processados no navegador. A cota sem conta fica no armazenamento
local e pode ser reiniciada. Um cliente modificado também pode ignorar o
registro de conversões. Estes controles não garantem cobrança ou restrição
comercial de processamento local.

O SQL administrativo está em `supabase/admin-panel.sql`, com ativação descrita
em `ADMIN.md`. As definições originais de cotas não estão versionadas aqui.
A segurança efetiva de RLS e RPCs precisa ser confirmada no projeto Supabase;
publicar o frontend não aplica migrações no banco.

## Verificações pendentes no Supabase

- Exportar e versionar schema, políticas, funções e triggers sem dados pessoais
  ou credenciais.
- Revisar RLS e grants de todas as tabelas e views expostas. Para dados por
  usuário, conferir leitura e escrita vinculadas a `auth.uid()`, inclusive
  `WITH CHECK`. Impedir alterações diretas de limites e privilégios.
- Restringir execução das RPCs de conta a `authenticated`, revogando grants
  indevidos de `PUBLIC` e `anon`, inclusive em funções sobrecarregadas.
- Em cada RPC de conta, rejeitar `auth.uid()` nulo e usar exclusivamente a
  identidade da requisição. Validar ferramentas por lista permitida.
- Preferir `SECURITY INVOKER`. Se `SECURITY DEFINER` for necessário, revisar
  proprietário, fixar `search_path`, qualificar objetos por schema e verificar
  propriedade dos registros dentro da função.
- Consumir cota atomicamente, com dia calculado no servidor em
  `America/Sao_Paulo`. Testar requisições concorrentes e definir idempotência
  antes de adicionar novas tentativas automáticas.
- Garantir que `config_publica` exponha somente informações públicas.
- Não usar `user_metadata` para conceder privilégios. Se necessário, registrar
  consentimento com versão e horário no servidor.
- Conferir confirmação de e-mail, política de senha, limites de tentativas,
  CAPTCHA, redirects autorizados e comportamento das sessões após troca de senha.
- Testar acesso anônimo, usuários A/B, sessão expirada e concorrência em ambiente
  de teste. Nenhuma dessas propriedades foi validada no banco pelos testes locais.

## Implantação e dependências

A sessão persistente fica sob gerenciamento do SDK no navegador. Scripts com
acesso à página também podem acessar informações de sessão disponíveis ao
JavaScript. Revisar versões das dependências, adotar distribuição controlada
ou SRI e validar CSP na hospedagem. Essas mudanças exigem conferir todas as
ferramentas, workers, imagens e downloads; não estão implementadas nesta correção.

Configurar um endereço real em `CONTATO_EMAIL` antes de disponibilizar o contato
de privacidade. O site oculta valores vazios ou placeholders inválidos.
Revisar também as afirmações de retenção de dados com as tabelas e logs reais.

Recomenda-se proteger `main` com revisão obrigatória e verificações automatizadas.

## Validação local

Executar `npm test` com Node.js 18 ou superior. Os testes usam o código de
autenticação real do HTML e o módulo administrativo, simulando DOM, SDK,
armazenamento e downloads.
Não acessam Supabase e não substituem testes no navegador ou de RLS.

Referências:

- [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Funções e privilégios](https://supabase.com/docs/guides/database/functions)
- [Sessões](https://supabase.com/docs/guides/auth/sessions)
- [Chaves de API](https://supabase.com/docs/guides/getting-started/api-keys)
