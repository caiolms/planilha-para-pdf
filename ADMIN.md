# Painel administrativo

O painel de consulta aparece automaticamente na página inicial após o login
autorizado. Não há botão, rota ou parâmetro de URL para entrar na administração.
As ferramentas continuam disponíveis abaixo dele.

Mostra totais de usuários, conversões hoje, conversões registradas e limite
diário padrão, além dos 50 cadastros mais recentes e das 50 conversões mais
recentes. O dia segue America/Sao_Paulo. O banco atual tem um único limite
para todas as contas; zero significa sem limite. Este painel não altera dados.
Conversões sem conta não são registradas no servidor e não entram nos totais.

## Ativar no Supabase

1. Criar a conta **caiolms98@yahoo.com.br** pelo cadastro normal e confirmar o e-mail.
2. Fazer backup da estrutura e executar `supabase/admin-panel.sql` no SQL Editor
   como proprietário do banco. Requer as tabelas `profiles`, `conversoes` e
   `app_config` do SQL base fornecido para o aplicativo.
3. Publicar a versão do site deste pull request e entrar com essa conta.

Sem a migração, a RPC não existe e o painel permanece oculto. O frontend não
contém uma lista de e-mails autorizados, não solicita chave administrativa e
não acessa `auth.users` diretamente.

## Autorização e RLS

O cadastro administrativo fica num schema privado, sem acesso de
`anon`/`authenticated`, com RLS habilitada e sem políticas de escrita.
Somente uma operação do proprietário do banco concede esse vínculo.

`is_app_admin()` verifica o UUID vinculado e o e-mail confirmado atual em
`auth.users`, rejeitando contas excluídas ou banidas. Trocar metadados ou
recriar uma conta com o mesmo e-mail não concede acesso ao novo UUID.
O e-mail é lido no banco, sem depender de uma claim antiga no access token.

`admin_painel()` exige essa autorização antes de ler dados globais e retorna
somente os campos do painel. Não retorna hashes de senha, tokens nem celulares.
Ambas as funções usam `SECURITY DEFINER` com `search_path` vazio e execução
restrita a `authenticated`. Políticas SELECT aditivas autorizam o admin a
consultar perfis e conversões. As permissões de escrita existentes não são ampliadas.

Uma conta comum ou uma chamada anônima deve continuar sem acesso aos dados
administrativos, mesmo se modificar o HTML, o JavaScript ou a URL.
Ao sair, trocar de conta ou falhar uma atualização, o painel oculta e limpa os
dados; respostas pendentes de sessões anteriores são descartadas.

## Verificar antes de integrar

- Executar `npm test`. Os testes locais simulam SDK e DOM; não validam o banco.
- Executar `supabase/tests/admin-access.sql` como proprietário em ambiente de
  teste após a migração. Verifica grants, negação a identidade sem vínculo,
  isolamento RLS e o contrato recebido pela conta vinculada, com ROLLBACK.
- No ambiente de teste, usar a sessão da conta administrativa para chamar
  `admin_painel()` e conferir totais e meia-noite de Brasília.
- Com outra conta, confirmar erro `42501` na RPC e somente registros próprios
  em `profiles`/`conversoes`. Sem sessão, confirmar que a RPC é negada.
- Tentar alterar `user_metadata` para admin e inserir vínculo administrativo
  via Data API: ambos não devem conceder acesso.
- Fazer logout/trocar de conta com uma resposta atrasada e conferir a limpeza.
- Conferir desktop e celular; não há controles de entrada nem de edição no painel.

## Revogar

Como proprietário, excluir o UUID da conta em `app_admin_private.members`.
A próxima consulta é negada e limpa a tela. Dados já entregues ao navegador não
podem ser recuperados remotamente. Não existe cache persistente do painel.

Esta migração não substitui as funções de cotas existentes nem muda seu histórico
ou limite. Não execute novamente scripts antigos que removam as políticas
administrativas. O SQL precisa ser aplicado no projeto Supabase; publicar apenas
os arquivos do site não configura o banco.
